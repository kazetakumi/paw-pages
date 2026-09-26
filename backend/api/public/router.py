"""The visitor-facing public page, ported from v1's backend/app/main.py and
public.py. No cookie and no handler: every route reads as `anon`, and
pawpages_public_pets / pawpages_public_entries are the only rows it can see.
Neither view carries a note, a vet or an exact date of birth, so the views'
column lists are the security boundary, not this file.

A slug that is absent, private or archived is simply a row the view doesn't
return, so all three are the same 404.

Photos stream out of the private bucket with the anon key, so the bucket's
public-read policy decides, and a page switched off stops its images
resolving at the same moment.
"""

import json
import mimetypes
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response, status

from core.config import get_settings
from db.rls import anon_connection
from uploads import storage

from .schemas import PublicPet

router = APIRouter(prefix="/public/pets", tags=["public"])

_NO_SUCH_PAGE = HTTPException(status.HTTP_404_NOT_FOUND, "No such page.")

# The pet and its entries in one round trip. No id to break a tie on: the
# view doesn't expose one, so the title orders two things logged the same day.
_PAGE = """select slug, name, species, breed, colour, sex, born, age_years, age_months,
       (photo_path is not null) as has_photo,
       updated_at::date as updated_on,
       (select coalesce(json_agg(r), '[]') from (
          select title, happened_on, due_on, photo_id from pawpages_public_entries
          where slug = $1 order by happened_on desc, title) r) as entries
       from pawpages_public_pets where slug = $1"""

# The slug is matched as well as the id, so one public page can't be used to
# read another's photos. An unpublished photo has a null path and 404s.
_ENTRY_PHOTO = "select photo_path from pawpages_public_entries where slug = $1 and photo_id = $2"


@router.get("/{slug}", response_model=PublicPet)
async def public_page(slug: str, conn: asyncpg.Connection = Depends(anon_connection)) -> PublicPet:
    row = await conn.fetchrow(_PAGE, slug)
    if row is None:
        raise _NO_SUCH_PAGE
    return PublicPet(**dict(row) | {"entries": json.loads(row["entries"])})


async def _stream(path: str | None) -> Response:
    if path is None:
        raise _NO_SUCH_PAGE
    try:
        data = await storage.get(get_settings().supabase_anon_key, path)
    except storage.StorageError:
        raise _NO_SUCH_PAGE
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    # No caching: switching the page off has to take the photo with it.
    return Response(data, media_type=media_type, headers={"cache-control": "no-store"})


@router.get("/{slug}/photo")
async def public_photo(slug: str, conn: asyncpg.Connection = Depends(anon_connection)) -> Response:
    return await _stream(await conn.fetchval("select photo_path from pawpages_public_pets where slug = $1", slug))


@router.get("/{slug}/entries/{entry_id}/photo")
async def public_entry_photo(
    slug: str, entry_id: UUID, conn: asyncpg.Connection = Depends(anon_connection)
) -> Response:
    return await _stream(await conn.fetchval(_ENTRY_PHOTO, slug, entry_id))
