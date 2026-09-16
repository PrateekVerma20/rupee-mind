# Rupee-Mind — Deployment Guide

**Gmail Sync · Real Transaction Data · Supabase · OpenAI · Vercel**

Rupee-Mind signs users in with Google, requests read-only Gmail access, fetches recent bank-alert emails, parses transaction amounts and merchants, categorizes transactions with OpenAI, detects subscriptions, and stores transactions in Supabase.

## Project structure

```text
rupee-mind/
├── api/
│   ├── sync-gmail.js
│   └── transactions.js
├── public/
│   └── index.html
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── supabase_schema.sql
```

## 1. Google Cloud OAuth setup

1. Go to https://console.cloud.google.com/ and create/select a project.
2. Enable **Gmail API** under APIs & Services → Library.
3. Configure the OAuth consent screen:
   - User type: External
   - Add your own email as a test user
   - Add `https://www.googleapis.com/auth/gmail.readonly`
4. Create an OAuth Client ID with application type **Web application**.
5. Add the Supabase redirect URL as an authorized redirect URI.

## 2. Supabase setup

1. Create a project at https://supabase.com/.
2. Go to Authentication → Providers → Google.
3. Add the Google Client ID and Client Secret.
4. Copy the Supabase redirect URL to Google Cloud.
5. Add `https://www.googleapis.com/auth/gmail.readonly` under Additional Scopes.
6. Run `supabase_schema.sql` in Supabase SQL Editor.
7. Copy your Supabase Project URL and anon key.

### Frontend configuration

Open `public/index.html` and replace:

```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

Never put the Supabase service-role key or OpenAI API key in the frontend.

## 3. GitHub

```bash
git init
git add .
git commit -m "Initial Rupee-Mind deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/rupee-mind.git
git push -u origin main
```

## 4. Vercel

Import the GitHub repository into Vercel and add these environment variables:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role secret |
| `OPENAI_API_KEY` | OpenAI API key |

Then deploy.

## 5. Use the app

1. Open the Vercel URL.
2. Click **Sign in with Google**.
3. Approve read-only Gmail access.
4. Click **Sync Gmail**.
5. Recent matching bank alerts are parsed and stored.
6. Transactions are categorized when loaded.

## Gmail token limitation

The app relies on Supabase's Google `provider_token` for Gmail access. It may only be available immediately after authentication and is not automatically persisted for future visits. If Gmail sync reports that access has expired, sign out and sign in again.

A production V2 can implement secure Google refresh-token handling and server-side token storage for background sync.

## Bank sender coverage

Edit `BANK_SENDER_QUERY` in `api/sync-gmail.js` to add your bank's actual alert sender address. The included list is only a starting point.

## Security checklist

- Never commit `.env` files or API keys.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- Keep `OPENAI_API_KEY` server-side only.
- Do not expose Google tokens in logs.
- Keep Supabase RLS enabled.
- Ensure users can access only their own transactions.
- Review Google OAuth requirements before public distribution.
