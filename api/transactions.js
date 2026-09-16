import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { access_token } = req.body || {};
  if (!access_token) return res.status(400).json({ error: "Missing access_token" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: userData, error: userError } = await supabase.auth.getUser(access_token);
  if (userError || !userData?.user) return res.status(401).json({ error: "Invalid session" });

  const userId = userData.user.id;

  const { data: transactions, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .order("transaction_date", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const uncategorized = transactions.filter((t) => !t.category);

  if (uncategorized.length > 0 && process.env.OPENAI_API_KEY) {
    try {
      const payload = uncategorized.map((t) => ({
        id: t.id,
        merchant: t.merchant,
        snippet: t.raw_snippet
      }));

      const prompt =
        `Categorize each transaction into exactly one of: Food, Transport, Groceries, Subscriptions, Bills, Shopping, Travel, Other. ` +
        `Mark isSubscription true if it's a recurring subscription/membership charge. ` +
        `Respond with ONLY JSON in the shape {"results":[{"id":"...","category":"...","isSubscription":true}]}\n\n` +
        `Transactions:\n${JSON.stringify(payload)}`;

      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        })
      });

      const openaiData = await openaiRes.json();
      const text = openaiData.choices?.[0]?.message?.content || "{}";
      const parsedResult = JSON.parse(text);
      const results = parsedResult.results || [];

      for (const r of results) {
        await supabase
          .from("transactions")
          .update({ category: r.category, is_subscription: !!r.isSubscription })
          .eq("id", r.id)
          .eq("user_id", userId);

        const t = transactions.find((x) => x.id === r.id);
        if (t) {
          t.category = r.category;
          t.is_subscription = !!r.isSubscription;
        }
      }
    } catch (err) {
      console.warn("Categorization failed:", err);
    }
  }

  return res.status(200).json({ transactions });
}
