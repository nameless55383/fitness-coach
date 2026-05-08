# Fitness Coach AI (Supabase-backed)

This repo scaffolds the **data layer** for an AI fitness coach chatbot using **Supabase (Postgres + Auth + Storage)**.

## What you get

- Supabase schema for:
  - User profile + preferences
  - Goals
  - Check-ins (sleep, steps, pain, weight, etc.)
  - Plans (workout / habits)
  - Long-term memory entries (with `pgvector` embeddings for retrieval)
  - Evidence/source cache (for cited internet content)
- Row Level Security (RLS) policies so each user can only access their own data.

## Setup

1. Create a Supabase project.
2. In Supabase Studio → **SQL Editor**:
   - Open `supabase/migrations/20260426_init.sql`
   - Copy/paste the **contents** into a new SQL query
   - Click **Run**
3. Then run these two migrations the same way (in this order):
   - `supabase/migrations/20260426_auth_bootstrap.sql` (auto-create `profiles` row on signup)
   - `supabase/migrations/20260426_chat.sql` (chat sessions/messages tables)
4. Optional upgrades (run anytime):
   - `supabase/migrations/20260506_profiles_defaults.sql` (defaults/backfill for `primary_group` + `experience_level`)
   - `supabase/migrations/20260506_checkins_updated_at.sql` (adds `updated_at` to check-ins for editing/UI)
   - `supabase/migrations/20260506_chat_session_state.sql` (adds `chat_sessions.state` for non-repeating mock-mode flows)

## Environment variables (app/server)

Create a `.env.local` (or your server env) with:

- `SUPABASE_URL=...`
- `SUPABASE_ANON_KEY=...` (client use)
- `SUPABASE_SERVICE_ROLE_KEY=...` (server-only; never expose to clients)

## Edge Function: coach-orchestrator

Folder: `supabase/functions/coach-orchestrator`

What it does:
- Verifies the signed-in user via Supabase Auth JWT
- Loads `profiles`, `goals`, `check_ins`
- Retrieves relevant long-term memory via `match_memories` (pgvector)
- Optionally fetches evidence from PubMed and returns citations
- Persists chat messages to `chat_sessions` / `chat_messages`

Required secrets (set in Supabase project):
- For OpenAI:
  - `OPENAI_API_KEY`
  - Optional: `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_BASE_URL`
- For DeepSeek (OpenAI-compatible):
  - `LLM_PROVIDER=deepseek`
  - `DEEPSEEK_API_KEY` (or `LLM_API_KEY`)
  - Optional: `LLM_BASE_URL=https://api.deepseek.com`, `DEEPSEEK_CHAT_MODEL` or `LLM_CHAT_MODEL`
  - Notes: DeepSeek chat endpoint is `POST /chat/completions` at `https://api.deepseek.com` per official docs.
- Optional (no paid LLM): `COACH_LLM_MODE=mock`

Behavior tuning:
- The coach is designed to be conversational and interactive (asks short clarifying questions and offers options).

Deploy (Supabase CLI):
- `supabase functions deploy coach-orchestrator`
- `supabase secrets set OPENAI_API_KEY=...`

Function URL format:
- `https://<project-ref>.supabase.co/functions/v1/coach-orchestrator`

## Web app (Next.js)

Folder: `apps/web`

1. Copy `.env.example` → `apps/web/.env.local` and set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SUPABASE_FUNCTION_URL`
2. Install and run:
   - `npm install`
   - `npm run dev`

## Next steps

- Add an API/orchestrator (Edge Function or server backend) that:
  - Retrieves user profile + relevant memories (`match_memories`)
  - Optionally fetches/caches evidence from reliable sources
  - Writes new memory items + periodic summaries back into Supabase

This repo includes a working starting point for that orchestrator in `supabase/functions/coach-orchestrator`.
