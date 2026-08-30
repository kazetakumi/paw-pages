import httpx


class AuthError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message

    @property
    def is_email_taken(self) -> bool:
        return "already registered" in self.message.lower()


async def _post(client: httpx.AsyncClient, path: str, **kwargs) -> dict:
    response = await client.post(path, **kwargs)
    body = response.json()
    if response.is_success:
        return body
    raise AuthError(response.status_code, body.get("msg") or body.get("error_description") or
                    body.get("error") or "Supabase Auth rejected the request.")


async def sign_up(client: httpx.AsyncClient, name: str, email: str, password: str) -> dict:
    return await _post(
        client,
        "/auth/v1/signup",
        json={"email": email, "password": password, "data": {"name": name}},
    )


async def sign_in(client: httpx.AsyncClient, email: str, password: str) -> dict:
    return await _post(
        client,
        "/auth/v1/token",
        params={"grant_type": "password"},
        json={"email": email, "password": password},
    )


async def refresh(client: httpx.AsyncClient, refresh_token: str) -> dict:
    return await _post(
        client,
        "/auth/v1/token",
        params={"grant_type": "refresh_token"},
        json={"refresh_token": refresh_token},
    )
