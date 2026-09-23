-- Paw Pages — v1 schema
-- Postgres 17 / Supabase. Auth is handled by Supabase Auth (auth.users);
-- nothing here stores credentials.
--
-- Three tables: pawpages_handlers, pawpages_pets, pawpages_entries. Two views
-- for the public pet page.


-- ============================================================================
-- pawpages_handlers
-- ============================================================================
-- One row per signed-up person, keyed to auth.users. Holds only what the app
-- shows; email and password live in auth.users and are never duplicated here.

create table pawpages_handlers (
  id             uuid primary key references auth.users (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 80),

  -- optional, unset by default; nothing in the app branches on these
  date_of_birth  date check (date_of_birth <= current_date),
  gender         text check (length(gender) <= 40),
  nationality    text check (length(nationality) <= 60),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column pawpages_handlers.date_of_birth is
  'Age is derived from this at read time and never stored.';


-- Create the handler row automatically when Supabase Auth creates the user,
-- so there is never a signed-in user without a profile.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into pawpages_handlers (id, name)
  values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'Handler'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ============================================================================
-- pawpages_pets
-- ============================================================================

create table pawpages_pets (
  id               uuid primary key default gen_random_uuid(),
  handler_id       uuid not null references pawpages_handlers (id) on delete cascade,

  name             text not null check (length(btrim(name)) between 1 and 60),
  species          text not null check (length(btrim(species)) between 1 and 40),
  breed            text check (length(breed) <= 60),
  sex              text check (sex in ('male', 'female')),

  date_of_birth    date check (date_of_birth <= current_date),
  dob_is_approx    boolean not null default false,
  colour           text check (length(colour) <= 60),

  -- path into the Supabase Storage bucket; null until a photo is uploaded
  photo_path       text,

  -- public page. slug is claimed on insert whether or not the page is on,
  -- so turning it off and on again keeps the same URL.
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_public        boolean not null default false,

  -- archiving. reason and timestamp always travel together.
  archived_at      timestamptz,
  archived_reason  text check (archived_reason in ('passed_away', 'rehomed', 'other')),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint pawpages_archive_is_complete check (
    (archived_at is null and archived_reason is null) or
    (archived_at is not null and archived_reason is not null)
  ),
  constraint pawpages_dob_approx_needs_a_date check (
    not dob_is_approx or date_of_birth is not null
  )
);

comment on column pawpages_pets.species is
  'Free text. Nothing in v1 branches on species; a check list would only block rabbits.';
comment on column pawpages_pets.archived_at is
  'Archived pets are excluded from every due-date query and their public page goes offline.';


-- ============================================================================
-- pawpages_entries
-- ============================================================================
-- One universal shape for everything: a shot, a vet visit, a nail trim.
-- `title` is free text by decision, so the app can never group two entries
-- into a series — which is why a due date has to be closed by hand.

create table pawpages_entries (
  id             uuid primary key default gen_random_uuid(),
  pet_id         uuid not null references pawpages_pets (id) on delete cascade,

  title          text not null check (length(btrim(title)) between 1 and 120),
  happened_on    date not null check (happened_on <= current_date),

  due_on         date,
  due_closed_at  timestamptz,   -- set by "Mark done"; null means still standing

  vet            text check (length(vet) <= 120),
  note           text check (length(note) <= 2000),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint pawpages_due_after_it_happened check (due_on is null or due_on >= happened_on),
  constraint pawpages_cannot_close_a_due_date_that_does_not_exist check (
    due_closed_at is null or due_on is not null
  )
);

comment on column pawpages_entries.due_closed_at is
  'Free-text titles mean nothing closes automatically. Overdue is: '
  'due_on < current_date and due_closed_at is null.';
comment on column pawpages_entries.vet is
  'Recorded per entry, not on the pet — pets change vets and old entries should keep theirs.';


-- ============================================================================
-- indexes
-- ============================================================================

-- the pet list, active pets first
create index pawpages_pets_handler_active_idx on pawpages_pets (handler_id) where archived_at is null;

-- public page lookup by URL
create index pawpages_pets_public_slug_idx on pawpages_pets (slug) where is_public and archived_at is null;

-- a pet's feed, newest first
create index pawpages_entries_pet_feed_idx on pawpages_entries (pet_id, happened_on desc, id desc);

-- the dashboard ledger: only entries that still owe something
create index pawpages_entries_open_due_idx on pawpages_entries (pet_id, due_on)
  where due_on is not null and due_closed_at is null;


-- ============================================================================
-- due dates
-- ============================================================================
-- One definition of "due" and "overdue", so the dashboard, the pet page and
-- any future export cannot disagree about it.

create view pawpages_due_items with (security_invoker = true) as
select
  e.id            as entry_id,
  p.id            as pet_id,
  p.handler_id,
  p.name          as pet_name,
  e.title,
  e.due_on,
  e.due_on - current_date as days_until,
  e.due_on < current_date as is_overdue
from pawpages_entries e
join pawpages_pets p on p.id = e.pet_id
where e.due_on is not null
  and e.due_closed_at is null
  and p.archived_at is null;

comment on view pawpages_due_items is
  'Feeds the home-screen ledger and each pet''s "needs attention" panel. '
  'Archived pets are excluded here so no screen has to remember to.';


-- ============================================================================
-- row level security
-- ============================================================================
-- A handler can only ever reach their own rows, enforced by Postgres rather
-- than by remembering to add a WHERE clause.

alter table pawpages_handlers enable row level security;
alter table pawpages_pets     enable row level security;
alter table pawpages_entries  enable row level security;

create policy pawpages_handler_reads_self on pawpages_handlers
  for select to authenticated using (id = (select auth.uid()));

create policy pawpages_handler_updates_self on pawpages_handlers
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy pawpages_handler_owns_pets on pawpages_pets
  for all to authenticated
  using (handler_id = (select auth.uid()))
  with check (handler_id = (select auth.uid()));

create policy pawpages_handler_owns_entries on pawpages_entries
  for all to authenticated
  using (exists (
    select 1 from pawpages_pets p
    where p.id = pawpages_entries.pet_id and p.handler_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from pawpages_pets p
    where p.id = pawpages_entries.pet_id and p.handler_id = (select auth.uid())
  ));

-- No delete policy on pawpages_handlers: account deletion happens through
-- auth.users, and cascades down through pawpages_handlers → pawpages_pets →
-- pawpages_entries.


-- ============================================================================
-- the public pet page
-- ============================================================================
-- Anonymous visitors never touch the tables. They read two views that expose
-- only the safe columns, so "notes are never public" is a fact about the
-- database rather than a promise the frontend makes.
--
-- These run with the owner's privileges (security_invoker off), which is the
-- point — the view is the gate.

create view pawpages_public_pets as
select
  p.slug,
  p.name,
  p.species,
  p.breed,
  p.colour,
  p.sex,
  p.photo_path,
  -- coarsened on purpose: month and year, plus a pre-computed age.
  -- The exact date never leaves the table.
  to_char(p.date_of_birth, 'Mon YYYY')                  as born,
  extract(year  from age(p.date_of_birth))::int         as age_years,
  extract(month from age(p.date_of_birth))::int         as age_months,
  p.updated_at
from pawpages_pets p
where p.is_public
  and p.archived_at is null;

create view pawpages_public_entries as
select
  p.slug,
  e.title,
  e.happened_on,
  e.due_on
  -- deliberately absent: note, vet, due_closed_at, ids
from pawpages_entries e
join pawpages_pets p on p.id = e.pet_id
where p.is_public
  and p.archived_at is null;

revoke all on pawpages_public_pets, pawpages_public_entries from public;
grant select on pawpages_public_pets, pawpages_public_entries to anon, authenticated;


-- ============================================================================
-- updated_at
-- ============================================================================

create function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pawpages_handlers_touch before update on pawpages_handlers
  for each row execute function touch_updated_at();
create trigger pawpages_pets_touch before update on pawpages_pets
  for each row execute function touch_updated_at();
create trigger pawpages_entries_touch before update on pawpages_entries
  for each row execute function touch_updated_at();
