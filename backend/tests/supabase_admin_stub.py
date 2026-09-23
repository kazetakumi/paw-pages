"""The Supabase Admin API, stubbed at the HTTP boundary.

The third external service the API tests stub, and stubbed the same way as
Auth and Storage. Like the real thing it deletes the row in `auth.users`, which
is what the foreign keys cascade from: pawpages_handlers, then pawpages_pets,
then pawpages_entries. The cascade itself is the real one, in the real database.

It records the bearer of every call, which is how a test shows the service-role
key reaches this service and no other. Any path but the one it is allowed is an
assertion, so a stray admin call fails the test that made it.
"""

from uuid import UUID

import asyncpg
import httpx

PREFIX = "/auth/v1/admin/users/"


class SupabaseAdminStub(httpx.AsyncBaseTransport):
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool
        # (method, path, bearer) for every call made, oldest first.
        self.calls: list[tuple[str, str, str]] = []
        # A test hook, fired the instant before the user goes, so a test can
        # see what the bucket still held at that moment.
        self.on_delete = None

    def reset(self) -> None:
        self.calls.clear()
        self.on_delete = None

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if request.method != "DELETE" or not request.url.path.startswith(PREFIX):
            raise AssertionError(f"unexpected Supabase Admin API call: {request.url}")
        self.calls.append(
            (
                request.method,
                request.url.path,
                request.headers.get("authorization", "").removeprefix("Bearer "),
            )
        )
        if self.on_delete is not None:
            self.on_delete()
        async with self.pool.acquire() as conn:
            await conn.execute(
                "delete from auth.users where id = $1", UUID(request.url.path[len(PREFIX) :])
            )
        return httpx.Response(200, json={})
