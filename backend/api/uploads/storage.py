"""Thin async client for Supabase Storage's REST API, same approach as
auth/gotrue.py: httpx directly, no state, the caller's access token passed
in on every call. Calls run as the handler, never service_role, so 0008's
"own upload staging area" policies are what decide what goes through.
"""

import httpx

from core.config import get_settings

BUCKET = "pet-photos"


class StorageError(Exception):
    pass


def _client(access_token: str) -> httpx.AsyncClient:
    settings = get_settings()
    return httpx.AsyncClient(
        base_url=f"{settings.supabase_url}/storage/v1/object/{BUCKET}",
        headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {access_token}"},
        timeout=30.0,
    )


def _check(resp: httpx.Response) -> httpx.Response:
    if resp.status_code >= 400:
        raise StorageError(f"storage {resp.request.method} failed: {resp.status_code} {resp.text}")
    return resp


async def put(access_token: str, path: str, data: bytes, content_type: str) -> None:
    async with _client(access_token) as client:
        _check(await client.post(f"/{path}", content=data, headers={"Content-Type": content_type}))


async def get(access_token: str, path: str) -> bytes:
    async with _client(access_token) as client:
        return _check(await client.get(f"/authenticated/{path}")).content


async def delete(access_token: str, path: str) -> None:
    async with _client(access_token) as client:
        _check(await client.delete(f"/{path}"))
