"""Thin async client for the Supabase Auth (GoTrue) REST API.

We talk to this API directly with httpx instead of using supabase-py's
bundled GoTrue client. That client keeps the current session in shared,
mutable instance state (`self._storage`) -- it's built for a single
browser tab or script, not a stateless server juggling many users'
tokens concurrently. Every function here instead takes whatever token
it needs as an explicit argument and holds no state of its own.
"""

from __future__ import annotations

import logging

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)


class GoTrueError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


def _client() -> httpx.AsyncClient:
    settings = get_settings()
    return httpx.AsyncClient(
        base_url=f"{settings.supabase_url}/auth/v1",
        headers={"apikey": settings.supabase_anon_key},
        timeout=10.0,
    )


def _unwrap(resp: httpx.Response) -> dict:
    if resp.status_code >= 400:
        try:
            body = resp.json()
        except ValueError:
            body = {}
        message = (
            body.get("msg") or body.get("error_description") or body.get("message") or resp.text or "auth request failed"
        )
        logger.warning(
            "GoTrue %s %s failed: %s %s", resp.request.method, resp.request.url.path, resp.status_code, message
        )
        raise GoTrueError(resp.status_code, message)
    return resp.json() if resp.content else {}


async def sign_up(email: str, password: str, name: str | None) -> dict:
    # Key must be "name" -- the on_auth_user_created trigger
    # (handle_new_user() in 0001_init.sql) reads raw_user_meta_data ->> 'name'.
    data = {"name": name} if name else {}
    async with _client() as client:
        resp = await client.post("/signup", json={"email": email, "password": password, "data": data})
    return _unwrap(resp)


async def sign_in_with_password(email: str, password: str) -> dict:
    async with _client() as client:
        resp = await client.post("/token", params={"grant_type": "password"}, json={"email": email, "password": password})
    return _unwrap(resp)


async def refresh_session(refresh_token: str) -> dict:
    async with _client() as client:
        resp = await client.post("/token", params={"grant_type": "refresh_token"}, json={"refresh_token": refresh_token})
    return _unwrap(resp)


async def get_user(access_token: str) -> dict:
    async with _client() as client:
        resp = await client.get("/user", headers={"Authorization": f"Bearer {access_token}"})
    return _unwrap(resp)


async def sign_out(access_token: str) -> None:
    async with _client() as client:
        resp = await client.post(
            "/logout",
            params={"scope": "global"},
            headers={"Authorization": f"Bearer {access_token}"},
            json={},
        )
    _unwrap(resp)


async def send_password_recovery(email: str, redirect_to: str) -> None:
    async with _client() as client:
        resp = await client.post("/recover", params={"redirect_to": redirect_to}, json={"email": email})
    _unwrap(resp)


async def update_password(access_token: str, new_password: str) -> dict:
    async with _client() as client:
        resp = await client.put(
            "/user",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"password": new_password},
        )
    return _unwrap(resp)


async def update_email(access_token: str, new_email: str) -> dict:
    async with _client() as client:
        resp = await client.put(
            "/user",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"email": new_email},
        )
    return _unwrap(resp)


async def admin_delete_user(user_id: str, service_role_key: str) -> None:
    """The one call no handler's own token can make. The service-role key
    rides on this request only -- never on _client()."""
    settings = get_settings()
    async with httpx.AsyncClient(base_url=f"{settings.supabase_url}/auth/v1", timeout=10.0) as client:
        resp = await client.delete(
            f"/admin/users/{user_id}",
            headers={"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"},
        )
    _unwrap(resp)
