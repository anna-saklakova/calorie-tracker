-- ⚠️ IRREVERSIBLE. Deletes EVERY account and ALL their food logs.
-- Used once to wipe the test accounts before the cloud-only release.
-- Run it in Supabase → SQL Editor only after the new version is deployed.
-- Not a migration: never run it automatically.

delete from auth.users;   -- user_data rows go with them (on delete cascade)

-- Check: both should be 0
select (select count(*) from auth.users) as users, (select count(*) from public.user_data) as data_rows;
