"""Entries: the models the endpoints speak, and the feed's opaque cursor.

One universal shape for a rabies booster, a vet visit and a nail trim. As in
`pets`, the database is the authority on what an entry may contain and these
models only mirror its checks, so a rejected field comes back named.
"""

import base64
import binascii
import re
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import HTTPException, status
from pydantic import BaseModel, StringConstraints

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Vet = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
# Stored as the handler typed it. The database owns "greater than zero" and
# "both or neither", the same way it owns "not in the future" for a date.
WeightUnit = Literal["kg", "lb"]


class EntryIn(BaseModel):
    """A new entry. A pet, a title and a date are enough.

    `closes_entry_id` is "log the next one": the outstanding entry whose due
    date this one settles. It is not a column — it names another row, and the
    handler names it because free-text titles mean the app cannot.
    """

    pet_id: UUID
    title: Title
    happened_on: date
    due_on: date | None = None
    vet: Vet | None = None
    note: Note | None = None
    weight_value: Decimal | None = None
    weight_unit: WeightUnit | None = None
    closes_entry_id: UUID | None = None


# Everything on EntryIn that is not a column on `entries`.
NOT_COLUMNS = {"closes_entry_id"}


class EntryPatch(BaseModel):
    """A correction. Only the fields sent are touched; null clears one."""

    title: Title | None = None
    happened_on: date | None = None
    due_on: date | None = None
    vet: Vet | None = None
    note: Note | None = None
    weight_value: Decimal | None = None
    weight_unit: WeightUnit | None = None


class EntryOut(BaseModel):
    id: UUID
    pet_id: UUID
    title: str
    happened_on: date
    due_on: date | None
    vet: str | None
    note: str | None
    weight_value: Decimal | None
    weight_unit: str | None
    # The path itself never leaves the backend, the same as a pet's.
    has_photo: bool
    # From the `due_items` view, which owns the one definition of overdue.
    # Never worked out here and never worked out in the browser.
    is_overdue: bool


class FeedPage(BaseModel):
    entries: list[EntryOut]
    # Opaque: the screen carries it back untouched and never takes it apart.
    next_cursor: str | None


# `due_items` already excludes closed and archived, so a left join gives every
# entry its overdue flag without this file knowing what overdue means.
ENTRY_COLUMNS = """e.id, e.pet_id, e.title, e.happened_on, e.due_on, e.vet, e.note,
       e.weight_value, e.weight_unit,
       (e.photo_path is not null) as has_photo,
       coalesce(d.is_overdue, false) as is_overdue"""
ENTRY_SOURCE = "from entries e left join due_items d on d.entry_id = e.id"

# Matches entries_pet_feed_idx on (pet_id, happened_on desc, id desc).
FEED_ORDER = "order by e.happened_on desc, e.id desc"


def encode_cursor(entry: EntryOut) -> str:
    raw = f"{entry.happened_on.isoformat()} {entry.id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[date, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        happened_on, entry_id = base64.urlsafe_b64decode(padded).decode().split(" ")
        return date.fromisoformat(happened_on), UUID(entry_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That page cursor is not readable.")


# The constraints Pydantic cannot mirror, because they are about the row rather
# than one field. The database stays the authority; this only names the field.
CHECK_FIELDS = {
    "due_after_it_happened": (
        "due_on",
        "The next one cannot be due before the date this happened.",
    ),
    "entries_happened_on_check": ("happened_on", "That date is in the future."),
    "weight_is_complete": ("weight_value", "A weight needs a unit."),
}


def constraint_error(error: asyncpg.IntegrityConstraintViolationError) -> HTTPException:
    """A rejection from Postgres, pinned to the field that caused it."""
    if isinstance(error, asyncpg.NotNullViolationError):
        return HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"field": error.column_name, "message": "This cannot be empty."},
        )
    name = error.constraint_name or ""
    if name in CHECK_FIELDS:
        field, message = CHECK_FIELDS[name]
    else:
        column = re.fullmatch(r"entries_(.+)_check", name)
        field = column.group(1) if column else "title"
        message = "That value is not allowed."
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"field": field, "message": message})
