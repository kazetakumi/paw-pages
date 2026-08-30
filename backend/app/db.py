import json
from contextlib import asynccontextmanager

import asyncpg


@asynccontextmanager
async def rls_connection(pool: asyncpg.Pool, claims: dict):
    """A connection that has become the caller, for the length of one transaction.

    `auth.uid()` resolves inside this block, so all four RLS policies fire in
    Postgres. Nothing above this needs a `where handler_id = ...`, and a query
    that forgets one returns nothing rather than another handler's rows.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("set local role authenticated")
            await conn.execute(
                "select set_config('request.jwt.claims', $1, true)", json.dumps(claims)
            )
            yield conn
