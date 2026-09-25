"""Sealing the Supabase token pair into an opaque, tamper-proof cookie value.

The cookie's value is never a raw Supabase token -- it's this encrypted
blob. Only this backend, holding COOKIE_SECRET, can open it.
"""

from __future__ import annotations

import json
import logging

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

logger = logging.getLogger(__name__)


class SessionCookieError(Exception):
    """Cookie is missing, malformed, or has been tampered with."""


def _fernet() -> Fernet:
    return Fernet(get_settings().cookie_secret.encode())


def seal_session(access_token: str, refresh_token: str) -> str:
    payload = json.dumps({"access_token": access_token, "refresh_token": refresh_token})
    return _fernet().encrypt(payload.encode()).decode()


def open_session(sealed: str) -> tuple[str, str]:
    try:
        raw = _fernet().decrypt(sealed.encode())
    except InvalidToken as exc:
        logger.warning("Session cookie failed decryption (invalid or tampered)")
        raise SessionCookieError("session cookie is invalid or has been tampered with") from exc

    try:
        data = json.loads(raw)
        return data["access_token"], data["refresh_token"]
    except (ValueError, KeyError) as exc:
        logger.warning("Session cookie decrypted but payload was malformed")
        raise SessionCookieError("session cookie payload is malformed") from exc
