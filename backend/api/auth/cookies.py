from fastapi import Response

from core.config import get_settings
from core.crypto import seal_session

_THIRTY_DAYS = 60 * 60 * 24 * 30


def set_session_cookie(response: Response, access_token: str, refresh_token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.cookie_name,
        value=seal_session(access_token, refresh_token),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        domain=settings.cookie_domain,
        max_age=_THIRTY_DAYS,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(key=settings.cookie_name, domain=settings.cookie_domain, path="/")
