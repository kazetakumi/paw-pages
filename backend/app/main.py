from contextlib import asynccontextmanager
from uuid import UUID

import asyncpg
import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import due, entries, pets, session, supabase_auth
from .config import settings
from .db import rls_connection


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await asyncpg.create_pool(settings.database_url)
    app.state.auth_client = httpx.AsyncClient(
        base_url=settings.supabase_url,
        headers={"apikey": settings.supabase_anon_key},
        timeout=15.0,
    )
    yield
    await app.state.auth_client.aclose()
    await app.state.pool.close()


app = FastAPI(title="Paw Pages", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def one_field_at_a_time(request: Request, error: RequestValidationError) -> JSONResponse:
    """A rejected field, shaped the way every other field error in the API is.

    The screen shows it beside the input it belongs to instead of dumping a
    list of loc/msg pairs at the handler.
    """
    first = error.errors()[0]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": {"field": str(first["loc"][-1]), "message": first["msg"]}},
    )


class SignUpIn(BaseModel):
    name: str
    email: str
    password: str


class SignInIn(BaseModel):
    email: str
    password: str


class PasswordResetIn(BaseModel):
    email: str


class PasswordResetConfirmIn(BaseModel):
    # The token the emailed link carried. It passes straight through to Supabase
    # Auth and is never stored — it is not a session and never becomes one.
    access_token: str
    password: str


class HandlerOut(BaseModel):
    id: str
    name: str


NOT_SIGNED_IN = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")

EMAIL_TAKEN = HTTPException(
    status.HTTP_409_CONFLICT,
    {"field": "email", "message": "That email already has an account. Sign in instead."},
)


async def claims(request: Request, response: Response) -> dict:
    """The caller's verified claims, refreshing the access token if it has expired.

    This is the only place a token is handled. The browser holds none of it.
    """
    tokens = session.read(request.cookies.get(session.COOKIE_NAME))
    if tokens is None:
        raise NOT_SIGNED_IN

    payload = session.claims_of(tokens["access_token"])
    if session.is_expired(payload):
        try:
            fresh = await supabase_auth.refresh(
                request.app.state.auth_client, tokens["refresh_token"]
            )
        except supabase_auth.AuthError:
            raise NOT_SIGNED_IN
        session.issue(response, fresh["access_token"], fresh["refresh_token"])
        payload = session.claims_of(fresh["access_token"])
    return payload


async def db(request: Request, payload: dict = Depends(claims)):
    async with rls_connection(request.app.state.pool, payload) as conn:
        yield conn


async def read_handler(conn: asyncpg.Connection) -> HandlerOut:
    # No `where id = ...`: the handler_reads_self policy is the filter.
    row = await conn.fetchrow("select id, name from handlers")
    if row is None:
        raise NOT_SIGNED_IN
    return HandlerOut(id=str(row["id"]), name=row["name"])


async def start_session(request: Request, response: Response, tokens: dict) -> HandlerOut:
    if not tokens.get("access_token"):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Supabase Auth returned no session. Email confirmation is probably on.",
        )
    session.issue(response, tokens["access_token"], tokens["refresh_token"])
    async with rls_connection(
        request.app.state.pool, session.claims_of(tokens["access_token"])
    ) as conn:
        return await read_handler(conn)


@app.post("/auth/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignUpIn, request: Request, response: Response) -> HandlerOut:
    try:
        tokens = await supabase_auth.sign_up(
            request.app.state.auth_client, body.name, body.email, body.password
        )
    except supabase_auth.AuthError as error:
        if error.is_email_taken:
            raise EMAIL_TAKEN
        raise HTTPException(status.HTTP_400_BAD_REQUEST, error.message)
    # With email-enumeration protection on, Supabase hides a repeat signup behind
    # a 200 carrying a decoy user with no identities rather than an error.
    if tokens.get("user", {}).get("identities") == []:
        raise EMAIL_TAKEN
    return await start_session(request, response, tokens)


@app.post("/auth/signin")
async def signin(body: SignInIn, request: Request, response: Response) -> HandlerOut:
    try:
        tokens = await supabase_auth.sign_in(
            request.app.state.auth_client, body.email, body.password
        )
    except supabase_auth.AuthError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is wrong.")
    return await start_session(request, response, tokens)


@app.post("/auth/password-reset", status_code=status.HTTP_204_NO_CONTENT)
async def password_reset(body: PasswordResetIn, request: Request) -> None:
    """Ask Supabase Auth to email a link.

    Always 204: whether an address is registered here is not ours to tell.
    """
    try:
        await supabase_auth.request_password_reset(
            request.app.state.auth_client, body.email, f"{settings.web_url}/reset-password"
        )
    except supabase_auth.AuthError:
        pass


@app.post("/auth/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
async def password_reset_confirm(body: PasswordResetConfirmIn, request: Request) -> None:
    try:
        await supabase_auth.set_password(
            request.app.state.auth_client, body.access_token, body.password
        )
    except supabase_auth.AuthError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "That reset link has expired. Request a new one."
        )


@app.post("/auth/signout", status_code=status.HTTP_204_NO_CONTENT)
async def signout(response: Response) -> None:
    """Drop the cookie. No session to check first: signing out twice is fine."""
    session.clear(response)


@app.get("/me")
async def me(conn: asyncpg.Connection = Depends(db)) -> HandlerOut:
    return await read_handler(conn)


# Everything a pet shows on any screen. `age_*` is derived by the database on
# every read rather than stored, so it cannot go stale.
PET_COLUMNS = """id, name, species, breed, sex, date_of_birth, dob_is_approx, colour, slug,
       extract(year  from age(date_of_birth))::int as age_years,
       extract(month from age(date_of_birth))::int as age_months"""


# ----------------------------------------------------------- dashboard -----


@app.get("/dashboard")
async def dashboard(conn: asyncpg.Connection = Depends(db)) -> due.Dashboard:
    """Everything the home screen opens with, in one request.

    No `where handler_id = ...`: `due_items` is a security_invoker view, so the
    same four policies filter it that filter the tables underneath.
    """
    ledger = await conn.fetch(due.LEDGER)
    cards = await conn.fetch(due.PET_CARDS.format(columns=PET_COLUMNS))
    counts = await conn.fetchrow(due.COUNTS)
    return due.Dashboard(
        ledger=[due.DueItem(**dict(row)) for row in ledger],
        pets=[due.PetCard(**dict(row)) for row in cards],
        **dict(counts),
    )


# ---------------------------------------------------------------- pets ------
# No `where handler_id = ...` anywhere below: `db` has already become the
# caller, so the handler_owns_pets policy is the filter. A pet another handler
# owns is not forbidden, it is absent — which is a 404.

NO_SUCH_PET = HTTPException(status.HTTP_404_NOT_FOUND, "No such pet.")


@app.get("/pets")
async def list_pets(conn: asyncpg.Connection = Depends(db)) -> list[pets.PetOut]:
    rows = await conn.fetch(
        f"select {PET_COLUMNS} from pets where archived_at is null order by created_at"
    )
    return [pets.PetOut(**dict(row)) for row in rows]


@app.post("/pets", status_code=status.HTTP_201_CREATED)
async def create_pet(body: pets.PetIn, conn: asyncpg.Connection = Depends(db)) -> pets.PetOut:
    fields = body.model_dump()
    columns = ", ".join(fields)
    values = ", ".join(f"${n}" for n in range(2, len(fields) + 2))

    async def insert(slug: str):
        # A savepoint per attempt: a unique violation would otherwise poison
        # the request transaction and leave nothing to retry into.
        async with conn.transaction():
            return await conn.fetchrow(
                f"insert into pets (handler_id, slug, {columns})"
                f" values ((select auth.uid()), $1, {values}) returning {PET_COLUMNS}",
                slug,
                *fields.values(),
            )

    try:
        row = await pets.claim_slug(body.name, insert)
    except asyncpg.IntegrityConstraintViolationError as error:
        raise pets.constraint_error(error)
    return pets.PetOut(**dict(row))


@app.get("/pets/{pet_id}")
async def read_pet(pet_id: UUID, conn: asyncpg.Connection = Depends(db)) -> pets.PetOut:
    row = await conn.fetchrow(f"select {PET_COLUMNS} from pets where id = $1", pet_id)
    if row is None:
        raise NO_SUCH_PET
    return pets.PetOut(**dict(row))


@app.patch("/pets/{pet_id}")
async def update_pet(
    pet_id: UUID, body: pets.PetPatch, conn: asyncpg.Connection = Depends(db)
) -> pets.PetOut:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return await read_pet(pet_id, conn)

    assignments = ", ".join(f"{column} = ${n}" for n, column in enumerate(changes, start=2))
    try:
        row = await conn.fetchrow(
            f"update pets set {assignments} where id = $1 returning {PET_COLUMNS}",
            pet_id,
            *changes.values(),
        )
    except asyncpg.IntegrityConstraintViolationError as error:
        raise pets.constraint_error(error)
    if row is None:
        raise NO_SUCH_PET
    return pets.PetOut(**dict(row))


# ------------------------------------------------------------- entries -----
# Same story as pets: `db` has already become the caller, so the
# handler_owns_entries policy is the filter and another handler's entry is
# absent rather than forbidden.

NO_SUCH_ENTRY = HTTPException(status.HTTP_404_NOT_FOUND, "No such entry.")


async def read_entry(entry_id: UUID, conn: asyncpg.Connection) -> entries.EntryOut:
    row = await conn.fetchrow(
        f"select {entries.ENTRY_COLUMNS} {entries.ENTRY_SOURCE} where e.id = $1", entry_id
    )
    if row is None:
        raise NO_SUCH_ENTRY
    return entries.EntryOut(**dict(row))


async def close_due_date(entry_id: UUID, conn: asyncpg.Connection) -> None:
    """Stop an entry's due date standing. Nothing does this automatically:
    free-text titles mean the app cannot know two entries are the same series."""
    closed = await conn.fetchval(
        "update entries set due_closed_at = now()"
        " where id = $1 and due_on is not null returning id",
        entry_id,
    )
    if closed is None:
        raise NO_SUCH_ENTRY


@app.post("/entries", status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: entries.EntryIn, conn: asyncpg.Connection = Depends(db)
) -> entries.EntryOut:
    fields = body.model_dump(exclude=entries.NOT_COLUMNS)
    columns = ", ".join(fields)
    values = ", ".join(f"${n}" for n in range(1, len(fields) + 1))
    try:
        entry_id = await conn.fetchval(
            f"insert into entries ({columns}) values ({values}) returning id", *fields.values()
        )
    except asyncpg.IntegrityConstraintViolationError as error:
        raise entries.constraint_error(error)
    except asyncpg.InsufficientPrivilegeError:
        # The insert check on handler_owns_entries: that pet is not theirs.
        raise NO_SUCH_PET
    # The request is already one transaction, so "log the next one" saves the
    # new entry and closes the old due date together or does neither.
    if body.closes_entry_id is not None:
        await close_due_date(body.closes_entry_id, conn)
    return await read_entry(entry_id, conn)


@app.get("/pets/{pet_id}/entries")
async def pet_feed(
    pet_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=5, ge=1, le=50),
    conn: asyncpg.Connection = Depends(db),
) -> entries.FeedPage:
    """One page of a pet's record, newest first.

    Keyset, not offset: the row comparison is the same (happened_on desc, id
    desc) the feed index is built on, so a page cannot gain or drop an entry
    because something older was logged between two requests.
    """
    after = entries.decode_cursor(cursor) if cursor else (None, None)
    rows = await conn.fetch(
        f"select {entries.ENTRY_COLUMNS} {entries.ENTRY_SOURCE}"
        " where e.pet_id = $1"
        "   and ($2::date is null or (e.happened_on, e.id) < ($2, $3::uuid))"
        f" {entries.FEED_ORDER} limit $4",
        pet_id,
        *after,
        limit + 1,
    )
    page = [entries.EntryOut(**dict(row)) for row in rows[:limit]]
    return entries.FeedPage(
        entries=page,
        next_cursor=entries.encode_cursor(page[-1]) if len(rows) > limit else None,
    )


@app.patch("/entries/{entry_id}")
async def update_entry(
    entry_id: UUID, body: entries.EntryPatch, conn: asyncpg.Connection = Depends(db)
) -> entries.EntryOut:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return await read_entry(entry_id, conn)

    assignments = ", ".join(f"{column} = ${n}" for n, column in enumerate(changes, start=2))
    try:
        touched = await conn.fetchval(
            f"update entries set {assignments} where id = $1 returning id",
            entry_id,
            *changes.values(),
        )
    except asyncpg.IntegrityConstraintViolationError as error:
        raise entries.constraint_error(error)
    if touched is None:
        raise NO_SUCH_ENTRY
    return await read_entry(entry_id, conn)


@app.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(entry_id: UUID, conn: asyncpg.Connection = Depends(db)) -> None:
    if await conn.fetchval("delete from entries where id = $1 returning id", entry_id) is None:
        raise NO_SUCH_ENTRY


@app.post("/entries/{entry_id}/mark-done")
async def mark_done(entry_id: UUID, conn: asyncpg.Connection = Depends(db)) -> entries.EntryOut:
    """Dealt with elsewhere: the item leaves the ledger, the entry stays."""
    await close_due_date(entry_id, conn)
    return await read_entry(entry_id, conn)


@app.get("/entry-titles/recent")
async def recent_entry_titles(conn: asyncpg.Connection = Depends(db)) -> list[str]:
    """The handler's own last titles, one of each, across all their pets.

    There is no global vocabulary here on purpose: a handler is only ever
    offered words they typed themselves.
    """
    rows = await conn.fetch(
        "select title from ("
        "  select distinct on (title) title, happened_on, id from entries"
        "  order by title, happened_on desc, id desc"
        ") used order by used.happened_on desc, used.id desc limit 4"
    )
    return [row["title"] for row in rows]
