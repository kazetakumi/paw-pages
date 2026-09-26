"""A pet's feed and "mark done", ported from v1's backend/app/main.py and
entries.py -- what the pet screen calls. The rest of v1's entry routes
aren't ported yet.

No `where handler_id = ...`: the RLS connection has already become the
caller, so another handler's entry is absent rather than forbidden.
"""

import base64
import binascii
from datetime import date
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from auth.dependencies import AuthenticatedHandler, get_current_handler
from db.rls import rls_connection

from .schemas import EntryOut, FeedPage

router = APIRouter(tags=["entries"])

# pawpages_due_items already excludes closed and archived, so a left join
# gives every entry its overdue flag without this file knowing what overdue
# means.
_ENTRY = """select e.id, e.pet_id, e.title, e.happened_on, e.due_on, e.vet, e.note,
       e.weight_value, e.weight_unit,
       (e.photo_path is not null) as has_photo,
       e.photo_is_public,
       coalesce(d.is_overdue, false) as is_overdue
       from pawpages_entries e left join pawpages_due_items d on d.entry_id = e.id"""


def _encode_cursor(entry: EntryOut) -> str:
    raw = f"{entry.happened_on.isoformat()} {entry.id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[date, UUID]:
    try:
        happened_on, entry_id = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode().split(" ")
        return date.fromisoformat(happened_on), UUID(entry_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That page cursor is not readable.")


@router.get("/pets/{pet_id}/entries", response_model=FeedPage)
async def pet_feed(
    pet_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=5, ge=1, le=50),
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> FeedPage:
    """One page, newest first. Keyset rather than offset, on the same
    (happened_on desc, id desc) the feed index is built on, so a page can't
    gain or drop an entry when something older is logged in between."""
    after = _decode_cursor(cursor) if cursor else (None, None)
    rows = await conn.fetch(
        f"{_ENTRY} where e.pet_id = $1"
        " and ($2::date is null or (e.happened_on, e.id) < ($2, $3::uuid))"
        " order by e.happened_on desc, e.id desc limit $4",
        pet_id,
        *after,
        limit + 1,
    )
    page = [EntryOut(**dict(r)) for r in rows[:limit]]
    return FeedPage(entries=page, next_cursor=_encode_cursor(page[-1]) if len(rows) > limit else None)


@router.post("/entries/{entry_id}/mark-done", response_model=EntryOut)
async def mark_done(
    entry_id: UUID,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> EntryOut:
    """Dealt with elsewhere: the item leaves the ledger, the entry stays."""
    closed = await conn.fetchval(
        "update pawpages_entries set due_closed_at = now() where id = $1 and due_on is not null returning id",
        entry_id,
    )
    if closed is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such entry.")
    return EntryOut(**dict(await conn.fetchrow(f"{_ENTRY} where e.id = $1", entry_id)))
