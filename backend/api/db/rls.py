"""The load-bearing per-request dependency: a connection scoped to the
caller for the lifetime of one request.

Opens a transaction, drops to the `authenticated` role and sets
`request.jwt.claims`, so `auth.uid()` resolves inside Postgres and every RLS
policy fires exactly as it would for a browser talking to PostgREST. A route
depends on this instead of `get_current_handler` directly whenever it touches
`pawpages_*` tables -- never a hand-rolled `where handler_id = ...` as the
security boundary.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import asyncpg
from fastapi import Depends

from auth.dependencies import AuthenticatedHandler, get_current_handler

from .pool import get_pool


async def rls_connection(
    handler: AuthenticatedHandler = Depends(get_current_handler),
) -> AsyncIterator[asyncpg.Connection]:
    claims = json.dumps({"sub": handler.id, "role": "authenticated"})
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("set local role authenticated")
            await conn.execute("select set_config('request.jwt.claims', $1, true)", claims)
            yield conn
