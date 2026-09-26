"""One endpoint: send a message, get the reply streamed back, and have both
turns land in pawpages_conversations.transcript. `conversation_id` null in
the request starts a new conversation; its id travels back as the first SSE
event, since it doesn't exist until this call makes it.

The RLS connection (Depends(rls_connection)) stays open for the whole
request -- including however long the model takes to reply -- so the
transcript update after the stream can reuse it inside the same
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

from agent.loop import run_turn  # noqa: E402  (core.llm puts backend/ on sys.path)

from .schemas import ConversationDetail, ConversationSummary, SendMessageRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _parse_transcript(transcript: str) -> list[dict]:
    return [json.loads(line) for line in transcript.splitlines() if line]


def _fallback_title(transcript: str) -> str | None:
    """title is null until the handler renames it or something generates one
    -- neither exists yet -- so the sidebar falls back to the first user
    turn, since that's the only summary-shaped thing already on hand."""
    first_user = next((t["content"] for t in _parse_transcript(transcript) if t["role"] == "user"), None)
    if not first_user:
        return None
    return first_user if len(first_user) <= 60 else first_user[:57] + "..."


@router.get("", response_model=list[ConversationSummary])
async def list_conversations(
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> list[ConversationSummary]:
    rows = await conn.fetch(
        "select id, title, transcript, updated_at from pawpages_conversations order by updated_at desc"
    )
    return [
        ConversationSummary(
            id=str(row["id"]),
            title=row["title"] or _fallback_title(row["transcript"]),
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
    row = await conn.fetchrow(
        "select id, title, transcript from pawpages_conversations where id = $1", conversation_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    return ConversationDetail(
        id=str(row["id"]),
        title=row["title"] or _fallback_title(row["transcript"]),
        history=_parse_transcript(row["transcript"]),
    )


@router.post("/messages")
async def send_message(
    body: SendMessageRequest,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> StreamingResponse:
    if body.conversation_id:
        row = await conn.fetchrow(
            "select transcript from pawpages_conversations where id = $1", body.conversation_id
        )
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
        conversation_id = body.conversation_id
        history = _parse_transcript(row["transcript"])
    else:
        row = await conn.fetchrow(
            "insert into pawpages_conversations (handler_id) values ($1) returning id", handler.id
        )
        conversation_id = str(row["id"])
        history = []
        logger.info("Started conversation %s for %s", conversation_id, handler.email)

    history.append({"role": "user", "content": body.message})

    async def events():
        yield _sse({"type": "conversation", "id": conversation_id})

        reply_text = ""
        async for event in run_turn(get_llm(), history, conn):
            if event["type"] == "text.delta":
                yield _sse({"type": "text.delta", "text": event["text"]})
            else:
                reply_text = event["text_response"]

        yield _sse({"type": "done", "text": reply_text})

        new_lines = "".join(
            json.dumps(turn) + "\n"
            for turn in [
                {"role": "user", "content": body.message},
                {"role": "assistant", "content": reply_text},
            ]
        )
        await conn.execute(
            "update pawpages_conversations set transcript = transcript || $1 where id = $2",
            new_lines,
            conversation_id,
        )

    return StreamingResponse(events(), media_type="text/event-stream")
