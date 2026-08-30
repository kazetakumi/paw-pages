import os
import secrets
from pathlib import Path

# The cookie is Secure in production; the dev escape hatch in .env must not
# change what the tests prove.
os.environ["COOKIE_SECURE"] = "true"

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402

from app import main  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import anon_connection, rls_connection  # noqa: E402
from tests.supabase_admin_stub import SupabaseAdminStub  # noqa: E402
from tests.supabase_auth_stub import SupabaseAuthStub  # noqa: E402
from tests.supabase_storage_stub import SupabaseStorageStub  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
SHIM = Path(__file__).resolve().parent / "supabase_shim.sql"

# The real key was never supplied and the Admin API is stubbed anyway, so the
# tests bring their own. Nothing else may ever carry it.
SERVICE_ROLE_KEY = "service-role-key-for-tests"

ADMIN_DSN = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres"
)


@pytest.fixture(scope="session")
async def database_url():
    """A throwaway database with the shim and every migration applied."""
    name = f"paw_pages_test_{secrets.token_hex(6)}"
    admin = await asyncpg.connect(ADMIN_DSN)
    await admin.execute(f'create database "{name}"')
    await admin.close()

    dsn = ADMIN_DSN.rsplit("/", 1)[0] + "/" + name
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(SHIM.read_text())
        for migration in MIGRATIONS:
            await conn.execute(migration.read_text())
    finally:
        await conn.close()

    yield dsn

    admin = await asyncpg.connect(ADMIN_DSN)
    await admin.execute(f'drop database "{name}" with (force)')
    await admin.close()


@pytest.fixture(scope="session")
async def app(database_url):
    settings.database_url = database_url
    settings.supabase_service_role_key = SERVICE_ROLE_KEY
    async with main.lifespan(main.app):
        await main.app.state.auth_client.aclose()
        main.app.state.auth_stub = SupabaseAuthStub(main.app.state.pool)
        main.app.state.auth_client = httpx.AsyncClient(
            base_url=settings.supabase_url, transport=main.app.state.auth_stub
        )
        await main.app.state.storage_client.aclose()
        main.app.state.storage_stub = SupabaseStorageStub()
        main.app.state.storage_client = httpx.AsyncClient(
            base_url=settings.supabase_url, transport=main.app.state.storage_stub
        )
        await main.app.state.admin_client.aclose()
        main.app.state.admin_stub = SupabaseAdminStub(main.app.state.pool)
        main.app.state.admin_client = httpx.AsyncClient(
            base_url=settings.supabase_url, transport=main.app.state.admin_stub
        )
        yield main.app


@pytest.fixture
def auth_stub(app) -> SupabaseAuthStub:
    stub = app.state.auth_stub
    stub.access_token_lifetime = 3600
    stub.hide_existing_users = False
    return stub


@pytest.fixture
def storage_stub(app) -> SupabaseStorageStub:
    """What the bucket is actually holding, to assert an object came and went."""
    return app.state.storage_stub


@pytest.fixture
def admin_stub(app) -> SupabaseAdminStub:
    """The one service the service-role key is ever allowed to reach."""
    return app.state.admin_stub


@pytest.fixture(autouse=True)
async def clean_slate(app):
    yield
    app.state.auth_stub.reset()
    app.state.storage_stub.reset()
    app.state.admin_stub.reset()
    async with app.state.pool.acquire() as conn:
        await conn.execute("truncate auth.users cascade")


@pytest.fixture
async def client(app):
    async with httpx.AsyncClient(
        # https, because a Secure cookie is not sent back over plain http.
        transport=httpx.ASGITransport(app=app),
        base_url="https://api.test",
    ) as http:
        yield http


@pytest.fixture
async def seed_handler(app):
    """Insert straight into auth.users, the way Supabase Auth would.

    The `on_auth_user_created` trigger does the rest, so a seeded handler has a
    profile without this fixture knowing the `handlers` table exists.
    """

    async def _seed(name: str, email: str) -> str:
        async with app.state.pool.acquire() as conn:
            return str(
                await conn.fetchval(
                    "insert into auth.users (email, raw_user_meta_data)"
                    ' values ($1, jsonb_build_object(\'name\', $2::text)) returning id',
                    email,
                    name,
                )
            )

    return _seed


@pytest.fixture
def as_handler(app):
    """The same per-request transaction the API opens, for the RLS tests.

    Ticket 01 has no endpoint that reads pets, so the two-handler isolation is
    proved on the dependency every later endpoint will hang off.
    """

    def _as(handler_id: str):
        return rls_connection(app.state.pool, {"sub": handler_id, "role": "authenticated"})

    return _as


@pytest.fixture
def as_visitor(app):
    """The same per-request transaction `GET /public/pets/{slug}` opens.

    No claims, because a visitor has none: the public page hangs off this and
    nothing else.
    """
    return lambda: anon_connection(app.state.pool)
