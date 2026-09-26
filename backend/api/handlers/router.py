"""The account screen's routes, ported from v1's backend/app/main.py: read
and correct the handler, change the email and password (Supabase Auth's to
change, asked with the handler's own token), download everything, and
delete the account.

No `where id = ...` on pawpages_handlers anywhere: the RLS connection has
already become the caller, so pawpages_handler_reads_self /
pawpages_handler_updates_self are the filter.
"""

import io
import json
import logging
import re
import zipfile
from pathlib import PurePosixPath

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse

from auth import gotrue
from auth.cookies import clear_session_cookie
from auth.dependencies import AuthenticatedHandler, get_current_handler
from core.config import get_settings
from db.rls import rls_connection
from uploads import storage

from .schemas import EmailIn, MeOut, MePatch, PasswordIn

logger = logging.getLogger(__name__)

router = APIRouter(tags=["handlers"])

# The two counts need no `where handler_id = ...`: the same policies that
# filter pawpages_handlers filter pets and entries.
_ME_COLUMNS = """id::text, name, created_at::date as joined_on,
       date_of_birth, gender, nationality,
       extract(year from age(date_of_birth))::int as age,
       (select count(*) from pawpages_pets) as pet_count,
       (select count(*) from pawpages_entries) as entry_count"""


async def _read_me(conn: asyncpg.Connection, email: str) -> MeOut:
    row = await conn.fetchrow(f"select {_ME_COLUMNS} from pawpages_handlers")
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not signed in")
    return MeOut(**dict(row), email=email)


def _field_error(field: str, message: str, code: int = status.HTTP_422_UNPROCESSABLE_CONTENT) -> HTTPException:
    """The {field, message} shape the web app shows beside the input."""
    return HTTPException(code, {"field": field, "message": message})


@router.get("/me", response_model=MeOut)
async def me(
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> MeOut:
    return await _read_me(conn, handler.email)


@router.patch("/me", response_model=MeOut)
async def update_me(
    body: MePatch,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> MeOut:
    changes = body.model_dump(exclude_unset=True)
    if changes:
        assignments = ", ".join(f"{column} = ${n}" for n, column in enumerate(changes, start=1))
        try:
            await conn.execute(f"update pawpages_handlers set {assignments}", *changes.values())
        except asyncpg.CheckViolationError as exc:
            # pawpages_handlers_<column>_check names the column it guards.
            column = re.fullmatch(r"pawpages_handlers_(.+)_check", exc.constraint_name or "")
            raise _field_error(column.group(1) if column else "name", "That value is not allowed.")
    return await _read_me(conn, handler.email)


@router.patch("/me/email", response_model=MeOut)
async def update_my_email(
    body: EmailIn,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> MeOut:
    try:
        user = await gotrue.update_email(handler.access_token, body.email)
    except gotrue.GoTrueError as exc:
        if "already" in exc.message.lower():
            raise _field_error("email", "That email already has an account.", status.HTTP_409_CONFLICT)
        raise _field_error("email", exc.message)
    # With email confirmation on, Supabase keeps the old address until the
    # link sent to the new one is followed -- so report what it says now.
    return await _read_me(conn, user.get("email") or handler.email)


@router.patch("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def update_my_password(
    body: PasswordIn,
    handler: AuthenticatedHandler = Depends(get_current_handler),
) -> None:
    try:
        await gotrue.update_password(handler.access_token, body.password)
    except gotrue.GoTrueError as exc:
        raise _field_error("password", exc.message)


# Everything the handler ever typed. Runs on the RLS connection, so the
# policies are the filter.
_EXPORT_PETS = """select id, name, species, breed, sex, date_of_birth, dob_is_approx, colour,
       slug, is_public, archived_at, archived_reason, photo_path, created_at
from pawpages_pets order by created_at"""
_EXPORT_ENTRIES = """select id, pet_id, title, happened_on, due_on, due_closed_at, vet, note,
       weight_value, weight_unit, photo_path, photo_is_public, created_at
from pawpages_entries order by happened_on, id"""


@router.get("/me/export")
async def export_account(
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> StreamingResponse:
    """One zip: paw-pages.json with every pet and its entries, plus each
    photo under a name the handler will recognise. The storage path itself
    never leaves the backend."""
    account = (await _read_me(conn, handler.email)).model_dump()
    pets = [dict(r) for r in await conn.fetch(_EXPORT_PETS)]
    entries = [dict(r) for r in await conn.fetch(_EXPORT_ENTRIES)]

    by_pet: dict = {}
    for entry in entries:
        by_pet.setdefault(entry.pop("pet_id"), []).append(entry)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for pet in pets:
            pet["photo"] = await _add_photo(archive, handler, pet.pop("photo_path"), f"photos/{pet['slug']}")
            pet["entries"] = by_pet.get(pet["id"], [])
            for entry in pet["entries"]:
                entry["photo"] = await _add_photo(
                    archive, handler, entry.pop("photo_path"), f"photos/entries/{entry['id']}"
                )
        archive.writestr("paw-pages.json", json.dumps({"handler": account, "pets": pets}, indent=2, default=str))
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"content-disposition": 'attachment; filename="paw-pages-export.zip"'},
    )


async def _add_photo(archive: zipfile.ZipFile, handler: AuthenticatedHandler, path: str | None, name: str) -> str | None:
    """Writes the photo into the archive and returns its name there, or None
    when there's no photo -- or it's gone from storage, which shouldn't stop
    the rest of the export."""
    if not path:
        return None
    try:
        data = await storage.get(handler.access_token, path)
    except storage.StorageError as exc:
        logger.warning("Export skipped a photo it couldn't read: %s", exc)
        return None
    name += PurePosixPath(path).suffix
    archive.writestr(name, data)
    return name


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    response: Response,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> None:
    """Storage first, auth user second: the foreign-key cascade from
    auth.users removes every row, but it doesn't reach storage, and once the
    rows are gone nothing knows which objects were theirs."""
    service_role_key = get_settings().supabase_service_role_key
    if not service_role_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Account deletion is unavailable: SUPABASE_SERVICE_ROLE_KEY is not set."
        )

    paths = await conn.fetch(
        "select photo_path as path from pawpages_pets where photo_path is not null"
        " union select photo_path from pawpages_entries where photo_path is not null"
        " union select storage_path from pawpages_uploads"
    )
    for row in paths:
        try:
            await storage.delete(handler.access_token, row["path"])
        except storage.StorageError as exc:
            # Already gone is fine; anything else leaves an orphan, which is
            # better than a half-deleted account.
            logger.warning("Account deletion couldn't remove a stored object: %s", exc)

    try:
        await gotrue.admin_delete_user(handler.id, service_role_key)
    except gotrue.GoTrueError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The account could not be deleted. Try again.")
    clear_session_cookie(response)
    logger.info("Deleted account %s", handler.email)
