"""`get_current_handler` -- the one dependency every protected route in every
module (db/rls.py, and future ones) is meant to depend on.

Reads the session cookie, checks the access token inside against the
project's signing key, and silently refreshes it once if it has expired. Raises 401 if
there's no valid way to identify the caller.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException, Request, Response, status

from core.config import get_settings
from core.crypto import SessionCookieError, open_session

from . import gotrue
from .cookies import clear_session_cookie, set_session_cookie

logger = logging.getLogger(__name__)


@dataclass
class AuthenticatedHandler:
    id: str
    email: str
    name: str | None
    # For calls to Supabase Storage as this handler, so storage policies
    # apply -- see uploads/storage.py.
    access_token: str


def handler_from_claims(claims: dict, access_token: str) -> AuthenticatedHandler:
    metadata = claims.get("user_metadata") or {}
    return AuthenticatedHandler(
        id=claims["sub"],
        email=claims["email"],
        name=metadata.get("name"),
        access_token=access_token,
    )


async def get_current_handler(request: Request, response: Response) -> AuthenticatedHandler:
    settings = get_settings()
    sealed = request.cookies.get(settings.cookie_name)
    if not sealed:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not signed in")

    try:
        access_token, refresh_token = open_session(sealed)
    except SessionCookieError as exc:
        logger.warning("Rejecting request: %s", exc)
        clear_session_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session invalid, please sign in again")

    try:
        claims = await gotrue.verify_access_token(access_token)
    except gotrue.GoTrueError:
        # Access token's likely expired -- use the refresh token for one
        # silent retry before giving up.
        try:
            session = await gotrue.refresh_session(refresh_token)
        except gotrue.GoTrueError as exc:
            logger.info("Silent refresh failed, session expired: %s", exc.message)
            clear_session_cookie(response)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session expired, please sign in again")

        set_session_cookie(response, session["access_token"], session["refresh_token"])
        access_token = session["access_token"]
        claims = await gotrue.verify_access_token(access_token)
        logger.info("Silently refreshed session for %s", claims.get("email"))

    return handler_from_claims(claims, access_token)

