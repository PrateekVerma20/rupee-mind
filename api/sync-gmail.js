import { createClient } from "@supabase/supabase-js";

const BANK_SENDER_QUERY =
  "from:(alerts@hdfcbank.net OR credit_cards@hdfcbank.net OR alerts@icicibank.com OR " +
  "alerts@axisbank.com OR notifications@sbi.co.in OR alerts@kotak.com)";

const AMOUNT_REGEX = /(?:INR|Rs\.?)\s?([\d,]+(?:\.\d{1,2})?)/i;
const MERCHANT_REGEX = /(?:at|to|towards)\s+([A-Za-z0-9 &._-]{3,40})/i;

function parseEmailSnippet(snippet) {
  const amountMatch = snippet.match(AMOUNT_REGEX);
  const merchantMatch = snippet.match(MERCHANT_REGEX);
  return {
    amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : null,
    merchant: merchantMatch ? merchantMatch[1].trim() : "Unknown"
  };
}

async function parseWithOpenAI(snippet) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content:
            `Extract the transaction amount (number only, no currency symbol) and merchant name ` +
            `from this bank alert email snippet. Respond with ONLY JSON: {"amount": 123.45, "merchant": "..."}\n\n` +
            `Snippet: ${snippet}`
        }],
        response_format: { type: "json_object" }
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { access_token, provider_token } = req.body || {};
  if (!access_token || !provider_token) {
    return res.status(400).json({ error: "Missing access_token or provider_token" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Supabase env vars not configured" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(access_token);
  if (userError || !userData?.user) return res.status(401).json({ error: "Invalid session" });

  const userId = userData.user.id;

  try {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(BANK_SENDER_QUERY)}&maxResults=25`,
      { headers: { Authorization: `Bearer ${provider_token}` } }
    );

    if (!listRes.ok) {
      const errText = await listRes.text();
      return res.status(listRes.status).json({ error: "Gmail list failed", detail: errText });
    }

    const listData = await listRes.json();
    const messages = listData.messages || [];
    const results = [];

    for (const msg of messages) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${provider_token}` } }
      );
      if (!msgRes.ok) continue;

      const msgData = await msgRes.json();
      const snippet = msgData.snippet || "";
      const dateHeader = (msgData.payload?.headers || []).find(
        (h) => h.name.toLowerCase() === "date"
      );
      const txDate = dateHeader
        ? new Date(dateHeader.value).toISOString().slice(0, 10)
        : null;

      let parsed = parseEmailSnippet(snippet);
      if (!parsed.amount) {
        const aiParsed = await parseWithOpenAI(snippet);
        if (aiParsed) parsed = aiParsed;
      }
      if (!parsed.amount) continue;

      results.push({
        user_id: userId,
        gmail_message_id: msg.id,
        transaction_date: txDate,
        amount: parsed.amount,
        merchant: parsed.merchant || "Unknown",
        raw_snippet: snippet
      });
    }

    if (results.length > 0) {
      const { error: upsertError } = await supabase
        .from("transactions")
        .upsert(results, { onConflict: "user_id,gmail_message_id" });

      if (upsertError) {
        return res.status(500).json({ error: "Supabase upsert failed", detail: upsertError.message });
      }
    }

    return res.status(200).json({ synced: results.length });
  } catch (err) {
    return res.status(500).json({ error: "Sync failed", detail: String(err) });
  }
}
