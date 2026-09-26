-- Conversations, uploads, and the optional provenance link from pets and
-- entries back to the chat that created them. v2.
--
-- Fully additive, per rule 9: two brand new tables, two new nullable columns
-- on tables that already carry live rows, one new storage policy alongside
-- 0003/0004's four and 0007's one. Nothing existing is altered, renamed, or
-- dropped -- v1, still reading explicit column lists, cannot observe any of
-- this. The 1 handler, 1 pet and 3 entries already live are untouched: a
-- nullable ADD COLUMN with no default requiring a rewrite is a metadata-only
-- change, and every existing row simply reads NULL for the new column,
-- which is exactly what "predates chat" means.
--
-- Design discussion and reasoning for every choice below live in
-- dbschema/ -- conversations.html, uploads.html, pets.html, entries.html.


-- ============================================================================
-- pawpages_conversations
-- ============================================================================
-- One row per chat thread. transcript holds the whole exchange as
-- newline-delimited JSON rather than one row per turn -- text, not jsonb,
-- because jsonb must hold one valid value and true append-a-line semantics
-- need text. title and pet_ids exist so a sidebar can list conversations
-- without ever reading the transcript.

create table pawpages_conversations (
  id          uuid primary key default gen_random_uuid(),
  handler_id  uuid not null references pawpages_handlers (id) on delete cascade,

  title       text,
  pet_ids     uuid[],

  transcript  text not null default '',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column pawpages_conversations.pet_ids is
  'Which pets came up in this conversation. No foreign key -- an array column '
  'cannot carry one. If a pet is deleted, nothing scrubs its id out of every '
  'conversation automatically; that cleanup, if it matters, is the app''s job.';
comment on column pawpages_conversations.transcript is
  'Newline-delimited JSON, one line per turn, appended as the conversation '
  'goes.';

-- the sidebar: a handler's conversations, most recently active first
create index pawpages_conversations_handler_recent_idx
  on pawpages_conversations (handler_id, updated_at desc);

alter table pawpages_conversations enable row level security;

create policy pawpages_handler_owns_conversations on pawpages_conversations
  for all to authenticated
  using (handler_id = (select auth.uid()))
  with check (handler_id = (select auth.uid()));

create trigger pawpages_conversations_touch before update on pawpages_conversations
  for each row execute function touch_updated_at();


-- ============================================================================
-- pawpages_uploads
-- ============================================================================
-- One row per photo sent in through chat's attach button, or from a pet's
-- edit screen. Tracks it from the moment it lands in storage until, if
-- ever, it's claimed as a pet's or an entry's photo.

create table pawpages_uploads (
  id                   uuid primary key default gen_random_uuid(),
  handler_id           uuid not null references pawpages_handlers (id) on delete cascade,
  conversation_id      uuid references pawpages_conversations (id) on delete cascade,

  storage_path         text not null unique,
  content_type         text not null,

  claimed_by_entry_id  uuid references pawpages_entries (id) on delete cascade,
  claimed_by_pet_id    uuid references pawpages_pets (id) on delete cascade,
  claimed_at           timestamptz,

  created_at           timestamptz not null default now(),

  constraint pawpages_claimed_by_one_target check (
    claimed_by_entry_id is null or claimed_by_pet_id is null
  ),
  constraint pawpages_claim_is_complete check (
    (claimed_at is null and claimed_by_entry_id is null and claimed_by_pet_id is null) or
    (claimed_at is not null and (claimed_by_entry_id is not null or claimed_by_pet_id is not null))
  )
);

comment on column pawpages_uploads.storage_path is
  'Path into the existing pet-photos bucket: {handler_id}/uploads/{filename}. '
  'Never moved once claimed -- pets.photo_path / entries.photo_path just '
  'point at wherever this already lives.';
comment on column pawpages_uploads.conversation_id is
  'Null when the upload did not happen inside a chat -- a profile photo set '
  'from a pet''s edit screen, for instance.';
comment on column pawpages_uploads.claimed_at is
  'Set the moment this path is copied into a pets.photo_path or '
  'entries.photo_path. Null means still sitting unclaimed.';

alter table pawpages_uploads enable row level security;

create policy pawpages_handler_owns_uploads on pawpages_uploads
  for all to authenticated
  using (handler_id = (select auth.uid()))
  with check (handler_id = (select auth.uid()));


-- ============================================================================
-- provenance on pawpages_pets and pawpages_entries
-- ============================================================================
-- set null on delete, unlike pawpages_uploads.conversation_id above: an
-- unclaimed upload is disposable, but a pet or an entry must never
-- disappear just because the chat that created it did. Deleting the
-- conversation only drops the provenance link.

alter table pawpages_pets
  add column conversation_id uuid references pawpages_conversations (id) on delete set null;

alter table pawpages_entries
  add column conversation_id uuid references pawpages_conversations (id) on delete set null;

comment on column pawpages_pets.conversation_id is
  'Set when this pet was created, or later edited, from a chat turn. Null '
  'for a pet added the ordinary way, through the form -- including every '
  'row that existed before this migration.';
comment on column pawpages_entries.conversation_id is
  'Set when this entry was logged from a chat turn. Null for an entry added '
  'the ordinary way, through the form -- including every row that existed '
  'before this migration.';


-- ============================================================================
-- storage: a handler's own upload staging area
-- ============================================================================
-- Four new policies, not edits to 0003/0004's four or 0007's one. Those key
-- off (storage.foldername(name))[1] matching a *pet* id the handler owns, so
-- none of them cover {handler_id}/uploads/... -- segment one there is a
-- handler id, not a pet id. 0004's comment stands; nothing there is
-- reopened. Compared as text, same as every existing policy, so a malformed
-- path fails the policy instead of raising an error.

create policy "handler reads own upload staging area"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[2] = 'uploads'
  );

create policy "handler uploads to own staging area"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pet-photos'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[2] = 'uploads'
  );

create policy "handler replaces own staged uploads"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[2] = 'uploads'
  )
  with check (
    bucket_id = 'pet-photos'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[2] = 'uploads'
  );

create policy "handler deletes own staged uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[2] = 'uploads'
  );
