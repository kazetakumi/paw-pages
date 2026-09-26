"""Conversation-state plumbing around a chat turn: reading pawpages_
conversations and pawpages_messages, starting a new conversation or loading
an existing one's history, and writing both turns back once run_turn
finishes. Kept apart from loop.py because loop.py only knows how to run one
turn -- it has no idea a conversation or a messages table exists. The API
layer calls this instead of touching the tables itself, so
backend/api/conversations/router.py stays routing (HTTP, DI, status codes)
with no schema knowledge of its own.

Each pawpages_messages row's content is one item exactly as the model takes
it, so loading history is just reading content back in id order. content is
jsonb, and asyncpg has no jsonb codec registered here, so it goes in as a
json.dumps string and comes back as one to json.loads.

Photos: a user message with uploads is saved as plain text naming each
upload's id, so the model can later pass that id to a tool. The image
itself goes to the model only on the turn it was sent (with_images) --
never saved, never replayed, since every later turn would pay for it again.
"""

import base64
import json

import asyncpg


class ConversationNotFound(Exception):
    """A conversation_id was given that doesn't exist (or isn't the
    caller's -- RLS makes those look the same)."""


class UploadNotAvailable(Exception):
    """An upload_id that doesn't exist, isn't the caller's, was already
    filed as a photo, or was already sent in a different conversation."""


# The first user turn's text, pulled per conversation without loading the
# rest of its messages.
_FIRST_USER = """(
    select m.content ->> 'content' from pawpages_messages m
    where m.conversation_id = c.id and m.type = 'user_message'
    order by m.id limit 1
) as first_user"""


def _item_type(item: dict) -> str:
    """function_call items carry their own type; a plain {role, content}
    message doesn't, so it's named by its role."""
    return item.get("type") or f"{item['role']}_message"


def display_title(row: asyncpg.Record) -> str | None:
    """title is null until the handler renames it or something generates
    one -- neither exists yet -- so the sidebar falls back to the first
    user turn, since that's the only summary-shaped thing already on
    hand."""
    if row["title"]:
        return row["title"]
    first_user = row["first_user"]
    if not first_user:
        return None
    return first_user if len(first_user) <= 60 else first_user[:57] + "..."


async def list_summaries(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        f"select c.id, c.title, c.updated_at, {_FIRST_USER} from pawpages_conversations c order by c.updated_at desc"
    )


async def get_detail(conn: asyncpg.Connection, conversation_id: str) -> tuple[asyncpg.Record, list[dict]] | None:
    """The conversation as the chat UI shows it: user and assistant
    messages only, no tool round-trips."""
    row = await conn.fetchrow(
        f"select c.id, c.title, {_FIRST_USER} from pawpages_conversations c where c.id = $1", conversation_id
    )
    if row is None:
        return None
    return row, await _load_items(conn, conversation_id, "and type in ('user_message', 'assistant_message')")


async def _load_items(conn: asyncpg.Connection, conversation_id: str, filter_sql: str = "") -> list[dict]:
    rows = await conn.fetch(
        f"select content from pawpages_messages where conversation_id = $1 {filter_sql} order by id", conversation_id
    )
    return [json.loads(r["content"]) for r in rows]


async def load_or_start(
    conn: asyncpg.Connection, handler_id: str, conversation_id: str | None
) -> tuple[str, list[dict]]:
    """Returns (conversation_id, history so far). Starts a new conversation
    when conversation_id is None; raises ConversationNotFound when one was
    given but doesn't exist."""
    if conversation_id:
        exists = await conn.fetchval("select 1 from pawpages_conversations where id = $1", conversation_id)
        if exists is None:
            raise ConversationNotFound(conversation_id)
        history = await _load_items(conn, conversation_id)
    else:
        row = await conn.fetchrow(
            "insert into pawpages_conversations (handler_id) values ($1) returning id", handler_id
        )
        conversation_id = str(row["id"])
        history = []

    return conversation_id, history


async def attach_uploads(conn: asyncpg.Connection, conversation_id: str, upload_ids: list[str]) -> list[asyncpg.Record]:
    """Ties each upload to this conversation and returns (id, storage_path,
    content_type) for each, in the order given. Raises UploadNotAvailable if
    any one can't be used here."""
    if not upload_ids:
        return []
    rows = await conn.fetch(
        """
        update pawpages_uploads set conversation_id = $1
        where id = any($2::uuid[]) and claimed_at is null
          and (conversation_id is null or conversation_id = $1)
        returning id, storage_path, content_type
        """,
        conversation_id,
        upload_ids,
    )
    by_id = {str(r["id"]): r for r in rows}
    if len(by_id) != len(set(upload_ids)):
        raise UploadNotAvailable([i for i in upload_ids if i not in by_id])
    return [by_id[i] for i in upload_ids]


def user_message(text: str, upload_ids: list[str]) -> dict:
    """The user turn as saved: the handler's text, plus one line per photo
    naming the id a tool needs to file it."""
    lines = [text] if text else []
    lines += [f"[photo attached, upload_id: {i}]" for i in upload_ids]
    return {"role": "user", "content": "\n".join(lines)}


def with_images(message: dict, images: list[tuple[str, bytes]]) -> dict:
    """The same user turn as the model sees it on the turn it's sent: its
    text plus each (content_type, bytes) photo inline as a data URL."""
    if not images:
        return message
    return {
        "role": "user",
        "content": [
            {"type": "input_text", "text": message["content"]},
            *(
                {"type": "input_image", "image_url": f"data:{ct};base64,{base64.b64encode(data).decode()}"}
                for ct, data in images
            ),
        ],
    }


async def save_turn(conn: asyncpg.Connection, handler_id: str, conversation_id: str, items: list[dict]) -> None:
    """items is the saved user message followed by run_turn's items, in
    order. executemany inserts in list order, so ids keep it."""
    await conn.executemany(
        "insert into pawpages_messages (conversation_id, handler_id, type, content) values ($1, $2, $3, $4)",
        [(conversation_id, handler_id, _item_type(item), json.dumps(item)) for item in items],
    )
    # Nothing updates the conversation row itself any more, so its touch
    # trigger would never fire -- bump updated_at here to keep the sidebar's
    # recency sort honest.
    await conn.execute("update pawpages_conversations set updated_at = now() where id = $1", conversation_id)
