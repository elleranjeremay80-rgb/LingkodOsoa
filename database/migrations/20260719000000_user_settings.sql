-- LINGKOD Meneses - Settings page: per-user preferences, persisted in the
-- database (never localStorage) so they follow the account across
-- browsers/devices, exactly as the brief requires.
--
-- No signup-time row creation trigger is added - the client does a
-- select-or-defaults on load and an upsert on Save (see
-- settings/script.js), which works uniformly for accounts that existed
-- before this table did and new ones alike.
-- Safe to run more than once.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_notifications boolean not null default true,
  sms_notifications boolean not null default false,
  dark_mode boolean not null default false,
  two_factor_enabled boolean not null default false,
  show_profile_information boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select" on public.user_settings;
drop policy if exists "user_settings_insert" on public.user_settings;
drop policy if exists "user_settings_update" on public.user_settings;

-- Own-row only, for every role alike - there is no "admin can see
-- everyone's settings" case here, unlike profiles.
create policy "user_settings_select"
  on public.user_settings for select
  to authenticated
  using (auth.uid() = user_id);

create policy "user_settings_insert"
  on public.user_settings for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "user_settings_update"
  on public.user_settings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.user_settings from anon;
