-- Publishing one entry's photo, per entry. v1.1.0.
--
-- The use is proof: a vaccination certificate is the thing a kennel or a
-- groomer actually wants to see, and "take my word for it" is what a public
-- page exists to replace.
--
-- Per entry, and off by default, because the same column already holds photos
-- that were never meant for an audience — a rash, a wound, an invoice. A
-- blanket switch would publish those retroactively, on pets that are already
-- public, without anyone choosing it. `default false` means this migration
-- changes what nobody can see.
--
-- Worth knowing at the toggle rather than after: a vaccination certificate
-- usually carries the *owner's* name, address and phone. The screen says so
-- where the choice is made.

alter table pawpages_entries
  add column photo_is_public boolean not null default false;


-- The view gains two columns, appended, so `create or replace` keeps the four
-- v1 already reads by name — a running v1 selecting title/happened_on/due_on
-- cannot tell this happened.
--
-- Both new columns are null unless the handler published that photo, so the
-- ids 0001 deliberately withheld stay withheld for every other row. An entry
-- id appears here only when its photo is already world-readable, which is the
-- one case where it is not a leak.
--
-- Not switched to security_invoker: `anon` has no rights on `pawpages_entries`, so the
-- view running as its owner is what makes a public page work at all. The
-- linter flags it; 0001 meant it.
create or replace view pawpages_public_entries as
select
  p.slug,
  e.title,
  e.happened_on,
  e.due_on,
  -- deliberately absent: note, vet, due_closed_at, and every id but the one
  -- below, which only a published photo brings into existence.
  case when e.photo_is_public and e.photo_path is not null then e.id end as photo_id,
  case when e.photo_is_public then e.photo_path end as photo_path
from pawpages_entries e
join pawpages_pets p on p.id = e.pet_id
where p.is_public
  and p.archived_at is null;


-- A new policy, not an edit to 0004's. Postgres ORs permissive SELECT policies
-- together, so the five that exist keep their meaning and this adds one case:
-- an object a published entry points at. 0004 stays closed.
--
-- Two lessons from 0004 applied deliberately. `storage.objects.name` is
-- qualified, so nothing in the subquery can shadow it. And the subquery reads
-- `pawpages_public_entries`, not `pawpages_entries`, because `anon` has no
-- rights on the table — the same reason the pet's policy reads
-- `pawpages_public_pets`.
create policy "anyone reads published entry photos"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'pet-photos'
    and exists (
      select 1 from pawpages_public_entries pe
      where pe.photo_path = storage.objects.name
    )
  );
