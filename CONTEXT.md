# Paw Pages — build context

Read this before writing any code. It is the shared contract between agents so
work built across sessions still adds up to one app.

## What this is

A web app where a handler keeps a written record for each of their pets —
profile, vaccinations, and everything else worth logging — and can hand out a
public page for any one of them. It never notifies anyone, ever.

Source of truth, in order:

| Document | What it settles |
|---|---|
| `dbschema/*.html` | Schema reference, table by table, with the reasoning behind each choice |
| `design/v2/*.html` | The screens, desktop and mobile, as drawn |
| `supabase/migrations/*.sql` | The live schema. `0001`–`0004` are frozen — never edit an applied migration. `0005` onward is additive only; see rule 9. |

v1's PRD, scope doc, and ticket board are gone — v2 is a chat-first rebuild, not
a continuation of that ticket list, and nothing here should point back at it.

## Stack, fixed

- `web/` — Vite + React + TypeScript. React Router. Plain `fetch` in one API
  module. Vitest + React Testing Library + MSW.
- `backend/api/` — FastAPI + asyncpg + Pydantic v2, managed by `uv`. httpx for
  Supabase Auth calls. pytest + pytest-asyncio + httpx ASGI transport.
- Supabase is infrastructure, not a third component.

Do not add a state library, a component library, an ORM or a migration tool.

## Hard rules

1. **The browser talks only to our backend.** No Supabase client, key or domain
   reaches the browser — not for auth, not for data, not for storage, not for
   images.
2. **RLS is load-bearing.** Every authenticated request opens a transaction,
   `set local role authenticated`, sets `request.jwt.claims`, and runs under the
   four policies. Never `service_role` for application data. Never a hand-rolled
   `where handler_id = …` as the security boundary.
3. **The session is an httpOnly cookie** — `httpOnly; Secure; SameSite=Lax`.
   The backend refreshes silently. The frontend holds no token, no expiry timer,
   no refresh logic. "Am I signed in" is answered by `GET /me`.
4. **`service_role` is used for exactly one thing** — deleting the auth user on
   account deletion. Anything else it touches is a bug.
5. **Photos are proxied.** Served from our API out of the private `pet-photos`
   bucket. No signed URLs, no Supabase domain in the markup.
6. **Public requests run as `anon`** through `pawpages_public_pets` /
   `pawpages_public_entries` only, so a backend bug still cannot leak a note or
   a vet name.
7. **Dates are calendar dates**, never timestamps. The frontend formats the date
   it was given and never offsets or reinterprets one.
8. **Due and overdue are computed in the database**, in the `pawpages_due_items`
   view. Neither the backend nor the frontend reimplements them.
9. **0001–0004 are frozen. New migrations start at 0005 and are additive only.**
   Do not edit an applied migration. `0004` repaired `0003`'s five storage
   policies, every one of which denied everyone because `name` inside the
   subquery bound to `pawpages_pets.name` rather than `storage.objects.name`.
   Do not reopen that.

   Every table, view, index, named constraint and per-table trigger/policy
   carries a `pawpages_` prefix — this database hosts more than one app's
   schema side by side. The two trigger functions (`handle_new_user`,
   `touch_updated_at`) and the `on_auth_user_created` trigger on `auth.users`
   are the only exceptions.

   Additive means a new table, a new **nullable** column, or a new index —
   something the running v1 cannot observe. The backend reads explicit column
   lists everywhere (`entries.py` `ENTRY_COLUMNS`, `public.py`, `export.py`),
   never `select *`, so a new column reaches no response until someone adds it
   to a list on purpose.

   Not additive, and not to be done against the live project: editing an
   existing RLS or storage policy, altering or renaming a v1 column, adding a
   `not null` column. v1 serves live traffic from this same database and a
   policy edit applies on commit. If the work needs one of these, stop and say
   so — it needs a Supabase dev branch, not a migration.

## Domain language

Use these words in code, tests and UI. Do not invent synonyms.

- **handler** — the signed-up person. Never "user", "owner" or "account holder"
  in domain code.
- **pet** — the animal. Has one **species** (free text), an optional
  **date of birth** which may be **approximate** (`dob_is_approx`), and a
  derived **age**.
- **entry** — one thing that happened: a **title** (free text), a
  **happened_on** date, and optionally a **vet**, a **note** and a **due_on**.
  One universal shape for a rabies booster, a vet visit and a nail trim.
- **due item** — a row of `pawpages_due_items`: an entry with an open `due_on`, on an
  unarchived pet. **overdue** means `due_on < current_date` and
  `due_closed_at is null`.
- **ledger** — the cross-pet list of due items, oldest problem first.
- **mark done** — closing a due date (`due_closed_at`) without logging a new
  entry.
- **log the next one** — creating a new entry and closing the old due date in
  the same request.
- **archive** — a pet that passed away, was rehomed, or other. Keeps history and
  photo, leaves every due-date count, public page goes dark. Reversible via
  **restore**.
- **public page** — one pet at `/p/{slug}`, off by default. The **slug** is
  claimed at insert whether or not the page is public.
- **visitor** — anyone holding a public page link.

## Layout

```
backend/
  api/            FastAPI application
    auth/         session cookie, Supabase Auth (GoTrue) client, routes
    core/         config, crypto, logging
    main.py
    pyproject.toml
  agent/          the chat/AI loop -- imported by backend/api, not its own service
web/
  src/            React app
  src/routes/     one module per route
  src/test/       MSW handlers, fixtures, setup
  package.json
supabase/migrations/   0001–0004 frozen; 0005 onward additive only
```

## Routes and endpoints — unsettled for v2

The lists that used to live here (`/pets/new`, `/log`, the `/pets`/`/entries`
CRUD endpoints, …) described v1's form-based UI and REST API. v2 is a
chat-first rebuild, not a port of that surface, and its route/endpoint
contract hasn't been fully settled yet — check `design/v2/*.html` for the
screens that exist and `backend/api/*/router.py` for the endpoints actually
built so far (`auth`, `me`, `conversations` as of this writing) rather than
trusting a list here to be current. Update this section once the v2 surface
stabilizes instead of letting it drift again.

Each screen still resolves to a **desktop or a mobile layout component** at a
breakpoint — genuinely different markup, as drawn, not one tree reflowed with
CSS. Data fetching, forms and validation are shared; only the layout branches.
Both layouts are built together, not one now and one later.

Everything under `/public/` is unauthenticated. Everything else requires the
session cookie and returns 401 without it.

## Design tokens

Ink `#13202E`, ink-2 `#4E5A67`, faint `#8D97A1`, paper `#F2F3EF`, card
`#FFFFFF`, rule `#DCE0E4`, stamp `#B23A24`, current/seal `#2E6B4F`.
Archivo for display, Public Sans for body, **Space Mono for every date**.
Stamp red appears only on something overdue, at most once per screen.
The design files in `design/v2/` are the specification — match them.

## The two test seams

Only these two. Nothing below them.

**Seam 1 — the HTTP API against a real Postgres.** FastAPI's test client against
a throwaway Postgres with every migration applied, authenticated as a
seeded handler. Nothing stubbed: RLS live, views live, constraints live. The
only external thing stubbed is the Supabase Auth **HTTP client** — Supabase Auth
itself is deliberately not tested.

**Seam 2 — the screen.** React Testing Library, one test file per route, with
the API stubbed at the network boundary by MSW. Fixtures are the same JSON the
real API returns.

No test mocks the database. No test mocks a React hook. No test asserts on
component internals. No test reaches into a module that is not part of the API
or the screen. A test that breaks when nothing observable changed is a bug in
the test.

## Local test database

No backend test suite exists yet for `backend/api` (v1's was not carried into
the v2 rebuild) -- this section describes the intended fixture for when one
is built, not something running today. No Docker on this machine either way:
tests are meant to run against a local PostgreSQL 17 at `localhost:5432`
(superuser `postgres`, password `postgres`).

Because plain Postgres is not Supabase, the test fixture is meant to apply a
shim before the migrations -- v1's lived at `backend/tests/supabase_shim.sql`
and set up the minimum Supabase surface the migrations reference and nothing
more:

- roles `anon`, `authenticated`, `service_role`
- schema `auth`, table `auth.users` (id, email, raw_user_meta_data, …)
- `auth.uid()` reading `request.jwt.claims`
- schema `storage`, tables `storage.buckets` and `storage.objects` with RLS
  enabled, and `storage.foldername(text)`

Each test run creates a throwaway database, applies shim + migrations, and drops
it at the end. `DATABASE_URL` for tests comes from the environment with a
sensible default.

## Environment

`backend/api/.env` (gitignored; `.env.example` is committed):

```
SUPABASE_URL=https://hhbrylznsguxemafzgjn.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<only account deletion (DELETE /me) needs this>
DATABASE_URL=<connection string for the kaze-master project>
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
COOKIE_SECURE=false   # true in production
```

The standalone `paw-pages` Supabase project (`ywfmrpmvfcaokzavcuzx`) that
`0001`–`0004` were originally applied against is retired/inactive. The live
`pawpages_*` schema now lives inside the shared `kaze-master` project
(`hhbrylznsguxemafzgjn`), alongside other apps' tables — exactly the
multi-app-per-database shape rule 9's `pawpages_` prefix was designed for.
**It is also the live production database** — v1 serves real traffic from it,
so v1.1 shares it deliberately rather than paying for a dev branch. Apply
`0005` onward only under rule 9's additive-only limit, and never while a v1
request could be mid-flight in a way that matters. Iterate with `execute_sql`
and write the migration once the shape settles, so the applied history stays
clean.

v1.1 is developed in a separate git worktree at `D:\kaze\POCs\paw-pages-v1.1.0`
(branch `v1.1.0`). Build there, never in `D:\kaze\POCs\paw-pages` — the
`pawpages-web` service serves `web/dist` straight out of that tree, so a build
there replaces the live site the moment it finishes. Prod holds ports 8001 and
8080; run v1.1 on 8002 with `VITE_PROXY_TARGET=http://127.0.0.1:8002`.

## Working agreement

- Follow `CLAUDE.md`: least code that solves the problem, no unasked features,
  no abstraction used once.
- Work test-first, one vertical slice at a time — one test, one implementation,
  repeat. Never write all the tests first.
- Build only what's actually needed now. If something later needs it, leave
  it for then.
- Commit with a conventional prefix, one short line, no body, no co-author line.
