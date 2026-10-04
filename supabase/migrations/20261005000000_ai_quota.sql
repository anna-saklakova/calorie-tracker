-- Daily limits for AI recognition and voice notes, per user.
-- /api/recognize and /api/transcribe call consume_ai_quota() with the user's own session token
-- before every OpenAI call: it checks who is signed in, counts the call and returns how many are left
-- today (UTC), or -1 when the limit is reached. No service key is needed on the server.
-- Safe to run more than once.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null,
  count integer not null default 0,
  primary key (user_id, day, kind)
);

-- Only the function below touches this table; nobody reads or writes it directly.
alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;

create or replace function public.consume_ai_quota(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lim integer;
  used integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  lim := case p_kind when 'recognize' then 30 when 'transcribe' then 60 end;
  if lim is null then
    raise exception 'unknown kind %', p_kind using errcode = '22023';
  end if;

  insert into public.ai_usage as u (user_id, day, kind, count)
  values (uid, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = u.count + 1
  returning u.count into used;

  if used > lim then
    return -1;
  end if;
  return lim - used;
end;
$$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;
