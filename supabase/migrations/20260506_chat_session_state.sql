-- Add session state for deterministic mock-mode flows (avoid repeated menus/questions).

alter table public.chat_sessions
  add column if not exists state jsonb not null default '{}'::jsonb;

