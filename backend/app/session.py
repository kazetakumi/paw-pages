import base64
import json
import time

from fastapi import Response
from itsdangerous import BadSignature, URLSafeSerializer

from .config import settings

COOKIE_NAME = "pp_session"
# Supabase refresh tokens outlive this; the cookie is the shorter leash.
COOKIE_MAX_AGE = 60 * 60 * 24 * 30

_serializer = URLSafeSerializer(settings.session_secret, salt="pp-session")


def issue(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        _serializer.dumps({"access_token": access_token, "refresh_token": refresh_token}),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )


def read(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        return _serializer.loads(raw)
    except BadSignature:
        return None


def claims_of(access_token: str) -> dict:
    """The access token's payload.

    Its signature is not re-checked: the token reached us over TLS from Supabase
    Auth and came back inside a cookie we signed ourselves, so the cookie's
    signature is what makes these claims trustworthy.
    """
    payload = access_token.split(".")[1]
    padded = payload + "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def is_expired(claims: dict, skew_seconds: int = 30) -> bool:
    return claims.get("exp", 0) <= time.time() + skew_seconds
