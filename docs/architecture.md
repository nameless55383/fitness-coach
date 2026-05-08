# Architecture (Supabase)

## Core services

1) **Client (web/mobile)**
- Uses Supabase Auth for sign-in.
- Reads/writes user-owned data under RLS using the anon key.

2) **Orchestrator (recommended server component)**
- Runs as a Supabase Edge Function or your own backend.
- Uses the **service role key** for privileged operations that should not be client-driven, e.g.:
  - Writing derived memory summaries
  - Caching evidence documents
  - Running “web RAG” (internet retrieval + citation)

## Memory strategy (practical)

- `profiles`: stable facts and preferences (structured).
- `memories`: durable notes and events (free text + embedding).
- `plans`: generated program versions.
- `check_ins`: time-series signals that drive personalization.
- `chat_sessions` / `chat_messages`: durable conversation log (optional but helpful).

Typical response flow:

1. Load `profiles` + latest `goals`.
2. Retrieve relevant `memories` with `match_memories(query_embedding, user_id)`.
3. If needed, retrieve evidence and store in `evidence_docs` + `evidence_citations`.
4. Generate response + save:
   - user-visible plan changes in `plans`
   - durable facts in `profiles` (with user confirmation)
   - new notes in `memories`

## Web RAG (internet evidence)

Store:
- The normalized URL + publisher metadata in `evidence_docs`
- Snippets actually used in `evidence_citations`

Keep “quality controls” in the orchestrator:
- Prefer hospitals/universities/government/peer-reviewed journals.
- Avoid affiliate/sales pages.
- Always cite sources per key claim.
