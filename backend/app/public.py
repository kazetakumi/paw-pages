"""The public page: what a visitor holding a link is given, and nothing else.

Every field below comes off `public_pets` or `public_entries`. Neither view
carries a note, a vet, an id or an exact date of birth, so a bug in this module
still cannot leak one — the column list is the security boundary, not this file.
"""

from datetime import date
from uuid import UUID

from pydantic import BaseModel


class PublicEntry(BaseModel):
    """One line of the record: when, what, and what it left standing."""

    title: str
    happened_on: date
    # No is_overdue here on purpose. The public page never accuses the handler
    # of anything, so it has no use for the one place overdue is worked out.
    due_on: date | None
    # The entry's id, and only when its photo is published — the view
    # returns null otherwise, so an unpublished row has no id here to ask
    # about. Null means there is nothing to show, never a hidden photo.
    photo_id: UUID | None


class PublicPet(BaseModel):
    slug: str
    name: str
    species: str
    breed: str | None
    colour: str | None
    sex: str | None
    # Coarsened by the view to a month and a year. The exact date never leaves
    # the table; the age beside it is what the day was needed for.
    born: str | None
    age_years: int | None
    age_months: int | None
    # Whether there is a photo to ask our own route for, never where it lives:
    # the object's path stays inside the backend, like every other id here.
    has_photo: bool
    updated_on: date
    entries: list[PublicEntry]


PET = """select slug, name, species, breed, colour, sex, born, age_years, age_months,
       (photo_path is not null) as has_photo,
       updated_at::date as updated_on
       from public_pets where slug = $1"""

# No id to break a tie on: the view does not expose one, so the title orders
# two things logged on the same day.
ENTRIES = """select title, happened_on, due_on, photo_id from public_entries
       where slug = $1 order by happened_on desc, title"""

# The slug is in the where clause, not just the path, so an entry id from one
# public page cannot be read through another. Null `photo_path` — an entry
# whose photo is unpublished — matches nothing and falls through to 404.
ENTRY_PHOTO = """select photo_path from public_entries
       where slug = $1 and photo_id = $2"""
