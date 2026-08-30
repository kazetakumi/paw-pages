import httpx


class AuthError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message

    @property
    def is_email_taken(self) -> bool:
        return "already registered" in self.message.lower()


async def _send(client: httpx.AsyncClient, method: str, path: str, **kwargs) -> dict:
    response = await client.request(method, path, **kwargs)
    body = response.json()
    if response.is_success:
        return body
    raise AuthError(response.status_code, body.get("msg") or body.get("error_description") or
                    body.get("error") or "Supabase Auth rejected the request.")


async def sign_up(client: httpx.AsyncClient, name: str, email: str, password: str) -> dict:
    return await _send(
        client,
        "POST",
        "/auth/v1/signup",
        json={"email": email, "password": password, "data": {"name": name}},
    )


async def sign_in(client: httpx.AsyncClient, email: str, password: str) -> dict:
    return await _send(
        client,
        "POST",
        "/auth/v1/token",
        params={"grant_type": "password"},
        json={"email": email, "password": password},
    )


async def refresh(client: httpx.AsyncClient, refresh_token: str) -> dict:
    return await _send(
        client,
        "POST",
        "/auth/v1/token",
        params={"grant_type": "refresh_token"},
        json={"refresh_token": refresh_token},
    )


async def request_password_reset(
    client: httpx.AsyncClient, email: str, redirect_to: str
) -> dict:
    """`redirect_to` is where the emailed link lands, so it must be allow-listed
    under Authentication -> URL Configuration in the Supabase dashboard."""
    return await _send(
        client,
        "POST",
        "/auth/v1/recover",
        params={"redirect_to": redirect_to},
        json={"email": email},
    )


async def update_user(client: httpx.AsyncClient, access_token: str, changes: dict) -> dict:
    """Change the email or the password of whoever the token says they are.

    The token is always a user's own — the recovery token the emailed link
    carried, or the handler's live session token from the account screen.
    Never a service key: changing your own credentials is not an admin act.
    """
    return await _send(
        client,
        "PUT",
        "/auth/v1/user",
        json=changes,
        headers={"Authorization": f"Bearer {access_token}"},
    )
