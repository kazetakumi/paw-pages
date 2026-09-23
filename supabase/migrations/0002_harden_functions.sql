-- Fixes for the Supabase security linter after 0001.

-- Pin the search_path so the trigger function cannot be hijacked by a
-- role-local search_path.
create or replace function touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Neither function is meant to be called over the REST API. They are trigger
-- functions; PostgREST exposes anything executable in `public` as an RPC.
revoke execute on function handle_new_user()  from public, anon, authenticated;
revoke execute on function touch_updated_at() from public, anon, authenticated;

-- The linter still reports both public views as SECURITY DEFINER. That is the
-- design, not an oversight — recorded here so nobody "fixes" it later.
comment on view pawpages_public_pets is
  'Deliberately SECURITY DEFINER. Anonymous visitors have no policy on pets or '
  'entries, so this view is their only route in, and it exposes a fixed column '
  'list with the exact date of birth withheld. The database, not the frontend, '
  'is what keeps notes and vet names off a public URL.';

comment on view pawpages_public_entries is
  'Deliberately SECURITY DEFINER. See pawpages_public_pets. Columns note, vet, '
  'due_closed_at and all row ids are absent by construction.';
