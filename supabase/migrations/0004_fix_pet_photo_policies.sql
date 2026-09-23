-- Repairs the five storage policies from 0003, every one of which denied
-- everyone, always. Two independent defects, both proved against a real
-- Postgres with all three migrations applied.
--
-- 1. Column shadowing. In
--
--      exists (select 1 from pawpages_pets p where p.id::text = (storage.foldername(name))[1])
--
--    the unqualified `name` binds to the inner scope — `pawpages_pets.name`,
--    the animal's name — not `storage.objects.name`, the object path. Postgres
--    deparses all five as `storage.foldername(p.name)`, so each one compares a
--    pet's id against the folder segment of a string like 'Biscuit'.
--    `pawpages_handler_owns_entries` in 0001 avoids this by writing
--    `pawpages_entries.pet_id`.
--
-- 2. `anon` cannot see `pawpages_pets`. The public-read policy subqueries
--    `pawpages_pets`, whose only policies are `to authenticated`. Under
--    `set local role anon` that subquery returns no rows, so the policy
--    denied even with 1 fixed.
--
-- The path convention is unchanged: {pet_id}/{filename}.


-- ---------------------------------------------------------------------------
-- the handler, on their own pets' photos
-- ---------------------------------------------------------------------------
-- Identical to 0003 but for the qualification, which is the whole fix.

drop policy "handler reads own pet photos"     on storage.objects;
drop policy "handler uploads own pet photos"   on storage.objects;
drop policy "handler replaces own pet photos"  on storage.objects;
drop policy "handler deletes own pet photos"   on storage.objects;

create policy "handler reads own pet photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(storage.objects.name))[1]
        and p.handler_id = (select auth.uid())
    )
  );

create policy "handler uploads own pet photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(storage.objects.name))[1]
        and p.handler_id = (select auth.uid())
    )
  );

create policy "handler replaces own pet photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(storage.objects.name))[1]
        and p.handler_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(storage.objects.name))[1]
        and p.handler_id = (select auth.uid())
    )
  );

create policy "handler deletes own pet photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_pets p
      where p.id::text = (storage.foldername(storage.objects.name))[1]
        and p.handler_id = (select auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- everyone else, on public pets only
-- ---------------------------------------------------------------------------
-- Routed through pawpages_public_pets rather than pawpages_pets. That view is
-- security definer and granted to anon, so a visitor can actually evaluate it,
-- and it already carries `where is_public and archived_at is null` — which
-- keeps the original intent exactly: switch the page off or archive the pet
-- and the image stops resolving at the same instant, with no extra code.
--
-- It matches on photo_path rather than on the folder segment because
-- pawpages_public_pets deliberately exposes no id. That is a tighter test, not a looser
-- one: only the object the pet actually points at is readable, so a stale file
-- left in the folder is not public.

drop policy "anyone reads photos of public pets" on storage.objects;

create policy "anyone reads photos of public pets"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_public_pets pp
      where pp.photo_path = storage.objects.name
    )
  );
