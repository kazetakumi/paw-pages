"""The asyncpg pools for the process, created at startup and closed at
shutdown -- see main.py. Everything else acquires a connection from one.

Two of them open with their role already set (a startup parameter), so a
request doesn't need a transaction just to become someone:

- anon: visitors. Each query is one round trip.
- authenticated: a signed-in handler's reads. The request sets its claims
  once, session-wide, then queries -- two round trips instead of BEGIN,
  set-up, query, COMMIT.

RESET ALL doesn't touch the role, so both release with RESET ROLE (back to
the startup value) and clear the claims. Nothing a request set can outlive
it, and a connection handed to the next handler starts as nobody in
particular: auth.uid() is null and RLS returns nothing.

Writes stay on the plain pool, inside a transaction -- see db/rls.py.
"""

from __future__ import annotations

import asyncpg

from core.config import get_settings

_pool: asyncpg.Pool | None = None
_anon_pool: asyncpg.Pool | None = None
_reader_pool: asyncpg.Pool | None = None


async def _reset_session(conn: asyncpg.Connection) -> None:
    await conn.execute("reset role; reset request.jwt.claims")


async def init_pool() -> None:
    global _pool, _anon_pool, _reader_pool
    dsn = get_settings().database_url
    _pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=5)
    _anon_pool = await asyncpg.create_pool(
        dsn=dsn, min_size=1, max_size=5, server_settings={"role": "anon"}, reset=_reset_session
    )
    _reader_pool = await asyncpg.create_pool(
        dsn=dsn, min_size=2, max_size=10, server_settings={"role": "authenticated"}, reset=_reset_session
    )


async def close_pool() -> None:
    global _pool, _anon_pool, _reader_pool
    for pool in (_pool, _anon_pool, _reader_pool):
        if pool is not None:
            await pool.close()
    _pool = _anon_pool = _reader_pool = None


def _require(pool: asyncpg.Pool | None) -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("database pool not initialised -- call init_pool() on startup")
    return pool


def get_pool() -> asyncpg.Pool:
    return _require(_pool)


def get_anon_pool() -> asyncpg.Pool:
    return _require(_anon_pool)


def get_reader_pool() -> asyncpg.Pool:
    return _require(_reader_pool)
