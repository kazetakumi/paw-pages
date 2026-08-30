# Paw Pages

A web app where a handler keeps a written record for each of their pets. Read
`CONTEXT.md` before writing any code; `docs/` holds the PRD, the scope and the
schema reference, and `board/` holds the ten tickets.

```
backend/   FastAPI + asyncpg, managed by uv
web/       Vite + React + TypeScript
supabase/  the three migrations — read-only
```

## Running the tests

### Backend — the HTTP API against a real Postgres

Tests need a local PostgreSQL 17 at `localhost:5432` (superuser `postgres`,
password `postgres`). There is no Docker here and no Supabase CLI: the fixture
creates a throwaway database per run, applies `backend/tests/supabase_shim.sql`
and then the three migrations in `supabase/migrations/` unmodified, and drops
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
live. The one exception is the Supabase Auth HTTP client, stubbed at the httpx
transport in `backend/tests/supabase_auth_stub.py`, because Supabase Auth
itself is deliberately not tested.

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
