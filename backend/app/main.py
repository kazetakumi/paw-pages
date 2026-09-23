from contextlib import asynccontextmanager
from uuid import UUID

import asyncpg
import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from . import (
    due,
    entries,
    export,
    handler,
    pets,
    public,
    session,
    supabase_admin,
    supabase_auth,
    supabase_storage,
)
from .config import settings
from .db import anon_connection, rls_connection


@asynccontextmanager
async def lifespan(app: FastAPI):
    # statement_cache_size=0 because Supabase's pooler runs in transaction mode:
    # a client connection maps to a different server connection between
    # transactions, so asyncpg's cached statement names collide and requests
    # fail with DuplicatePreparedStatementError. Measured against the live
    # pooler: 31 of 40 concurrent requests failed with the cache on, 0 with it
    # off. Tests never see this — they talk to Postgres directly.
    app.state.pool = await asyncpg.create_pool(settings.database_url, statement_cache_size=0)
    app.state.auth_client = httpx.AsyncClient(
        base_url=settings.supabase_url,
        headers={"apikey": settings.supabase_anon_key},
        timeout=15.0,
    )
    app.state.storage_client = httpx.AsyncClient(
        base_url=settings.supabase_url,
        headers={"apikey": settings.supabase_anon_key},
        timeout=30.0,
    )
    # No key on this client: the service-role key rides on the one request that
    # deletes an auth user and is attached to nothing else.
    app.state.admin_client = httpx.AsyncClient(base_url=settings.supabase_url, timeout=15.0)
    yield
    await app.state.admin_client.aclose()
    await app.state.storage_client.aclose()
    await app.state.auth_client.aclose()
    await app.state.pool.close()


app = FastAPI(
    title="Paw Pages",
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)


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


@app.exception_handler(supabase_storage.StorageError)
async def storage_is_unavailable(request: Request, error: Exception) -> JSONResponse:
    """Storage said no to something the policies had already allowed. That is
    ours to own, not the handler's to read a stack trace about."""
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={"detail": "The photo store did not answer. Try again."},
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


class EmailIn(BaseModel):
    email: str


class PasswordIn(BaseModel):
    password: str


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
    request.state.access_token = tokens["access_token"]
    if session.is_expired(payload):
        try:
            fresh = await supabase_auth.refresh(
                request.app.state.auth_client, tokens["refresh_token"]
            )
        except supabase_auth.AuthError:
            raise NOT_SIGNED_IN
        session.issue(response, fresh["access_token"], fresh["refresh_token"])
        payload = session.claims_of(fresh["access_token"])
        request.state.access_token = fresh["access_token"]
    return payload


async def db(request: Request, payload: dict = Depends(claims)):
    async with rls_connection(request.app.state.pool, payload) as conn:
        yield conn


async def access_token(request: Request, payload: dict = Depends(claims)) -> str:
    """The handler's own live token, for the one service asked to apply the
    policies itself: Supabase Storage. `claims` has already refreshed it."""
    return request.state.access_token


async def anon_db(request: Request):
    """The visitor's connection: no cookie, no claims, no policy of its own."""
    async with anon_connection(request.app.state.pool) as conn:
        yield conn


# Everything the account screen opens with, in one row. The two counts are
# subqueries with no `where handler_id = ...`: the same policies that filter
# `pawpages_handlers` filter `pawpages_pets` and `pawpages_entries`, so they
# can only count the caller's.
HANDLER_COLUMNS = """id, name, created_at::date as joined_on,
       date_of_birth, gender, nationality,
       extract(year from age(date_of_birth))::int as age,
       (select count(*) from pawpages_pets) as pet_count,
       (select count(*) from pawpages_entries) as entry_count"""


async def read_handler(conn: asyncpg.Connection, email: str) -> handler.HandlerOut:
    # No `where id = ...`: the pawpages_handler_reads_self policy is the filter.
    row = await conn.fetchrow(f"select {HANDLER_COLUMNS} from pawpages_handlers")
    if row is None:
        raise NOT_SIGNED_IN
    return handler.HandlerOut(**dict(row), email=email)


async def start_session(request: Request, response: Response, tokens: dict) -> handler.HandlerOut:
    if not tokens.get("access_token"):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Supabase Auth returned no session. Email confirmation is probably on.",
        )
    session.issue(response, tokens["access_token"], tokens["refresh_token"])
    async with rls_connection(
        request.app.state.pool, session.claims_of(tokens["access_token"])
    ) as conn:
        return await read_handler(conn, session.claims_of(tokens["access_token"])["email"])


@app.post("/auth/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignUpIn, request: Request, response: Response) -> handler.HandlerOut:
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
async def signin(body: SignInIn, request: Request, response: Response) -> handler.HandlerOut:
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
        await supabase_auth.update_user(
            request.app.state.auth_client, body.access_token, {"password": body.password}
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
async def me(
    conn: asyncpg.Connection = Depends(db), payload: dict = Depends(claims)
) -> handler.HandlerOut:
    return await read_handler(conn, payload["email"])


@app.patch("/me")
async def update_me(
    body: handler.HandlerPatch,
    conn: asyncpg.Connection = Depends(db),
    payload: dict = Depends(claims),
) -> handler.HandlerOut:
    """What the app calls them, and the three optional fields.

    No `where id = ...`: the pawpages_handler_updates_self policy is the filter, so the
    only row this can reach is the caller's own.
    """
    changes = body.model_dump(exclude_unset=True)
    if changes:
        assignments = ", ".join(f"{column} = ${n}" for n, column in enumerate(changes, start=1))
        try:
            await conn.execute(f"update pawpages_handlers set {assignments}", *changes.values())
        except asyncpg.IntegrityConstraintViolationError as error:
            raise pets.constraint_error(error)
    return await read_handler(conn, payload["email"])


@app.patch("/me/email")
async def update_my_email(
    body: EmailIn,
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
) -> handler.HandlerOut:
    """The address lives in auth.users, so this is Supabase Auth's to change —
    asked with the handler's own token, the way any other handler would."""
    try:
        await supabase_auth.update_user(
            request.app.state.auth_client, token, {"email": body.email}
        )
    except supabase_auth.AuthError as error:
        if error.is_email_taken:
            raise EMAIL_TAKEN
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"field": "email", "message": error.message},
        )
    # The claims in the cookie still say the old address until the token is
    # refreshed, so the new one is what this reports.
    return await read_handler(conn, body.email)


@app.patch("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def update_my_password(
    body: PasswordIn, request: Request, token: str = Depends(access_token)
) -> None:
    """A password can be rotated whenever a handler thinks it is compromised."""
    try:
        await supabase_auth.update_user(
            request.app.state.auth_client, token, {"password": body.password}
        )
    except supabase_auth.AuthError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"field": "password", "message": error.message},
        )


@app.get("/me/export")
async def export_account(
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
    payload: dict = Depends(claims),
) -> StreamingResponse:
    """Everything the handler has entered, as one file they can keep.

    Built while they wait and streamed out. The photos are read with the
    handler's own token, so the same policies that serve them on a pet's page
    are what allow them into the archive.
    """
    account = (await read_handler(conn, payload["email"])).model_dump()
    pets_rows = [dict(row) for row in await conn.fetch(export.PETS)]
    entry_rows = [dict(row) for row in await conn.fetch(export.ENTRIES)]

    photos: dict[str, bytes] = {}
    for pet in pets_rows:
        if pet["photo_path"]:
            found = await supabase_storage.download(
                request.app.state.storage_client, token, pet["photo_path"]
            )
            if found is not None:
                photos[export.photo_name(pet["slug"], pet["photo_path"])] = found[0]
    for entry in entry_rows:
        if entry["photo_path"]:
            found = await supabase_storage.download(
                request.app.state.storage_client, token, entry["photo_path"]
            )
            if found is not None:
                photos[export.entry_photo_name(str(entry["id"]), entry["photo_path"])] = found[0]

    buffer = export.build(account, pets_rows, entry_rows, photos)
    return StreamingResponse(
        export.chunks(buffer),
        media_type="application/zip",
        headers={"content-disposition": f'attachment; filename="{export.FILENAME}"'},
    )


@app.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    request: Request,
    response: Response,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
    payload: dict = Depends(claims),
) -> None:
    """Leave, and take everything with you.

    The photos go first and the auth user second, because the foreign-key
    cascade does not reach storage: once the rows are gone nothing knows which
    objects to remove. The paths are read as the handler, the objects deleted
    with the handler's own token, and only the last call — the one no token of
    theirs can make — carries the service-role key.
    """
    supabase_admin.check_configured()
    paths = await conn.fetch(
        "select photo_path from pawpages_pets where photo_path is not null"
        " union all"
        " select photo_path from pawpages_entries where photo_path is not null"
    )
    for row in paths:
        await supabase_storage.remove(
            request.app.state.storage_client, token, row["photo_path"]
        )
    await supabase_admin.delete_user(request.app.state.admin_client, payload["sub"])
    session.clear(response)


# Everything a pet shows on any screen. `age_*` is derived by the database on
# every read rather than stored, so it cannot go stale.
PET_COLUMNS = """id, name, species, breed, sex, date_of_birth, dob_is_approx, colour, slug, is_public,
       (photo_path is not null) as has_photo,
       extract(year  from age(date_of_birth))::int as age_years,
       extract(month from age(date_of_birth))::int as age_months"""


# ----------------------------------------------------------- dashboard -----


@app.get("/dashboard")
async def dashboard(conn: asyncpg.Connection = Depends(db)) -> due.Dashboard:
    """Everything the home screen opens with, in one request.

    No `where handler_id = ...`: `pawpages_due_items` is a security_invoker view, so the
    same four policies filter it that filter the tables underneath.
    """
    ledger = await conn.fetch(due.LEDGER.format(where=""))
    cards = await conn.fetch(due.PET_CARDS.format(columns=PET_COLUMNS))
    counts = await conn.fetchrow(due.COUNTS)
    archived = await conn.fetch(due.ARCHIVED)
    return due.Dashboard(
        ledger=[due.DueItem(**dict(row)) for row in ledger],
        pets=[due.PetCard(**dict(row)) for row in cards],
        archived=[due.ArchivedPet(**dict(row)) for row in archived],
        **dict(counts),
    )


# ---------------------------------------------------------------- pets ------
# No `where handler_id = ...` anywhere below: `db` has already become the
# caller, so the pawpages_handler_owns_pets policy is the filter. A pet another handler
# owns is not forbidden, it is absent — which is a 404.

NO_SUCH_PET = HTTPException(status.HTTP_404_NOT_FOUND, "No such pet.")


@app.get("/pets")
async def list_pets(conn: asyncpg.Connection = Depends(db)) -> list[pets.PetOut]:
    rows = await conn.fetch(
        f"select {PET_COLUMNS} from pawpages_pets where archived_at is null order by created_at"
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
                f"insert into pawpages_pets (handler_id, slug, {columns})"
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
async def read_pet(pet_id: UUID, conn: asyncpg.Connection = Depends(db)) -> due.PetRecord:
    row = await conn.fetchrow(f"select {PET_COLUMNS} from pawpages_pets where id = $1", pet_id)
    if row is None:
        raise NO_SUCH_PET
    # The same view the home ledger reads, so the two cannot disagree.
    outstanding = await conn.fetch(due.LEDGER.format(where="where d.pet_id = $1"), pet_id)
    return due.PetRecord(
        **dict(row), due_items=[due.DueItem(**dict(item)) for item in outstanding]
    )


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
            f"update pawpages_pets set {assignments} where id = $1 returning {PET_COLUMNS}",
            pet_id,
            *changes.values(),
        )
    except asyncpg.IntegrityConstraintViolationError as error:
        raise pets.constraint_error(error)
    if row is None:
        raise NO_SUCH_PET
    return pets.PetOut(**dict(row))


@app.post("/pets/{pet_id}/archive")
async def archive_pet(
    pet_id: UUID, body: pets.ArchiveIn, conn: asyncpg.Connection = Depends(db)
) -> pets.PetOut:
    """Stop tracking a pet without losing it.

    Two columns, and nothing else: `pawpages_due_items`, `pawpages_public_pets`
    and `pawpages_public_entries` all carry `archived_at is null`, so the
    ledger empties and the public page goes dark on this one update. The
    entries and the photo are not touched — archiving is not a soft delete.
    """
    row = await conn.fetchrow(
        f"update pawpages_pets set archived_at = now(), archived_reason = $2"
        f" where id = $1 returning {PET_COLUMNS}",
        pet_id,
        body.reason,
    )
    if row is None:
        raise NO_SUCH_PET
    return pets.PetOut(**dict(row))


@app.post("/pets/{pet_id}/restore")
async def restore_pet(pet_id: UUID, conn: asyncpg.Connection = Depends(db)) -> pets.PetOut:
    """Undo it. Both columns clear together, and everything the views hid comes
    back with them — same slug, same entries, same photo."""
    row = await conn.fetchrow(
        f"update pawpages_pets set archived_at = null, archived_reason = null"
        f" where id = $1 returning {PET_COLUMNS}",
        pet_id,
    )
    if row is None:
        raise NO_SUCH_PET
    return pets.PetOut(**dict(row))


# ------------------------------------------------------------- entries -----
# Same story as pets: `db` has already become the caller, so the
# pawpages_handler_owns_entries policy is the filter and another handler's
# entry is absent rather than forbidden.

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
        "update pawpages_entries set due_closed_at = now()"
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
            f"insert into pawpages_entries ({columns}) values ({values}) returning id",
            *fields.values(),
        )
    except asyncpg.IntegrityConstraintViolationError as error:
        raise entries.constraint_error(error)
    except asyncpg.InsufficientPrivilegeError:
        # The insert check on pawpages_handler_owns_entries: that pet is not theirs.
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
            f"update pawpages_entries set {assignments} where id = $1 returning id",
            entry_id,
            *changes.values(),
        )
    except asyncpg.IntegrityConstraintViolationError as error:
        raise entries.constraint_error(error)
    if touched is None:
        raise NO_SUCH_ENTRY
    return await read_entry(entry_id, conn)


@app.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: UUID,
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
) -> None:
    """Delete the row, then the object it pointed at.

    The row goes first so a storage failure cannot leave an entry the handler
    cannot get rid of. That trades a possible orphan for a delete that always
    works, which is the right way round: nothing here ever shows an object the
    database has stopped naming.
    """
    # `returning photo_path` alone cannot tell "no such entry" from "an entry
    # with no photo" — both are null. The id says which one happened.
    row = await conn.fetchrow(
        "delete from pawpages_entries where id = $1 returning id, photo_path", entry_id
    )
    if row is None:
        raise NO_SUCH_ENTRY
    if row["photo_path"]:
        await supabase_storage.remove(
            request.app.state.storage_client, token, row["photo_path"]
        )


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
        "  select distinct on (title) title, happened_on, id from pawpages_entries"
        "  order by title, happened_on desc, id desc"
        ") used order by used.happened_on desc, used.id desc limit 4"
    )
    return [row["title"] for row in rows]


# -------------------------------------------------------------- public -----

# The one answer to a slug that is absent, private or archived alike. All three
# are simply a row `pawpages_public_pets` does not return, so nothing here has
# to work at telling them apart — there is only ever one branch to take.
NO_SUCH_PAGE = HTTPException(status.HTTP_404_NOT_FOUND, "No such page.")


@app.get("/public/pets/{slug}")
async def public_page(slug: str, conn: asyncpg.Connection = Depends(anon_db)) -> public.PublicPet:
    """One pet as a visitor sees it. Unauthenticated, and read as `anon`.

    Both views are read on the one connection inside `anon_db`'s transaction,
    so the entries always belong to the pet that was found.
    """
    pet = await conn.fetchrow(public.PET, slug)
    if pet is None:
        raise NO_SUCH_PAGE
    rows = await conn.fetch(public.ENTRIES, slug)
    return public.PublicPet(**dict(pet), entries=[public.PublicEntry(**dict(r)) for r in rows])


# -------------------------------------------------------------- photos -----
# One profile photo per pet, streamed by these four routes out of the private
# bucket. No signed URL is ever minted and no Supabase domain ever reaches the
# browser. The owner's routes read with the handler's own token, so the four
# owner policies in migration 0003 apply; the visitor's route reads as `anon`,
# so the public-read policy does. Switching a page off or archiving a pet stops
# the image resolving at the same instant the page goes dark, and nothing here
# holds the two in step.

NO_SUCH_PHOTO = HTTPException(status.HTTP_404_NOT_FOUND, "No such photo.")


async def stream_photo(request: Request, token: str, path: str, missing: HTTPException) -> Response:
    found = await supabase_storage.download(request.app.state.storage_client, token, path)
    if found is None:
        raise missing
    content, content_type = found
    # The path behind this URL changes on every replacement, so the one thing
    # a cache must not do is answer for it.
    return Response(content, media_type=content_type, headers={"cache-control": "no-store"})


@app.put("/pets/{pet_id}/photo")
async def put_photo(
    pet_id: UUID,
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
) -> pets.PetOut:
    """Upload a photo, or replace the one already there.

    Upload, then point the row at it, then delete what it replaced — in that
    order, so a failure anywhere leaves the pet with a photo that resolves.
    """
    content = await request.body()
    content_type = supabase_storage.check(request.headers.get("content-type"), len(content))

    previous = await conn.fetchrow("select photo_path from pawpages_pets where id = $1", pet_id)
    if previous is None:
        raise NO_SUCH_PET

    path = supabase_storage.path_for(pet_id, content_type)
    client = request.app.state.storage_client
    await supabase_storage.upload(client, token, path, content, content_type)
    row = await conn.fetchrow(
        f"update pawpages_pets set photo_path = $2 where id = $1 returning {PET_COLUMNS}",
        pet_id,
        path,
    )
    # The foreign key cascade does not reach storage and there is no cleanup
    # job, so the object it replaced is deleted here or never.
    if previous["photo_path"]:
        await supabase_storage.remove(client, token, previous["photo_path"])
    return pets.PetOut(**dict(row))


@app.delete("/pets/{pet_id}/photo")
async def delete_photo(
    pet_id: UUID,
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
) -> pets.PetOut:
    """Take the photo away, object and all, and fall back to the initial."""
    previous = await conn.fetchrow("select photo_path from pawpages_pets where id = $1", pet_id)
    if previous is None:
        raise NO_SUCH_PET
    row = await conn.fetchrow(
        f"update pawpages_pets set photo_path = null where id = $1 returning {PET_COLUMNS}",
        pet_id,
    )
    if previous["photo_path"]:
        await supabase_storage.remove(
            request.app.state.storage_client, token, previous["photo_path"]
        )
    return pets.PetOut(**dict(row))


@app.get("/pets/{pet_id}/photo")
async def read_photo(
    pet_id: UUID,
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
) -> Response:
    path = await conn.fetchval("select photo_path from pawpages_pets where id = $1", pet_id)
    if path is None:
        raise NO_SUCH_PHOTO
    return await stream_photo(request, token, path, NO_SUCH_PHOTO)


NO_SUCH_ENTRY_PHOTO = HTTPException(status.HTTP_404_NOT_FOUND, "No such photo.")


async def entry_pet(entry_id: UUID, conn: asyncpg.Connection) -> UUID:
    """The pet an entry belongs to, or 404.

    RLS is the filter, so an entry under someone else's pet is simply not
    there — the same answer a missing id gets, and deliberately the same one,
    because which of the two it was is not the caller's business.
    """
    pet_id = await conn.fetchval("select pet_id from pawpages_entries where id = $1", entry_id)
    if pet_id is None:
        raise NO_SUCH_ENTRY
    return pet_id


@app.put("/entries/{entry_id}/photo")
async def put_entry_photo(
    entry_id: UUID,
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
) -> entries.EntryOut:
    """Upload a photo for an entry, or replace the one already there.

    Stored under the entry's *pet*, not the entry, because segment one of the
    path is what all four policies in 0004 key off. Same order as a pet's
    photo: upload, point the row at it, then delete what it replaced.
    """
    content = await request.body()
    content_type = supabase_storage.check(request.headers.get("content-type"), len(content))

    pet_id = await entry_pet(entry_id, conn)
    previous = await conn.fetchval(
        "select photo_path from pawpages_entries where id = $1", entry_id
    )

    path = supabase_storage.path_for(pet_id, content_type)
    client = request.app.state.storage_client
    await supabase_storage.upload(client, token, path, content, content_type)
    await conn.execute(
        "update pawpages_entries set photo_path = $2 where id = $1", entry_id, path
    )
    if previous:
        await supabase_storage.remove(client, token, previous)
    return await read_entry(entry_id, conn)


@app.delete("/entries/{entry_id}/photo")
async def delete_entry_photo(
    entry_id: UUID,
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
) -> entries.EntryOut:
    """Take the photo away, object and all. The entry itself stays."""
    await entry_pet(entry_id, conn)
    previous = await conn.fetchval(
        "select photo_path from pawpages_entries where id = $1", entry_id
    )
    await conn.execute("update pawpages_entries set photo_path = null where id = $1", entry_id)
    if previous:
        await supabase_storage.remove(request.app.state.storage_client, token, previous)
    return await read_entry(entry_id, conn)


@app.get("/entries/{entry_id}/photo")
async def read_entry_photo(
    entry_id: UUID,
    request: Request,
    conn: asyncpg.Connection = Depends(db),
    token: str = Depends(access_token),
) -> Response:
    path = await conn.fetchval("select photo_path from pawpages_entries where id = $1", entry_id)
    if path is None:
        raise NO_SUCH_ENTRY_PHOTO
    return await stream_photo(request, token, path, NO_SUCH_ENTRY_PHOTO)


@app.get("/public/pets/{slug}/entries/{entry_id}/photo")
async def public_entry_photo(
    slug: str, entry_id: UUID, request: Request, conn: asyncpg.Connection = Depends(anon_db)
) -> Response:
    """A published entry photo, read as nobody.

    `pawpages_public_entries` is the only place the path can come from, and it hands one
    over only when the handler published that photo *and* the pet is public and
    unarchived. Matching the slug as well as the id is what stops one public
    page being used to read another's.
    """
    path = await conn.fetchval(public.ENTRY_PHOTO, slug, entry_id)
    if path is None:
        raise NO_SUCH_PAGE
    return await stream_photo(request, settings.supabase_anon_key, path, NO_SUCH_PAGE)


@app.get("/public/pets/{slug}/photo")
async def public_photo(
    slug: str, request: Request, conn: asyncpg.Connection = Depends(anon_db)
) -> Response:
    """The visitor's copy of the same bytes, read as nobody.

    `pawpages_public_pets` is the only place the path can come from, and the
    anon key is the only token this carries, so a pet that is private or
    archived has no photo here for the same reason it has no page.
    """
    path = await conn.fetchval(
        "select photo_path from pawpages_public_pets where slug = $1", slug
    )
    if path is None:
        raise NO_SUCH_PAGE
    return await stream_photo(request, settings.supabase_anon_key, path, NO_SUCH_PAGE)
