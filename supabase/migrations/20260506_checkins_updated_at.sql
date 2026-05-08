-- Add updated_at to check_ins for UI display and edits.

alter table public.check_ins
  add column if not exists updated_at timestamptz not null default now();

-- Reuse existing trigger function set_updated_at() from init migration.
drop trigger if exists check_ins_set_updated_at on public.check_ins;
create trigger check_ins_set_updated_at
before update on public.check_ins
for each row execute function public.set_updated_at();

