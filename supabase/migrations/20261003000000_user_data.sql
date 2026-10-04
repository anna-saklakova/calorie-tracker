-- One JSON document per user: days, product library and settings.
-- The app merges it with the device copy record by record (newest updatedAt wins).
-- Safe to run more than once.
create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

drop policy if exists "Users read their own data" on public.user_data;
create policy "Users read their own data" on public.user_data
  for select using (auth.uid() = user_id);
drop policy if exists "Users insert their own data" on public.user_data;
create policy "Users insert their own data" on public.user_data
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users update their own data" on public.user_data;
create policy "Users update their own data" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete their own data" on public.user_data;
create policy "Users delete their own data" on public.user_data
  for delete using (auth.uid() = user_id);

-- Table privileges for the Data API (see 20261004000000_user_data_grants.sql).
grant select, insert, update, delete on table public.user_data to authenticated;
revoke all on table public.user_data from anon;
