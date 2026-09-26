"""The dashboard and the routes a pet's own screens call, ported from v1's
backend/app/main.py, pets.py and due.py. Not ported yet: listing and
creating pets through a form, and the visitor-facing public page.

pawpages_due_items is the one definition of due and overdue; nothing here
works out what overdue means. No `where handler_id = ...`: the RLS
connection has already become the caller, and the view is security_invoker,
so another handler's pet is absent (404) rather than forbidden.

Photos stream through here out of the private bucket, read with the
handler's own token so the storage policies apply. No signed URL or
Supabase domain ever reaches the browser.
"""

import mimetypes
import re
import secrets
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from auth.dependencies import AuthenticatedHandler, get_current_handler
from db.rls import rls_connection
from uploads import storage

from .schemas import ArchivedPet, ArchiveIn, Dashboard, DueItem, PetCard, PetOut, PetPatch, PetRecord

router = APIRouter(tags=["pets"])

_NO_SUCH_PET = HTTPException(status.HTTP_404_NOT_FOUND, "No such pet.")
_NO_SUCH_PHOTO = HTTPException(status.HTTP_404_NOT_FOUND, "No such photo.")

# The bucket's allow-list and size limit (0003), mirrored so a rejection
# lands beside the file picker instead of as a 500.
_PHOTO_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic"}
_MAX_PHOTO_BYTES = 5 * 1024 * 1024

# Row-level checks pydantic can't mirror, pinned to a field.
_CHECK_FIELDS = {
    "pawpages_dob_approx_needs_a_date": (
        "dob_is_approx",
        "Mark a date of birth approximate only when there is a date.",
    ),
    "pawpages_pets_date_of_birth_check": ("date_of_birth", "A date of birth cannot be in the future."),
}


def _constraint_error(exc: asyncpg.IntegrityConstraintViolationError) -> HTTPException:
    name = exc.constraint_name or ""
    if name in _CHECK_FIELDS:
        field, message = _CHECK_FIELDS[name]
    else:
        column = re.fullmatch(r"pawpages_pets_(.+)_check", name)
        field, message = (column.group(1) if column else "name"), "That value is not allowed."
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"field": field, "message": message})

# Everything a pet shows on any screen. age_* is derived on every read.
_PET_COLUMNS = """id, name, species, breed, sex, date_of_birth, dob_is_approx, colour, slug, is_public,
       (photo_path is not null) as has_photo,
       extract(year  from age(date_of_birth))::int as age_years,
       extract(month from age(date_of_birth))::int as age_months"""

_LEDGER = """select d.entry_id, d.pet_id, d.pet_name, d.title, d.due_on, d.days_until,
       d.is_overdue, e.happened_on, e.vet
       from pawpages_due_items d join pawpages_entries e on e.id = d.entry_id
       {where} order by d.due_on, d.entry_id"""

_PET_CARDS = f"""select {_PET_COLUMNS},
       d.due_on as next_due_on,
       coalesce(d.is_overdue, false) as next_due_is_overdue,
       (select max(happened_on) from pawpages_entries e where e.pet_id = p.id) as last_logged_on
       from pawpages_pets p
       left join lateral (
         select due_on, is_overdue from pawpages_due_items
         where pet_id = p.id order by due_on limit 1
       ) d on true
       where p.archived_at is null
       order by p.created_at"""

_COUNTS = """select
       (select count(*) from pawpages_pets where archived_at is null)     as active_pets,
       (select count(*) from pawpages_pets where archived_at is not null) as archived_pets,
       (select count(*) from pawpages_due_items where is_overdue)         as overdue,
       (select count(*) from pawpages_due_items
         where not is_overdue and days_until <= 30)                       as due_within_30_days"""

_ARCHIVED = """select id, name, archived_reason, archived_at::date as archived_on
       from pawpages_pets where archived_at is not null order by created_at"""


@router.get("/dashboard", response_model=Dashboard)
async def dashboard(
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> Dashboard:
    return Dashboard(
        ledger=[DueItem(**dict(r)) for r in await conn.fetch(_LEDGER.format(where=""))],
        pets=[PetCard(**dict(r)) for r in await conn.fetch(_PET_CARDS)],
        archived=[ArchivedPet(**dict(r)) for r in await conn.fetch(_ARCHIVED)],
        **dict(await conn.fetchrow(_COUNTS)),
    )


@router.get("/pets/{pet_id}", response_model=PetRecord)
async def read_pet(
    pet_id: UUID,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> PetRecord:
    row = await conn.fetchrow(f"select {_PET_COLUMNS} from pawpages_pets where id = $1", pet_id)
    if row is None:
        raise _NO_SUCH_PET
    # The same view the dashboard ledger reads, so the two can't disagree.
    due = await conn.fetch(_LEDGER.format(where="where d.pet_id = $1"), pet_id)
    return PetRecord(**dict(row), due_items=[DueItem(**dict(d)) for d in due])


@router.patch("/pets/{pet_id}", response_model=PetOut)
async def update_pet(
    pet_id: UUID,
    body: PetPatch,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> PetOut:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        row = await conn.fetchrow(f"select {_PET_COLUMNS} from pawpages_pets where id = $1", pet_id)
    else:
        assignments = ", ".join(f"{column} = ${n}" for n, column in enumerate(changes, start=2))
        try:
            row = await conn.fetchrow(
                f"update pawpages_pets set {assignments} where id = $1 returning {_PET_COLUMNS}",
                pet_id,
                *changes.values(),
            )
        except asyncpg.IntegrityConstraintViolationError as exc:
            raise _constraint_error(exc)
    if row is None:
        raise _NO_SUCH_PET
    return PetOut(**dict(row))


@router.post("/pets/{pet_id}/archive", response_model=PetOut)
async def archive_pet(
    pet_id: UUID,
    body: ArchiveIn,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> PetOut:
    """Two columns and nothing else: the ledger and the public views all
    carry `archived_at is null`, so everything else follows. Not a delete."""
    row = await conn.fetchrow(
        f"update pawpages_pets set archived_at = now(), archived_reason = $2 where id = $1 returning {_PET_COLUMNS}",
        pet_id,
        body.reason,
    )
    if row is None:
        raise _NO_SUCH_PET
    return PetOut(**dict(row))


@router.post("/pets/{pet_id}/restore", response_model=PetOut)
async def restore_pet(
    pet_id: UUID,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> PetOut:
    """Both archive columns clear together; same slug, entries and photo."""
    row = await conn.fetchrow(
        f"update pawpages_pets set archived_at = null, archived_reason = null where id = $1 returning {_PET_COLUMNS}",
        pet_id,
    )
    if row is None:
        raise _NO_SUCH_PET
    return PetOut(**dict(row))


@router.get("/pets/{pet_id}/photo")
async def read_photo(
    pet_id: UUID,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> Response:
    path = await conn.fetchval("select photo_path from pawpages_pets where id = $1", pet_id)
    if path is None:
        raise _NO_SUCH_PHOTO
    try:
        data = await storage.get(handler.access_token, path)
    except storage.StorageError:
        raise _NO_SUCH_PHOTO
    # A replacement gets a new path behind this same URL, so no caching.
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return Response(data, media_type=media_type, headers={"cache-control": "no-store"})


@router.put("/pets/{pet_id}/photo", response_model=PetOut)
async def put_photo(
    pet_id: UUID,
    request: Request,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> PetOut:
    """Upload, point the row at it, then delete what it replaced -- in that
    order, so a failure anywhere leaves the pet with a photo that resolves.
    The body is the file itself, under its own content type."""
    content = await request.body()
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in _PHOTO_EXTENSIONS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"field": "photo", "message": "Choose a JPEG, PNG, WebP or HEIC image."},
        )
    if len(content) > _MAX_PHOTO_BYTES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"field": "photo", "message": "That image is over 5 MB. Choose a smaller one."},
        )

    previous = await conn.fetchrow("select photo_path from pawpages_pets where id = $1", pet_id)
    if previous is None:
        raise _NO_SUCH_PET
    # {pet_id}/... is what 0004's pet photo policies key off. A fresh name
    # every time, so the old object is still there to delete.
    path = f"{pet_id}/{secrets.token_hex(8)}{_PHOTO_EXTENSIONS[content_type]}"
    await storage.put(handler.access_token, path, content, content_type)
    row = await conn.fetchrow(
        f"update pawpages_pets set photo_path = $2 where id = $1 returning {_PET_COLUMNS}", pet_id, path
    )
    await _remove_quietly(handler, previous["photo_path"])
    return PetOut(**dict(row))


@router.delete("/pets/{pet_id}/photo", response_model=PetOut)
async def delete_photo(
    pet_id: UUID,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> PetOut:
    previous = await conn.fetchrow("select photo_path from pawpages_pets where id = $1", pet_id)
    if previous is None:
        raise _NO_SUCH_PET
    row = await conn.fetchrow(
        f"update pawpages_pets set photo_path = null where id = $1 returning {_PET_COLUMNS}", pet_id
    )
    await _remove_quietly(handler, previous["photo_path"])
    return PetOut(**dict(row))


async def _remove_quietly(handler: AuthenticatedHandler, path: str | None) -> None:
    """The row no longer names it, so a failed delete only leaves an orphan
    -- not worth failing a request the handler already saw succeed."""
    if path:
        try:
            await storage.delete(handler.access_token, path)
        except storage.StorageError:
            pass
