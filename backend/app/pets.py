"""Pets: the models the endpoints speak, and the slug the database demands.

The database is the authority on what a pet may contain; these models mirror
its check constraints so a bad field comes back named, next to the field the
handler typed it into, rather than as a raw constraint violation.
"""

import re
import secrets
from uuid import UUID

import asyncpg
from fastapi import HTTPException, status
from pydantic import BaseModel

SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
SLUG_SUFFIX_LENGTH = 4
SLUG_ATTEMPTS = 5


class PetIn(BaseModel):
    name: str
    species: str


class PetOut(BaseModel):
    id: UUID
    name: str
    species: str
    slug: str


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
