"""POST /uploads stores a photo or PDF the moment it's attached -- before the
message it belongs to is sent, and before any conversation may exist -- and
returns its id. The frontend sends that id back in upload_ids with the
message; conversations/router.py attaches it there. DELETE /uploads/{id} is
for a photo removed from the composer before sending.
"""

import uuid

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from auth.dependencies import AuthenticatedHandler, get_current_handler
from db.rls import rls_connection

from . import storage
from .schemas import UploadOut

router = APIRouter(prefix="/uploads", tags=["uploads"])

# The bucket's own allow-list (0003, 0012) also takes image/heic, but the
# model can't read HEIC, so a chat upload is limited to what it can.
_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}
_MAX_BYTES = 5 * 1024 * 1024  # the bucket's file_size_limit (0003)


@router.post("", response_model=UploadOut, status_code=status.HTTP_201_CREATED)
async def create_upload(
    file: UploadFile,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> UploadOut:
    ext = _EXTENSIONS.get(file.content_type or "")
    if ext is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "file must be JPEG, PNG, WebP or PDF")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file must be 5 MB or smaller")

    path = f"{handler.id}/uploads/{uuid.uuid4()}.{ext}"
    await storage.put(handler.access_token, path, data, file.content_type)
    row = await conn.fetchrow(
        "insert into pawpages_uploads (handler_id, storage_path, content_type) values ($1, $2, $3) returning id",
        handler.id,
        path,
        file.content_type,
    )
    return UploadOut(id=str(row["id"]))


@router.delete("/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_upload(
    upload_id: str,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> None:
    # Only one that was never sent: once it's in a conversation, the
    # model has its id and may still file it somewhere.
    path = await conn.fetchval(
        "delete from pawpages_uploads where id = $1 and conversation_id is null returning storage_path", upload_id
    )
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no unsent upload with that id")
    await storage.delete(handler.access_token, path)
