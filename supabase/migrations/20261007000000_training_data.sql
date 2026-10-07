-- Training examples for improving recognition (src/lib/dataset.ts).
-- After a recognized meal is saved, the app uploads, in the background, the photos the model saw and an
-- example.json (the note, the library sent, the model's answer, what Review proposed and what was saved)
-- to the private Storage bucket `training-data`, under <user id>/<date>/<example id>/.
--
-- Users can only add files to their own folder: they can't list, read, change or delete anything there,
-- and the app never reads it back. Only the project owner reads it (dashboard → Storage, or
-- scripts/download-training-data.mjs with the service role key).
-- Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-data', 'training-data', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/json'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "training-data: add to own folder" on storage.objects;
create policy "training-data: add to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'training-data' and (storage.foldername(name))[1] = (select auth.uid())::text);
