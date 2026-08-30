"""Pets: the models the endpoints speak, and the slug the database demands.

The database is the authority on what a pet may contain; these models mirror
its check constraints so a bad field comes back named, beside the field the
handler typed it into, rather than as a raw constraint violation.
"""

import re
import secrets
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import HTTPException, status
from pydantic import BaseModel, StringConstraints

SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
SLUG_SUFFIX_LENGTH = 4
SLUG_ATTEMPTS = 5

# Mirrors of the checks on `pets`. Free text within a length cap: nothing in v1
# branches on species, so a tortoise is as welcome as a dog.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Species = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Breed = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]
Colour = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]
Sex = Literal["male", "female"]


class PetIn(BaseModel):
    """A new pet. A name and a species are enough; the rest can wait."""

    name: Name
    species: Species
    breed: Breed | None = None
    sex: Sex | None = None
    date_of_birth: date | None = None
    dob_is_approx: bool = False
    colour: Colour | None = None


class PetPatch(BaseModel):
    """A correction. Only the fields sent are touched; null clears one."""

    name: Name | None = None
    species: Species | None = None
    breed: Breed | None = None
    sex: Sex | None = None
    date_of_birth: date | None = None
    dob_is_approx: bool | None = None
    colour: Colour | None = None


class PetOut(BaseModel):
    id: UUID
    name: str
    species: str
    breed: str | None
    sex: str | None
    date_of_birth: date | None
    dob_is_approx: bool
    colour: str | None
    slug: str
    # Derived by the database from date_of_birth on every read, never stored,
    # so it cannot go stale and nobody is ever asked to correct it.
    age_years: int | None
    age_months: int | None


def slugify(name: str) -> str:
    """The name, reduced to the shape the database's check allows."""
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return base or "pet"


def _suffix() -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_SUFFIX_LENGTH))


async def claim_slug(name: str, insert):
    """Insert with a fresh slug, regenerating the suffix when one is taken.

    Uniqueness is the database's to enforce, so a collision arrives as a unique
    violation and the only answer is another suffix. Bounded, because a loop
    that cannot end is worse than a pet that cannot be added.
    """
    base = slugify(name)
    for _ in range(SLUG_ATTEMPTS):
        try:
            return await insert(f"{base}-{_suffix()}")
        except asyncpg.UniqueViolationError:
            continue
    raise HTTPException(status.HTTP_409_CONFLICT, "Could not claim a slug for this pet.")


# The constraints Pydantic cannot mirror, because they are about the row rather
# than one field. The database stays the authority; this only names the field.
CHECK_FIELDS = {
    "dob_approx_needs_a_date": (
        "dob_is_approx",
        "Mark a date of birth approximate only when there is a date.",
    ),
    "pets_date_of_birth_check": ("date_of_birth", "A date of birth cannot be in the future."),
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
        column = re.fullmatch(r"pets_(.+)_check", name)
        field = column.group(1) if column else "name"
        message = "That value is not allowed."
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"field": field, "message": message})
