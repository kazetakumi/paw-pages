"""The one unit test in v1.

Provoking a slug collision through the API is awkward and the retry loop is
easy to get subtly wrong, so the loop is driven directly against a forced
collision. Everything else about pets is tested at the two seams.
"""

import re

import asyncpg
import pytest
from fastapi import HTTPException

from app import pets


class Collides:
    """An insert that rejects the first `times` slugs the way Postgres would."""

    def __init__(self, times: int) -> None:
        self.times = times
        self.tried: list[str] = []

    async def __call__(self, slug: str) -> str:
        self.tried.append(slug)
        if len(self.tried) <= self.times:
            raise asyncpg.UniqueViolationError("duplicate key value violates pets_slug_key")
        return slug


async def test_a_taken_slug_is_retried_with_a_fresh_suffix():
    insert = Collides(times=2)

    claimed = await pets.claim_slug("Biscuit", insert)

    assert claimed == insert.tried[-1]
    assert len(insert.tried) == 3
    assert all(slug.startswith("biscuit-") for slug in insert.tried)
    # A regenerated suffix, not the same slug offered again.
    assert len(set(insert.tried)) == 3


async def test_it_gives_up_after_five_attempts():
    insert = Collides(times=pets.SLUG_ATTEMPTS)

    with pytest.raises(HTTPException) as failure:
        await pets.claim_slug("Biscuit", insert)

    assert failure.value.status_code == 409
    assert len(insert.tried) == 5


async def test_a_name_with_nothing_slugworthy_still_yields_a_valid_slug():
    insert = Collides(times=0)

    claimed = await pets.claim_slug("???", insert)

    # the shape the database's check constraint demands
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", claimed), claimed
