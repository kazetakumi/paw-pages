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

from .pool import get_anon_pool, get_pool


async def rls_connection(
    handler: AuthenticatedHandler = Depends(get_current_handler),
) -> AsyncIterator[asyncpg.Connection]:
    claims = json.dumps({"sub": handler.id, "role": "authenticated"})
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # One round trip for both, the way PostgREST does it: the
            # database is far enough away that each statement costs ~0.4s.
            await conn.execute(
                "select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)",
                claims,
            )
            yield conn


async def anon_connection() -> AsyncIterator[asyncpg.Connection]:
    """A visitor's connection: no cookie, no claims. `anon` has no policy on
    pawpages_pets or pawpages_entries, so the only rows it can reach are the
    ones pawpages_public_pets and pawpages_public_entries hand over. No
    transaction: every visitor route is a single statement."""
    async with get_anon_pool().acquire() as conn:
        yield conn
