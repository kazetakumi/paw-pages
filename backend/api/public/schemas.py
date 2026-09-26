from datetime import date
from uuid import UUID

from pydantic import BaseModel


class PublicEntry(BaseModel):
    title: str
    happened_on: date
    # No is_overdue on purpose: the public page never accuses the handler.
    due_on: date | None
    # Set only when the handler published this entry's photo.
    photo_id: UUID | None


class PublicPet(BaseModel):
    slug: str
    name: str
    species: str
    breed: str | None
    colour: str | None
    sex: str | None
    # Coarsened by the view to a month and year; the exact date never leaves the table.
    born: str | None
    age_years: int | None
    age_months: int | None
    # Whether there's a photo, never the path.
    has_photo: bool
    updated_on: date
    entries: list[PublicEntry]
