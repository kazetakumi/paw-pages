"""Supabase Auth, stubbed at the HTTP boundary.

The one external thing the API tests stub. It stands in for Supabase Auth, so
like the real thing it writes the row in `auth.users` â€” which is what fires the
`on_auth_user_created` trigger. It does not check passwords: credential
handling is Supabase Auth's job and is deliberately not tested.
"""

import base64
import json
import secrets
import time

import asyncpg
import httpx

from uuid import UUID


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


def _sub(token: str) -> UUID | None:
    """The user a session token says it is, or None if it says nothing."""
    try:
        payload = token.split(".")[1]
        return UUID(json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"])
    except Exception:
        return None


class SupabaseAuthStub(httpx.AsyncBaseTransport):
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool
        self.access_token_lifetime = 3600
        # Email-enumeration protection: a repeat signup comes back 200 with a
        # decoy user that has no identities, instead of an error.
        self.hide_existing_users = False
        # What the emailed link would carry, and what the reset wrote.
        self.recovery_tokens: dict[str, str] = {}
        self.recovery_redirect: str | None = None
        self.passwords: dict[str, str] = {}
        # (method, path, bearer) for every call made, oldest first — which is
        # how a test shows what token this service was ever spoken to with.
        self.calls: list[tuple[str, str, str]] = []
        self._refresh_tokens: dict[str, tuple[str, str]] = {}

    def forget_refresh_tokens(self) -> None:
        self._refresh_tokens.clear()

    def reset(self) -> None:
        self.forget_refresh_tokens()
        self.recovery_tokens.clear()
        self.recovery_redirect = None
        self.passwords.clear()
        self.calls.clear()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        self.calls.append(
            (
                request.method,
                request.url.path,
                request.headers.get("authorization", "").removeprefix("Bearer "),
            )
        )
        if request.url.path == "/auth/v1/recover":
            return await self._recover(request, body)
        if request.url.path == "/auth/v1/user" and request.method == "PUT":
            return await self._update_user(request, body)
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
                if self.hide_existing_users:
                    return httpx.Response(
                        200, json={"user": {"id": str(existing), "identities": []}}
                    )
                return httpx.Response(400, json={"msg": "User already registered"})
            user_id = await conn.fetchval(
                "insert into auth.users (email, raw_user_meta_data) values ($1, $2)"
                " returning id",
                body["email"],
                json.dumps(body.get("data") or {}),
            )
        return self._session(str(user_id), body["email"])

    async def _recover(self, request: httpx.Request, body: dict) -> httpx.Response:
        self.recovery_redirect = request.url.params.get("redirect_to")
        async with self.pool.acquire() as conn:
            user_id = await conn.fetchval(
                "select id from auth.users where email = $1", body["email"]
            )
        # Always 200, registered or not: Supabase does not confirm who exists.
        if user_id is not None:
            self.recovery_tokens[body["email"]] = _mint(str(user_id), body["email"], 3600)
        return httpx.Response(200, json={})

    async def _update_user(self, request: httpx.Request, body: dict) -> httpx.Response:
        """The one endpoint that changes a user, spoken to with a user's token.

        Either the recovery token the emailed link carried, or the handler's
        own live session token from the account screen. Never a service key:
        this endpoint has no idea one exists.
        """
        if "password" in body and len(body["password"]) < 6:
            return httpx.Response(
                422, json={"msg": "Password should be at least 6 characters."}
            )
        bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
        for email, token in self.recovery_tokens.items():
            if token == bearer:
                self.passwords[email] = body["password"]
                return httpx.Response(200, json={"email": email})

        user_id = _sub(bearer)
        if user_id is None:
            return httpx.Response(401, json={"msg": "invalid claim: missing sub claim"})
        async with self.pool.acquire() as conn:
            email = await conn.fetchval("select email from auth.users where id = $1", user_id)
            if email is None:
                return httpx.Response(401, json={"msg": "invalid claim: missing sub claim"})
            if "email" in body:
                taken = await conn.fetchval(
                    "select 1 from auth.users where email = $1 and id <> $2", body["email"], user_id
                )
                if taken:
                    return httpx.Response(
                        422,
                        json={"msg": "A user with this email address has already been registered"},
                    )
                await conn.execute(
                    "update auth.users set email = $1 where id = $2", body["email"], user_id
                )
                email = body["email"]
        if "password" in body:
            self.passwords[email] = body["password"]
        return httpx.Response(200, json={"id": str(user_id), "email": email})

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
