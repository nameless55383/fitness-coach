-- Defaults and small hygiene updates.

-- Ensure sensible defaults for new profiles (including those created via trigger).
alter table public.profiles
  alter column primary_group set default 'general',
  alter column experience_level set default 'beginner';

-- Backfill existing nulls
update public.profiles set primary_group = 'general' where primary_group is null;
update public.profiles set experience_level = 'beginner' where experience_level is null;

