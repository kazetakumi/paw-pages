"""Supabase Auth, stubbed at the HTTP boundary.

The one external thing the API tests stub. It stands in for Supabase Auth, so
like the real thing it writes the row in `auth.users` — which is what fires the
`on_auth_user_created` trigger. It does not check passwords: credential
handling is Supabase Auth's job and is deliberately not tested.
"""

import base64
import json
import secrets
import time

import asyncpg
import httpx


def _b64(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()


def _mint(user_id: str, email: str, lifetime_seconds: int) -> str:
    now = int(time.time())
    header = _b64({"alg": "HS256", "typ": "JWT"})
    claims = _b64(
        {
            "sub": user_id,
            "email": email,
            "role": "authenticated",
            "aud": "authenticated",
            "iat": now,
            "exp": now + lifetime_seconds,
        }
    )
    return f"{header}.{claims}.{secrets.token_urlsafe(24)}"


class SupabaseAuthStub(httpx.AsyncBaseTransport):
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool
        self.access_token_lifetime = 3600
        self._refresh_tokens: dict[str, tuple[str, str]] = {}

    def forget_refresh_tokens(self) -> None:
        self._refresh_tokens.clear()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        if request.url.path == "/auth/v1/signup":
            return await self._signup(body)
        if request.url.path == "/auth/v1/token":
            grant = request.url.params.get("grant_type")
            if grant == "password":
                return await self._password(body)
            if grant == "refresh_token":
                return self._refresh(body)
        raise AssertionError(f"unexpected Supabase Auth call: {request.url}")

    async def _signup(self, body: dict) -> httpx.Response:
        async with self.pool.acquire() as conn:
            existing = await conn.fetchval(
                "select id from auth.users where email = $1", body["email"]
            )
            if existing:
                return httpx.Response(400, json={"msg": "User already registered"})
            user_id = await conn.fetchval(
                "insert into auth.users (email, raw_user_meta_data) values ($1, $2)"
                " returning id",
                body["email"],
                json.dumps(body.get("data") or {}),
            )
        return self._session(str(user_id), body["email"])

    async def _password(self, body: dict) -> httpx.Response:
        async with self.pool.acquire() as conn:
            user_id = await conn.fetchval(
                "select id from auth.users where email = $1", body["email"]
            )
        if user_id is None:
            return httpx.Response(400, json={"msg": "Invalid login credentials"})
        return self._session(str(user_id), body["email"])

    def _refresh(self, body: dict) -> httpx.Response:
        known = self._refresh_tokens.get(body.get("refresh_token", ""))
        if known is None:
            return httpx.Response(400, json={"msg": "Invalid Refresh Token"})
        # A refresh always mints a live access token, whatever the last one did.
        user_id, email = known
        return self._session(user_id, email, lifetime=3600)

    def _session(self, user_id: str, email: str, lifetime: int | None = None) -> httpx.Response:
        refresh_token = secrets.token_urlsafe(16)
        self._refresh_tokens[refresh_token] = (user_id, email)
        return httpx.Response(
            200,
            json={
                "access_token": _mint(
                    user_id, email, self.access_token_lifetime if lifetime is None else lifetime
                ),
                "refresh_token": refresh_token,
                "token_type": "bearer",
                "user": {"id": user_id, "email": email},
            },
        )
