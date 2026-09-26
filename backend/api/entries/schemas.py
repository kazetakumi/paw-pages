from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


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
    # Whether there's a photo, never the path.
    has_photo: bool
    photo_is_public: bool
    # From pawpages_due_items, which owns the one definition of overdue.
    is_overdue: bool


class FeedPage(BaseModel):
    entries: list[EntryOut]
    # Opaque: the screen carries it back untouched.
    next_cursor: str | None
