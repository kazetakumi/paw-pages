-- One private bucket for pet photos.
-- Path convention: {pet_id}/{filename} — the first folder is the pet's id,
-- which is what every policy below keys off.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pet-photos',
  'pet-photos',
  false,
  5242880,                                                   -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
);

-- ---------------------------------------------------------------------------
-- the handler, on their own pets' photos
-- ---------------------------------------------------------------------------
-- id is compared as text rather than casting the path to uuid, so a junk path
-- fails the policy instead of raising an error.

create policy "handler reads own pet photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(name))[1]
        and p.handler_id = (select auth.uid())
    )
  );

create policy "handler uploads own pet photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(name))[1]
        and p.handler_id = (select auth.uid())
    )
  );

create policy "handler replaces own pet photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(name))[1]
        and p.handler_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(name))[1]
        and p.handler_id = (select auth.uid())
    )
  );

create policy "handler deletes own pet photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(name))[1]
        and p.handler_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- everyone else, on public pets only
-- ---------------------------------------------------------------------------
-- The photo's visibility follows the pet's. Switch the public page off, or
-- archive the pet, and the image stops resolving at the same instant — no
-- separate step to remember, and no orphaned public URL.

create policy "anyone reads photos of public pets"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(name))[1]
        and p.is_public
        and p.archived_at is null
    )
  );
