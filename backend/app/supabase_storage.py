"""Supabase Storage, spoken to over HTTP the way Supabase Auth is.

Every call carries a bearer token and the service applies the policies in
migration 0003 to it, so this module never decides who may see an object. It
only moves bytes.

The constants below mirror `allowed_mime_types` and `file_size_limit` on the
bucket the same way the Pydantic models mirror the database's check
constraints: the bucket stays the authority, and mirroring it here is what
turns a rejection into a message beside the handler's file picker rather than a
500 from a service they never asked about.
"""

import secrets
from uuid import UUID

import httpx
from fastapi import HTTPException, status

BUCKET = "pet-photos"
MAX_BYTES = 5 * 1024 * 1024
EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
}


class StorageError(Exception):
    """Storage refused or failed. Never a judgement about the handler."""


def check(content_type: str | None, size: int) -> str:
    """The bucket's own two limits, pinned to the field the handler chose."""
    kind = (content_type or "").split(";")[0].strip().lower()
    if kind not in EXTENSIONS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"field": "photo", "message": "Choose a JPEG, PNG, WebP or HEIC image."},
        )
    if size > MAX_BYTES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"field": "photo", "message": "That image is over 5 MB. Choose a smaller one."},
        )
    return kind


def path_for(pet_id: UUID, content_type: str) -> str:
    """`{pet_id}/{filename}` — the first segment is what every policy keys off.

    The filename is fresh every time, so a replacement never overwrites: the
    object it replaces is still there to be deleted, which is the only way it
    ever will be.
    """
    return f"{pet_id}/{secrets.token_hex(8)}{EXTENSIONS[content_type]}"


def _url(path: str) -> str:
    return f"/storage/v1/object/{BUCKET}/{path}"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def upload(
    client: httpx.AsyncClient, token: str, path: str, content: bytes, content_type: str
) -> None:
    response = await client.post(
        _url(path), content=content, headers=_auth(token) | {"Content-Type": content_type}
    )
    if not response.is_success:
        raise StorageError(f"upload of {path} failed: {response.status_code}")


async def download(
    client: httpx.AsyncClient, token: str, path: str
) -> tuple[bytes, str] | None:
    """The object's bytes and its type, or None when the token may not read it."""
    response = await client.get(_url(path), headers=_auth(token))
    if response.status_code == status.HTTP_404_NOT_FOUND:
        return None
    if not response.is_success:
        raise StorageError(f"read of {path} failed: {response.status_code}")
    return response.content, response.headers.get("content-type", "application/octet-stream")


async def remove(client: httpx.AsyncClient, token: str, path: str) -> None:
    response = await client.request("DELETE", _url(path), headers=_auth(token))
    if not response.is_success:
        raise StorageError(f"delete of {path} failed: {response.status_code}")
