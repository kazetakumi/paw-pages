"""The one asyncpg pool for the process, created at startup and closed at
shutdown -- see main.py. Everything else acquires a connection from it.
"""

from __future__ import annotations

import asyncpg

from core.config import get_settings

_pool: asyncpg.Pool | None = None
# Connections that are `anon` from the moment they open, for visitors, so a
# visitor's query is one round trip with no transaction to set the role in.
# RESET ALL doesn't touch the role, so release runs RESET ROLE instead, which
# goes back to the startup value -- anything that changed it can't outlive
# the request.
_anon_pool: asyncpg.Pool | None = None


async def _back_to_anon(conn: asyncpg.Connection) -> None:
    await conn.execute("reset role")


async def init_pool() -> None:
    global _pool, _anon_pool
    dsn = get_settings().database_url
    _pool = await asyncpg.create_pool(dsn=dsn)
    _anon_pool = await asyncpg.create_pool(
        dsn=dsn, min_size=1, max_size=5, server_settings={"role": "anon"}, reset=_back_to_anon
    )


async def close_pool() -> None:
    global _pool, _anon_pool
    for pool in (_pool, _anon_pool):
        if pool is not None:
            await pool.close()
    _pool = _anon_pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("database pool not initialised -- call init_pool() on startup")
    return _pool


def get_anon_pool() -> asyncpg.Pool:
    if _anon_pool is None:
        raise RuntimeError("database pool not initialised -- call init_pool() on startup")
    return _anon_pool
