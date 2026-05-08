-- Basic chat persistence (optional but recommended for audits/debugging).

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_idx on public.chat_sessions (user_id, created_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_idx on public.chat_messages (session_id, created_at);
create index if not exists chat_messages_user_idx on public.chat_messages (user_id, created_at desc);

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_sessions_rw_own on public.chat_sessions;
create policy chat_sessions_rw_own on public.chat_sessions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists chat_messages_rw_own on public.chat_messages;
create policy chat_messages_rw_own on public.chat_messages
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

