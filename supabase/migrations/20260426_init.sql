-- Supabase schema for an AI Fitness Coach chatbot.
-- Safe to run in Supabase SQL editor.

-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- Enum helpers
do $$
begin
  if not exists (select 1 from pg_type where typname = 'goal_type') then
    create type goal_type as enum ('fat_loss', 'muscle_gain', 'strength', 'endurance', 'mobility', 'rehab_support', 'general_health');
  end if;

  if not exists (select 1 from pg_type where typname = 'memory_kind') then
    create type memory_kind as enum ('profile_note', 'preference', 'constraint', 'injury_history', 'training_history', 'checkin_summary', 'plan_rationale', 'freeform');
  end if;
end$$;

-- Profiles (1 row per user)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,

  -- Optional demographics. Keep nullable; collect only what you need.
  birth_year int,
  sex text,
  height_cm numeric,

  -- Coaching context
  primary_group text, -- e.g. 'office_worker' | 'athlete' | 'older_adult' | 'patient' | 'general'
  experience_level text, -- e.g. 'beginner' | 'intermediate' | 'advanced'
  equipment jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Goals (many per user)
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  type goal_type not null,
  description text,
  target jsonb not null default '{}'::jsonb,
  start_date date,
  target_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists goals_user_id_idx on public.goals (user_id);
create index if not exists goals_user_active_idx on public.goals (user_id, is_active);

-- Check-ins (time series)
create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  at_date date not null,

  -- Common signals (all optional)
  weight_kg numeric,
  steps int,
  sleep_hours numeric,
  resting_hr int,
  pain_score int check (pain_score between 0 and 10),
  soreness_score int check (soreness_score between 0 and 10),
  stress_score int check (stress_score between 0 and 10),

  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, at_date)
);

create index if not exists check_ins_user_date_idx on public.check_ins (user_id, at_date desc);

-- Plans (versioned)
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  kind text not null, -- e.g. 'workout' | 'nutrition' | 'habits'
  version int not null default 1,
  is_active boolean not null default true,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists plans_user_kind_idx on public.plans (user_id, kind, is_active);

-- Long-term memory (with embeddings)
-- NOTE: set embedding dims to match the model you use (e.g. 1536, 3072).
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  kind memory_kind not null default 'freeform',
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists memories_user_created_idx on public.memories (user_id, created_at desc);

-- Vector index for similarity search (requires enough rows to be effective).
-- You can tune lists based on dataset size.
create index if not exists memories_embedding_ivfflat_idx
  on public.memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Evidence cache (internet content you cite)
create table if not exists public.evidence_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,

  url text not null,
  normalized_url text not null,
  title text,
  publisher text,
  published_at date,
  retrieved_at timestamptz not null default now(),

  -- Store only what you need (avoid copying full copyrighted pages).
  excerpt text,
  metadata jsonb not null default '{}'::jsonb,

  unique (user_id, normalized_url)
);

create index if not exists evidence_docs_user_idx on public.evidence_docs (user_id, retrieved_at desc);

create table if not exists public.evidence_citations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  evidence_doc_id uuid not null references public.evidence_docs (id) on delete cascade,
  used_in text not null, -- e.g. 'chat_response' | 'plan' | 'safety'
  quote text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists evidence_citations_user_idx on public.evidence_citations (user_id, created_at desc);

-- Utility trigger for updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Similarity search (memories)
create or replace function public.match_memories(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_match_threshold float,
  p_match_count int
)
returns table (
  id uuid,
  kind memory_kind,
  content text,
  metadata jsonb,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    m.id,
    m.kind,
    m.content,
    m.metadata,
    m.created_at,
    (1 - (m.embedding <=> p_query_embedding))::float as similarity
  from public.memories m
  where m.user_id = p_user_id
    and m.embedding is not null
    and (1 - (m.embedding <=> p_query_embedding)) > p_match_threshold
  order by m.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.check_ins enable row level security;
alter table public.plans enable row level security;
alter table public.memories enable row level security;
alter table public.evidence_docs enable row level security;
alter table public.evidence_citations enable row level security;

-- Profiles policies
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select using (auth.uid() = user_id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert with check (auth.uid() = user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Goals policies
drop policy if exists goals_rw_own on public.goals;
create policy goals_rw_own on public.goals
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Check-ins policies
drop policy if exists check_ins_rw_own on public.check_ins;
create policy check_ins_rw_own on public.check_ins
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Plans policies
drop policy if exists plans_rw_own on public.plans;
create policy plans_rw_own on public.plans
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Memories policies
drop policy if exists memories_rw_own on public.memories;
create policy memories_rw_own on public.memories
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Evidence policies
drop policy if exists evidence_docs_rw_own on public.evidence_docs;
create policy evidence_docs_rw_own on public.evidence_docs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists evidence_citations_rw_own on public.evidence_citations;
create policy evidence_citations_rw_own on public.evidence_citations
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
