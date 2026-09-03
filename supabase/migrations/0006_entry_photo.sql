-- An optional photo on an entry. v1.1.0.
--
-- The same bucket and the same path shape as a pet's photo: `{pet_id}/{file}`,
-- built by the same `path_for`. That is deliberate and it is the whole reason
-- this migration is one column instead of a policy rewrite.
--
-- The four handler policies from 0004 key off `(storage.foldername(name))[1]`
-- — segment one, the pet id — so an entry photo under a pet the handler owns
-- is already covered for select, insert, update and delete. Nothing to add,
-- and specifically nothing to reopen: 0004's comment stands.
--
-- Visitors cannot see these. "anyone reads photos of public pets" matches
-- `pp.photo_path = storage.objects.name` — the pet's profile photo, exactly.
-- An entry photo never equals that, so it stays private on a public page
-- without a rule saying so. A photo of a rash or a vet's paperwork is not
-- something a public page should hand out, so the default is the right one.
--
-- Additive: one new nullable column, and `public_entries` is untouched.
--
-- Storage has no foreign keys, so deleting an entry has to delete the object
-- too — see `delete_entry` and `delete_me`. There is no cleanup job; the
-- object is removed there or it is orphaned forever.

alter table entries
  add column photo_path text;
