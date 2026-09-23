"""The Supabase Admin API, spoken to over HTTP the way Auth and Storage are.

It exists for exactly one thing: deleting the auth user on account deletion,
which is the one act no handler's own token can perform. Anything else the
service-role key touches is a bug, so the key is not on the client at all —
it is attached to this single request and nowhere else.
"""

import httpx
from fastapi import HTTPException, status

from .config import settings

NOT_CONFIGURED = HTTPException(
    status.HTTP_503_SERVICE_UNAVAILABLE,
    "Account deletion is unavailable: SUPABASE_SERVICE_ROLE_KEY is not set.",
)


def check_configured() -> None:
    """Fail before anything is destroyed rather than half way through it."""
    if not settings.supabase_service_role_key:
        raise NOT_CONFIGURED


async def delete_user(client: httpx.AsyncClient, user_id: str) -> None:
    """Delete the auth user, which cascades pawpages_handlers, pawpages_pets and pawpages_entries."""
    key = settings.supabase_service_role_key
    response = await client.delete(
        f"/auth/v1/admin/users/{user_id}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    if not response.is_success:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "The account could not be deleted. Try again."
        )
