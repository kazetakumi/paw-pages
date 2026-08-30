from contextlib import asynccontextmanager
from uuid import UUID

import asyncpg
import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import pets, session, supabase_auth
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
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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


# ---------------------------------------------------------------- pets ------
# No `where handler_id = ...` anywhere below: `db` has already become the
# caller, so the handler_owns_pets policy is the filter. A pet another handler
# owns is not forbidden, it is absent — which is a 404.

PET_COLUMNS = """id, name, species, breed, sex, date_of_birth, dob_is_approx, colour, slug,
       extract(year  from age(date_of_birth))::int as age_years,
       extract(month from age(date_of_birth))::int as age_months"""

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
