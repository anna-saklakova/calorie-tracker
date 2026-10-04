-- Let signed-in users reach their user_data row through the Data API.
-- Newer Supabase projects don't grant table privileges to the API roles by default,
-- so without this every request fails with "permission denied for table user_data".
-- Row-level security still limits each user to their own row. Signed-out (anon) gets nothing.
-- Safe to run more than once.
grant select, insert, update, delete on table public.user_data to authenticated;
revoke all on table public.user_data from anon;
