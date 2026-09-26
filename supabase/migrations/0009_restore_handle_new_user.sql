-- Restores handle_new_user() to Paw Pages' own body from 0001_init.sql.
--
-- handle_new_user is the one shared exception rule 9 names, with no
-- pawpages_ prefix, because kaze-master's other app (resumeone) needs the
-- same on_auth_user_created trigger. Its 2026-09-22 migration
-- (prefix_tables_with_resumeone) renamed profiles to resumeone_profiles but
-- never updated this function to match, leaving it doing:
--
--   insert into public.profiles (id, full_name, email, photo_url) ...
--
-- against a table that no longer exists. Every signup on this project --
-- Paw Pages and resumeone both -- started failing with "Database error
-- saving new user" (SQLSTATE 42P01) the moment that ran.
--
-- This restores exactly what 0001 defined here. It does not fix resumeone,
-- which was already broken by its own migration before this one touched
-- anything, and does not touch on_auth_user_created, which was never the
-- problem.

create or replace function handle_new_user()
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
