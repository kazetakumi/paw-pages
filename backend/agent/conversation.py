"""Conversation-state plumbing around a chat turn: reading pawpages_
conversations, starting a new row or loading an existing one's transcript,
and writing both turns back once run_turn finishes. Kept apart from loop.py
because loop.py only knows how to run one turn -- it has no idea a
conversation or a transcript column exists. The API layer calls this
instead of touching the table itself, so backend/api/conversations/router.py
stays routing (HTTP, DI, status codes) with no schema or transcript-format
knowledge of its own.
"""

import json

import asyncpg


class ConversationNotFound(Exception):
    """A conversation_id was given that doesn't exist (or isn't the
    caller's -- RLS makes those look the same)."""


def parse_transcript(transcript: str) -> list[dict]:
    return [json.loads(line) for line in transcript.splitlines() if line]


def fallback_title(transcript: str) -> str | None:
    """title is null until the handler renames it or something generates
    one -- neither exists yet -- so the sidebar falls back to the first
    user turn, since that's the only summary-shaped thing already on
    hand."""
    first_user = next((t["content"] for t in parse_transcript(transcript) if t["role"] == "user"), None)
    if not first_user:
        return None
    return first_user if len(first_user) <= 60 else first_user[:57] + "..."


async def list_summaries(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        "select id, title, transcript, updated_at from pawpages_conversations order by updated_at desc"
    )


async def get_detail(conn: asyncpg.Connection, conversation_id: str) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "select id, title, transcript from pawpages_conversations where id = $1", conversation_id
    )


async def load_or_start(
    conn: asyncpg.Connection, handler_id: str, conversation_id: str | None, message: str
) -> tuple[str, list[dict]]:
    """Returns (conversation_id, history) with the new user turn already
    appended to history. Starts a new conversation when conversation_id is
    None; raises ConversationNotFound when one was given but doesn't exist."""
    if conversation_id:
        row = await conn.fetchrow(
            "select transcript from pawpages_conversations where id = $1", conversation_id
        )
        if row is None:
            raise ConversationNotFound(conversation_id)
        history = parse_transcript(row["transcript"])
    else:
        row = await conn.fetchrow(
            "insert into pawpages_conversations (handler_id) values ($1) returning id", handler_id
        )
        conversation_id = str(row["id"])
        history = []

    history.append({"role": "user", "content": message})
    return conversation_id, history


async def save_turn(conn: asyncpg.Connection, conversation_id: str, user_message: str, reply_text: str) -> None:
    new_lines = "".join(
        json.dumps(turn) + "\n"
        for turn in [
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": reply_text},
        ]
    )
    await conn.execute(
        "update pawpages_conversations set transcript = transcript || $1 where id = $2",
        new_lines,
        conversation_id,
    )
