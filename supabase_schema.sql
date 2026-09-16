-- Run this in Supabase SQL Editor:
-- Project > SQL Editor > New query

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  gmail_message_id text not null,
  transaction_date date,
  amount numeric not null,
  merchant text not null,
  raw_snippet text,
  category text,
  is_subscription boolean default false,
  created_at timestamptz default now(),
  unique (user_id, gmail_message_id)
);

alter table transactions enable row level security;

create policy "Users can view their own transactions"
on transactions for select
using (auth.uid() = user_id);

create policy "Users can insert their own transactions"
on transactions for insert
with check (auth.uid() = user_id);

-- The sync-gmail serverless function uses the Supabase service-role key,
-- which bypasses RLS after the user's access token has been verified.
