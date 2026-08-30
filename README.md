# Paw Pages

A web app where a handler keeps a written record for each of their pets. Read
`CONTEXT.md` before writing any code; `docs/` holds the PRD, the scope and the
schema reference, and `board/` holds the ten tickets.

```
backend/   FastAPI + asyncpg, managed by uv
web/       Vite + React + TypeScript
supabase/  the four migrations — read-only
```

## Running the tests

### Backend — the HTTP API against a real Postgres

Tests need a local PostgreSQL 17 at `localhost:5432` (superuser `postgres`,
password `postgres`). There is no Docker here and no Supabase CLI: the fixture
creates a throwaway database per run, applies `backend/tests/supabase_shim.sql`
and then every migration in `supabase/migrations/` unmodified, and drops
the database at the end.

```
cd backend
uv run pytest
```

Point it somewhere else with `TEST_DATABASE_URL`, which must name a database on
the server the throwaway one is created on:

```
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres uv run pytest
```

On Windows the client binaries live in `C:\Program Files\PostgreSQL\17\bin` and
are not on `PATH`, but nothing in the test run shells out to them — the fixture
talks to Postgres with asyncpg.

Nothing else is stubbed: RLS is live, the views are live, the constraints are
live. The exceptions are the three Supabase HTTP services, each stubbed at the
httpx transport because none is ours to test: Supabase Auth in
`backend/tests/supabase_auth_stub.py`, Supabase Storage in
`backend/tests/supabase_storage_stub.py`, and the Supabase Admin API in
`backend/tests/supabase_admin_stub.py`. The storage stub really holds the
uploaded bytes, so a test can prove an object was deleted on replace, on remove
and on account deletion rather than only that a path was cleared. The admin
stub really deletes the row in `auth.users`, so the cascade down to handlers,
pets and entries is the real one.

### Web — the screen, with HTTP stubbed at the network boundary

```
cd web
npm install
npm test
```

React Testing Library renders a route and MSW answers the API calls, so the
fixtures are the same JSON the real API returns.

## Running the app

```
cd backend && uv run uvicorn app.main:app --reload   # http://localhost:8000
cd web     && npm run dev                            # http://localhost:5173
```

The dev server proxies `/api/*` to the backend, so the browser only ever talks
to one origin. Copy `backend/.env.example` to `backend/.env` and fill it in;
`.env` is gitignored.

## Two settings to change in the Supabase dashboard

The `paw-pages` project has **email confirmation on**. With it on,
`POST /auth/v1/signup` returns a user and a `confirmation_sent_at` but no
session, so signing up against the live project cannot sign anyone in and
`POST /auth/signup` answers 502 rather than 201. Turn it off under
**Authentication -> Sign In / Providers -> Email -> Confirm email**.

While you are there, add `http://localhost:5173/reset-password` to
**Authentication -> URL Configuration -> Redirect URLs**: the backend asks
Supabase Auth to send the reset link back there (`WEB_URL` in `.env`), and
Supabase drops any redirect that is not allow-listed. Both are dashboard
settings; neither is in this repo.

## One key to set before account deletion works

`DELETE /me` deletes the auth user through the Supabase Admin API, which is the
only thing the service-role key is ever used for. Put the project's
**service_role** key (Dashboard -> Project Settings -> API Keys) into
`SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`. Without it the endpoint answers
503 naming that variable and nothing is deleted — not even the photos, because
the key is checked before anything is destroyed. Everything else on the account
screen runs under the handler's own token.
