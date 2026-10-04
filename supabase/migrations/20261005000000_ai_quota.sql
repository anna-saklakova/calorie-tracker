-- Daily limits for AI recognition and voice notes.
-- /api/recognize and /api/transcribe call consume_ai_quota() with the user's own session token
-- before every OpenAI call. It counts the call twice — for this email and for the whole app —
-- and answers how many are left today (UTC), -1 when the user's limit is reached,
-- -2 when the app-wide limit is reached. No service key is needed on the server.
--
-- Limits (change the numbers below and run this file again):
--   per email:   recognize 50, transcribe 100
--   whole app:   recognize 500, transcribe 1000
--
-- Counted per email, not per account, and not deleted with the account:
-- deleting the account and signing up again with the same email doesn't reset the limit.
-- Safe to run more than once (keeps today's counts).

drop table if exists public.ai_usage;  -- first draft, counted per account

create table if not exists public.ai_usage_by_email (
  email text not null,
  day date not null,
  kind text not null,
  count integer not null default 0,
  primary key (email, day, kind)
);

create table if not exists public.ai_usage_global (
  day date not null,
  kind text not null,
  count integer not null default 0,
  primary key (day, kind)
);

-- Only the function below touches these tables; nobody reads or writes them directly.
alter table public.ai_usage_by_email enable row level security;
alter table public.ai_usage_global enable row level security;
revoke all on table public.ai_usage_by_email from anon, authenticated;
revoke all on table public.ai_usage_global from anon, authenticated;

create or replace function public.consume_ai_quota(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  who text;
  today date := (now() at time zone 'utc')::date;
  user_limit integer;
  app_limit integer;
  user_used integer;
  app_used integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  user_limit := case p_kind when 'recognize' then 50 when 'transcribe' then 100 end;
  app_limit := case p_kind when 'recognize' then 500 when 'transcribe' then 1000 end;
  if user_limit is null then
    raise exception 'unknown kind %', p_kind using errcode = '22023';
  end if;

  -- the account's email, lower-cased; the account id only if there is no email
  select coalesce(lower(trim(email)), uid::text) into who from auth.users where id = uid;
  who := coalesce(who, uid::text);

  insert into public.ai_usage_by_email as u (email, day, kind, count)
  values (who, today, p_kind, 1)
  on conflict (email, day, kind) do update set count = u.count + 1
  returning u.count into user_used;

  insert into public.ai_usage_global as g (day, kind, count)
  values (today, p_kind, 1)
  on conflict (day, kind) do update set count = g.count + 1
  returning g.count into app_used;

  if user_used > user_limit then
    return -1;
  end if;
  if app_used > app_limit then
    return -2;
  end if;
  return user_limit - user_used;
end;
$$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;
