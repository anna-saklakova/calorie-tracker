-- Per-record storage: one row per day and per library product instead of one big JSON document.
-- Saves send only what changed; pulls fetch only rows changed since the last pull.
-- user_data keeps only the settings: { "schema": 2, "settings": {...} }.
-- The app moves existing data out of user_data on its own the first time it loads.
-- Run BEFORE deploying the app version that uses it. Safe to run more than once.

create table if not exists public.user_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  data jsonb not null,
  -- the app's own edit time (ms); the newer edit wins
  updated_at bigint not null,
  -- server time of the last change, for "what changed since" pulls
  changed_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table if not exists public.user_products (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  changed_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists user_days_changed on public.user_days (user_id, changed_at);
create index if not exists user_products_changed on public.user_products (user_id, changed_at);

alter table public.user_days enable row level security;
alter table public.user_products enable row level security;

drop policy if exists "Users manage their own days" on public.user_days;
create policy "Users manage their own days" on public.user_days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage their own products" on public.user_products;
create policy "Users manage their own products" on public.user_products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.user_days to authenticated;
grant select, insert, update, delete on table public.user_products to authenticated;
revoke all on table public.user_days from anon;
revoke all on table public.user_products from anon;

-- Saves days, products and settings in one call. Each record is written only if it is newer
-- than what is stored (by the app's updated_at), so two devices don't overwrite each other.
-- Runs as the calling user: row-level security applies.
create or replace function public.save_records(
  p_days jsonb default '[]'::jsonb,
  p_products jsonb default '[]'::jsonb,
  p_settings jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  insert into public.user_days as d (user_id, date, data, updated_at)
  -- one row per key even if the payload repeats one (newest first)
  select distinct on (x->>'date') uid, x->>'date', x->'data', (x->>'updated_at')::bigint
  from jsonb_array_elements(p_days) x
  order by x->>'date', (x->>'updated_at')::bigint desc
  on conflict (user_id, date) do update
    set data = excluded.data, updated_at = excluded.updated_at, changed_at = now()
    where d.updated_at < excluded.updated_at;

  insert into public.user_products as p (user_id, id, data, updated_at)
  select distinct on (x->>'id') uid, x->>'id', x->'data', (x->>'updated_at')::bigint
  from jsonb_array_elements(p_products) x
  order by x->>'id', (x->>'updated_at')::bigint desc
  on conflict (user_id, id) do update
    set data = excluded.data, updated_at = excluded.updated_at, changed_at = now()
    where p.updated_at < excluded.updated_at;

  if p_settings is not null then
    insert into public.user_data as u (user_id, data, updated_at)
    values (uid, jsonb_build_object('schema', 2, 'settings', p_settings), now())
    on conflict (user_id) do update
      set data = jsonb_build_object('schema', 2, 'settings', p_settings), updated_at = now()
      -- newer settings win; a row still in the old one-document format is always replaced
      -- (the app moves its days and products into the tables first)
      where coalesce((u.data->'settings'->>'updatedAt')::bigint, 0) < coalesce((p_settings->>'updatedAt')::bigint, 0)
         or u.data ? 'days' or u.data ? 'library';
  end if;
end;
$$;

revoke all on function public.save_records(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_records(jsonb, jsonb, jsonb) to authenticated;
