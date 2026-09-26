# Paw Pages

A web app where a handler keeps a written record for each of their pets. Read
`CONTEXT.md` before writing any code; `dbschema/` holds the schema reference
and `design/v2/` the screens.

```
backend/api/   FastAPI + asyncpg, managed by uv
backend/agent/ the chat/AI loop, imported by backend/api
web/            Vite + React + TypeScript
supabase/       the migrations — read-only
```

## Running the tests

### Backend

No test suite yet for `backend/api` or `backend/agent` — v1's pytest suite
against a real Postgres, and its `scripts/production_smoke.py`, were not
carried over into the v2 rebuild. Verify backend changes by hand against the
live project for now (see "Running the app" below); a real test seam is a
follow-up, not yet built.

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
uv run start.py
```

Starts both from the repo root. Or run them separately:

```
cd backend/api && uv run uvicorn main:app --reload   # http://localhost:8000
cd web          && npm run dev                       # http://localhost:5173
```

The dev server proxies `/api/*` to the backend, so the browser only ever talks
to one origin. Copy `backend/api/.env.example` to `backend/api/.env` and fill
it in; `.env` is gitignored.

## Two settings to change in the Supabase dashboard

The `kaze-master-in` project has **email confirmation on**. With it on,
`POST /auth/v1/signup` returns a user and a `confirmation_sent_at` but no
session, so signing up against the live project cannot sign anyone in and
`POST /auth/signup` answers 502 rather than 201. Turn it off under
**Authentication -> Sign In / Providers -> Email -> Confirm email**.

While you are there, add `http://localhost:5173/reset-password` to
**Authentication -> URL Configuration -> Redirect URLs**: the backend asks
Supabase Auth to send the reset link back there (`FRONTEND_URL` in `.env`), and
Supabase drops any redirect that is not allow-listed. Both are dashboard
settings; neither is in this repo.

Account deletion (`DELETE /me`, and the service-role key it needs) hasn't been
rebuilt for v2 yet -- nothing here to set up for it until it exists.
