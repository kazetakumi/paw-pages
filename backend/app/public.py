"""The public page: what a visitor holding a link is given, and nothing else.

Every field below comes off `public_pets` or `public_entries`. Neither view
carries a note, a vet, an id or an exact date of birth, so a bug in this module
still cannot leak one — the column list is the security boundary, not this file.
"""

from datetime import date

from pydantic import BaseModel


class PublicEntry(BaseModel):
    """One line of the record: when, what, and what it left standing."""

    title: str
    happened_on: date
    # No is_overdue here on purpose. The public page never accuses the handler
    # of anything, so it has no use for the one place overdue is worked out.
    due_on: date | None


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
    updated_on: date
    entries: list[PublicEntry]


PET = """select slug, name, species, breed, colour, sex, born, age_years, age_months,
       updated_at::date as updated_on
       from public_pets where slug = $1"""

# No id to break a tie on: the view does not expose one, so the title orders
# two things logged on the same day.
ENTRIES = """select title, happened_on, due_on from public_entries
       where slug = $1 order by happened_on desc, title"""
