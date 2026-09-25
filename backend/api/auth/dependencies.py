"""`get_current_handler` -- the one dependency every protected route in every
module (db/rls.py, and future ones) is meant to depend on.

Reads the session cookie, asks Supabase who it belongs to, and silently
refreshes it once if the access token inside has expired. Raises 401 if
there's no valid way to identify the caller.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, Response, status

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
    email_confirmed: bool
    joined_on: str


def handler_from_payload(payload: dict) -> AuthenticatedHandler:
    metadata = payload.get("user_metadata") or {}
    return AuthenticatedHandler(
        id=payload["id"],
        email=payload["email"],
        name=metadata.get("name"),
        email_confirmed=bool(payload.get("confirmed_at") or payload.get("email_confirmed_at")),
        joined_on=(payload.get("created_at") or "")[:10],
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
        payload = await gotrue.get_user(access_token)
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
        payload = session["user"]
        logger.info("Silently refreshed session for %s", payload.get("email"))

    return handler_from_payload(payload)


async def require_verified_email(
    handler: AuthenticatedHandler = Depends(get_current_handler),
) -> AuthenticatedHandler:
    if not handler.email_confirmed:
        logger.info("Blocked unverified handler %s from a verified-only route", handler.email)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "please confirm your email address to continue")
    return handler
