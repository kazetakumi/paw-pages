"""HTTP routing only: pull dependencies (auth, DB conn), call into
backend/agent for the actual conversation/LLM logic, shape the result as a
response. `conversation_id` null in the request starts a new conversation;
its id travels back as the first SSE event, since it doesn't exist until
that call makes it.

The RLS connection (Depends(rls_connection)) stays open for the whole
request -- including however long the model takes to reply -- so the
message inserts after the stream can reuse it inside the same
transaction. Confirmed FastAPI keeps a yield-dependency open until a
StreamingResponse finishes sending, not just until the endpoint returns.
That's an idle-in-transaction connection for the reply's duration, which is
fine at this app's scale; revisit with two short transactions instead of
one long one if concurrent chats ever make that a real cost.
"""

import json
import logging

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from auth.dependencies import AuthenticatedHandler, get_current_handler
from core.llm import get_llm
from db.rls import rls_connection
from uploads import storage

from agent.conversation import (  # noqa: E402  (core.llm puts backend/ on sys.path)
    ConversationNotFound,
    UploadNotAvailable,
    attach_uploads,
    display_title,
    get_detail,
    image_part,
    list_summaries,
    load_or_start,
    save_turn,
    user_message,
    with_attachments,
)
from agent.loop import run_turn  # noqa: E402
from agent.tools.registry import document_parts  # noqa: E402

from .schemas import ConversationDetail, ConversationSummary, SendMessageRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.get("", response_model=list[ConversationSummary])
async def list_conversations(
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> list[ConversationSummary]:
    rows = await list_summaries(conn)
    return [
        ConversationSummary(
            id=str(row["id"]),
            title=display_title(row),
            updated_at=row["updated_at"],
        )
        for row in rows
    ]


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> ConversationDetail:
    detail = await get_detail(conn, conversation_id)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    row, history = detail
    return ConversationDetail(id=str(row["id"]), title=display_title(row), history=history)


@router.post("/messages")
async def send_message(
    body: SendMessageRequest,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> StreamingResponse:
    upload_ids = [str(i) for i in body.upload_ids]
    try:
        conversation_id, history = await load_or_start(conn, handler.id, body.conversation_id)
        uploads = await attach_uploads(conn, conversation_id, upload_ids)
    except ConversationNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    except UploadNotAvailable as exc:
        # Raising here rolls back the whole request, including a
        # conversation load_or_start just created.
        raise HTTPException(status.HTTP_409_CONFLICT, f"upload(s) not available: {', '.join(exc.args[0])}")

    if not body.conversation_id:
        logger.info("Started conversation %s for %s", conversation_id, handler.email)

    # Every upload's content goes to the model on this turn: a photo as
    # itself, a PDF as its extracted text (or page images, if scanned).
    saved_user = user_message(body.message, uploads)
    parts = []
    for u in uploads:
        data = await storage.get(handler.access_token, u["storage_path"])
        if u["content_type"] == "application/pdf":
            parts += document_parts(str(u["id"]), data)
        else:
            parts.append(image_part(u["content_type"], data))
    history.append(with_attachments(saved_user, parts))

    async def fetch_file(path: str) -> bytes:
        return await storage.get(handler.access_token, path)

    async def events():
        yield _sse({"type": "conversation", "id": conversation_id})

        reply_text, items = "", []
        async for event in run_turn(get_llm(), history, conn, fetch_file):
            if event["type"] == "text.delta":
                yield _sse({"type": "text.delta", "text": event["text"]})
            else:
                reply_text, items = event["text_response"], event["items"]

        yield _sse({"type": "done", "text": reply_text})
        await save_turn(conn, handler.id, conversation_id, [saved_user, *items])

    return StreamingResponse(events(), media_type="text/event-stream")
