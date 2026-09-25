"""The one asyncpg pool for the process, created at startup and closed at
shutdown -- see main.py. Everything else acquires a connection from it.
"""

from __future__ import annotations

import asyncpg

from core.config import get_settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(dsn=get_settings().database_url)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("database pool not initialised -- call init_pool() on startup")
    return _pool
