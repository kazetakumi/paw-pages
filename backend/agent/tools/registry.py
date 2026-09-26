"""Tool schemas offered to the chat model, and the DB-backed functions that
answer them. execute_tool takes the caller's RLS-scoped asyncpg connection
as a parameter rather than opening one of its own -- this module has no
connection to hand out. pawpages_handler_owns_entries (via the pet's
handler_id) means a tool never has to check ownership itself; Postgres
refuses to touch a row RLS says isn't the caller's.
"""

import base64
import json
import re
import secrets
from collections.abc import Awaitable, Callable
from datetime import date

import asyncpg
import pymupdf
from ocr_engine.extract import extract_text_from_bytes, render_page_image_from_bytes

# Reads an upload's bytes out of storage as the handler -- the API layer
# supplies it, since this module has no storage access of its own.
FetchFile = Callable[[str], Awaitable[bytes]]


def _photo_upload_id(what: str) -> dict:
    return {
        "type": ["string", "null"],
        "description": (
            f"{what}: the upload_id from a '[photo attached, upload_id: ...]' line in the handler's "
            "message, or null for no photo. Each photo can be filed once."
        ),
    }


TOOLS = [
    {
        "type": "function",
        "name": "list_active_pets",
        "description": "List the handler's pets that are not archived -- what shows up in the app today.",
        "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        "strict": True,
    },
    {
        "type": "function",
        "name": "list_archived_pets",
        "description": "List the handler's archived pets -- passed away, rehomed, or otherwise no longer tracked day to day.",
        "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        "strict": True,
    },
    {
        "type": "function",
        "name": "create_pet",
        "description": (
            "Add a new pet for the handler. The slug for its public page is generated from its "
            "name automatically -- there's no way to choose it here."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "The pet's name. 1-60 characters."},
                "species": {"type": "string", "description": "e.g. 'dog', 'cat', 'rabbit'. Free text, 1-40 characters."},
                "breed": {"type": ["string", "null"], "description": "Breed, or null. Up to 60 characters."},
                "sex": {"type": ["string", "null"], "enum": ["male", "female", None], "description": "The pet's sex, or null if unknown."},
                "date_of_birth": {"type": ["string", "null"], "description": "Date of birth, YYYY-MM-DD, or null if unknown. Cannot be in the future."},
                "dob_is_approx": {
                    "type": "boolean",
                    "description": "true if date_of_birth is a guess rather than exact. Must be false when date_of_birth is null.",
                },
                "colour": {"type": ["string", "null"], "description": "Colour/markings, or null. Up to 60 characters."},
                "is_public": {
                    "type": "boolean",
                    "description": "Whether the pet gets a public page right away. Ask the handler before setting this true.",
                },
                "photo_upload_id": _photo_upload_id("The pet's profile photo"),
            },
            "required": ["name", "species", "breed", "sex", "date_of_birth", "dob_is_approx", "colour", "is_public", "photo_upload_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "update_pet",
        "description": (
            "Change fields on an existing pet. Only fields given a non-null value are changed. "
            "Never touches the pet's slug/public URL, and doesn't archive it -- use delete_pet for that."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pet_id": {"type": "string", "description": "The pet's id, from list_active_pets, list_archived_pets, or get_pet."},
                "name": {"type": ["string", "null"], "description": "New name, or null to leave unchanged."},
                "species": {"type": ["string", "null"], "description": "New species, or null to leave unchanged."},
                "breed": {"type": ["string", "null"], "description": "New breed, or null to leave unchanged."},
                "sex": {"type": ["string", "null"], "enum": ["male", "female", None], "description": "New sex, or null to leave unchanged."},
                "date_of_birth": {"type": ["string", "null"], "description": "New date of birth, YYYY-MM-DD, or null to leave unchanged."},
                "dob_is_approx": {"type": ["boolean", "null"], "description": "Whether the date of birth is approximate, or null to leave unchanged."},
                "colour": {"type": ["string", "null"], "description": "New colour/markings, or null to leave unchanged."},
                "is_public": {"type": ["boolean", "null"], "description": "Turn the pet's public page on or off, or null to leave unchanged."},
                "photo_upload_id": _photo_upload_id("A new profile photo for the pet"),
            },
            "required": ["pet_id", "name", "species", "breed", "sex", "date_of_birth", "dob_is_approx", "colour", "is_public", "photo_upload_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_pet",
        "description": "Get the full detail of one pet by id.",
        "parameters": {
            "type": "object",
            "properties": {"pet_id": {"type": "string", "description": "The pet's id, from list_active_pets or list_archived_pets."}},
            "required": ["pet_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "delete_pet",
        "description": (
            "Archive a pet -- passed away, rehomed, or otherwise no longer tracked day to day. "
            "Does not delete the pet or its entries, just moves it off the active list and takes "
            "its public page offline; it still shows up via list_archived_pets. Confirm with the "
            "handler before calling it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pet_id": {"type": "string", "description": "The pet's id, from list_active_pets or get_pet."},
                "archived_reason": {
                    "type": "string",
                    "enum": ["passed_away", "rehomed", "other"],
                    "description": "Why the pet is being archived.",
                },
            },
            "required": ["pet_id", "archived_reason"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "create_entry",
        "description": (
            "Log a new entry for one of the handler's pets -- a vet visit, a shot, a grooming, "
            "anything worth recording. Call list_active_pets or list_archived_pets first if you "
            "don't already have the pet's id."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pet_id": {"type": "string", "description": "The pet's id, from list_active_pets or list_archived_pets."},
                "title": {"type": "string", "description": "What happened, e.g. 'Rabies shot' or 'Nail trim'. 1-120 characters."},
                "happened_on": {"type": "string", "description": "Date it happened, YYYY-MM-DD. Cannot be in the future."},
                "due_on": {
                    "type": ["string", "null"],
                    "description": "Date the next one is due, YYYY-MM-DD, or null if nothing is due. Cannot be before happened_on.",
                },
                "vet": {"type": ["string", "null"], "description": "Vet or clinic name, or null."},
                "note": {"type": ["string", "null"], "description": "Free-text note, up to 2000 characters, or null. Never shown on the pet's public page."},
                "photo_upload_id": _photo_upload_id("A photo for the entry, e.g. a vaccination certificate"),
            },
            "required": ["pet_id", "title", "happened_on", "due_on", "vet", "note", "photo_upload_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "update_entry",
        "description": (
            "Change fields on an existing entry, including marking its due date done or reopening "
            "it. Only the fields given a non-null value are changed; there is currently no way to "
            "clear an existing due date through this tool, only to close or reopen it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "entry_id": {"type": "string", "description": "The entry's id, from list_entries or get_entry."},
                "title": {"type": ["string", "null"], "description": "New title, or null to leave unchanged."},
                "happened_on": {"type": ["string", "null"], "description": "New date it happened, YYYY-MM-DD, or null to leave unchanged."},
                "due_on": {"type": ["string", "null"], "description": "New due date, YYYY-MM-DD, or null to leave unchanged."},
                "vet": {"type": ["string", "null"], "description": "New vet/clinic name, or null to leave unchanged."},
                "note": {"type": ["string", "null"], "description": "New note, or null to leave unchanged."},
                "due_closed": {
                    "type": ["boolean", "null"],
                    "description": "true marks the due date done now, false reopens it, null leaves it as is.",
                },
                "photo_upload_id": _photo_upload_id("A new photo for the entry"),
            },
            "required": ["entry_id", "title", "happened_on", "due_on", "vet", "note", "due_closed", "photo_upload_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "list_entries",
        "description": "List one pet's logged entries, newest first.",
        "parameters": {
            "type": "object",
            "properties": {"pet_id": {"type": "string", "description": "The pet's id, from list_active_pets or list_archived_pets."}},
            "required": ["pet_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_entry",
        "description": "Get the full detail of one entry by id, including its note and vet.",
        "parameters": {
            "type": "object",
            "properties": {"entry_id": {"type": "string", "description": "The entry's id, from list_entries."}},
            "required": ["entry_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "read_document",
        "description": (
            "Read a PDF the handler attached earlier -- a '[document attached, upload_id: ...]' line. "
            "You get a document's contents automatically on the turn it's sent; call this only to look "
            "at it again on a later turn. A scanned PDF comes back as page images rather than text."
        ),
        "parameters": {
            "type": "object",
            "properties": {"upload_id": {"type": "string", "description": "The document's upload_id."}},
            "required": ["upload_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "delete_entry",
        "description": "Permanently delete one entry by id. This cannot be undone -- confirm with the handler before calling it.",
        "parameters": {
            "type": "object",
            "properties": {"entry_id": {"type": "string", "description": "The entry's id, from list_entries."}},
            "required": ["entry_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]

_ENTRY_COLUMNS = "id, pet_id, title, happened_on, due_on, due_closed_at, vet, note, photo_path"
_PET_COLUMNS = "id, name, species, breed, sex, date_of_birth, dob_is_approx, colour, slug, is_public, archived_at, archived_reason, photo_path"


class _ToolError(Exception):
    """Returned to the model as {"error": ...}. Raised rather than returned
    so execute_tool's savepoint rolls back whatever the tool already wrote."""


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


async def _attach_photo(conn: asyncpg.Connection, row: dict, upload_id: str | None, *, table: str) -> dict:
    """Claims the upload for the pet or entry `row` and points its
    photo_path at it -- the object stays where it is (see
    dbschema/uploads.html). A no-op when upload_id is null. A photo it
    replaces stays in storage, unreferenced."""
    if not upload_id:
        return row
    claim_column = "claimed_by_pet_id" if table == "pawpages_pets" else "claimed_by_entry_id"
    path = await conn.fetchval(
        f"update pawpages_uploads set {claim_column} = $2, claimed_at = now() "
        "where id = $1 and claimed_at is null returning storage_path",
        upload_id,
        row["id"],
    )
    if path is None:
        raise _ToolError("no unfiled photo with that upload_id")
    await conn.execute(f"update {table} set photo_path = $2 where id = $1", row["id"], path)
    return {**row, "photo_path": path}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "pet"


async def _list_active_pets(conn: asyncpg.Connection, args: dict) -> list[dict]:
    rows = await conn.fetch(f"select {_PET_COLUMNS} from pawpages_pets where archived_at is null order by name")
    return [dict(row) for row in rows]


async def _list_archived_pets(conn: asyncpg.Connection, args: dict) -> list[dict]:
    rows = await conn.fetch(
        f"select {_PET_COLUMNS} from pawpages_pets where archived_at is not null order by archived_at desc"
    )
    return [dict(row) for row in rows]


async def _create_pet(conn: asyncpg.Connection, args: dict) -> dict:
    base_slug = _slugify(args["name"])
    slug = base_slug
    # A collision is only detectable by the unique constraint itself -- RLS
    # hides other handlers' pets from any pre-check select -- so retry on
    # conflict rather than checking first. Each attempt gets its own
    # savepoint: a failed insert aborts up to that point, not the whole
    # request, so the next attempt (or the next tool call) still works.
    for _ in range(6):
        try:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "insert into pawpages_pets "
                    "(handler_id, name, species, breed, sex, date_of_birth, dob_is_approx, colour, slug, is_public) "
                    "values ((select auth.uid()), $1, $2, $3, $4, $5, $6, $7, $8, $9) "
                    f"returning {_PET_COLUMNS}",
                    args["name"],
                    args["species"],
                    args["breed"],
                    args["sex"],
                    _parse_date(args["date_of_birth"]),
                    args["dob_is_approx"],
                    args["colour"],
                    slug,
                    args["is_public"],
                )
        except asyncpg.UniqueViolationError:
            slug = f"{base_slug}-{secrets.token_hex(2)}"
            continue
        return await _attach_photo(conn, dict(row), args["photo_upload_id"], table="pawpages_pets")
    return {"error": "could not find a free slug for that name"}


async def _update_pet(conn: asyncpg.Connection, args: dict) -> dict:
    row = await conn.fetchrow(
        f"""
        update pawpages_pets set
          name = coalesce($2, name),
          species = coalesce($3, species),
          breed = coalesce($4, breed),
          sex = coalesce($5, sex),
          date_of_birth = coalesce($6, date_of_birth),
          dob_is_approx = coalesce($7, dob_is_approx),
          colour = coalesce($8, colour),
          is_public = coalesce($9, is_public)
        where id = $1
        returning {_PET_COLUMNS}
        """,
        args["pet_id"],
        args["name"],
        args["species"],
        args["breed"],
        args["sex"],
        _parse_date(args["date_of_birth"]),
        args["dob_is_approx"],
        args["colour"],
        args["is_public"],
    )
    if not row:
        return {"error": "no pet with that id"}
    return await _attach_photo(conn, dict(row), args["photo_upload_id"], table="pawpages_pets")


async def _get_pet(conn: asyncpg.Connection, args: dict) -> dict:
    row = await conn.fetchrow(f"select {_PET_COLUMNS} from pawpages_pets where id = $1", args["pet_id"])
    return dict(row) if row else {"error": "no pet with that id"}


async def _delete_pet(conn: asyncpg.Connection, args: dict) -> dict:
    row = await conn.fetchrow(
        "update pawpages_pets set archived_at = now(), archived_reason = $2 "
        "where id = $1 returning id, archived_at, archived_reason",
        args["pet_id"],
        args["archived_reason"],
    )
    return dict(row) if row else {"error": "no pet with that id"}


async def _create_entry(conn: asyncpg.Connection, args: dict) -> dict:
    row = await conn.fetchrow(
        f"insert into pawpages_entries (pet_id, title, happened_on, due_on, vet, note) "
        f"values ($1, $2, $3, $4, $5, $6) returning {_ENTRY_COLUMNS}",
        args["pet_id"],
        args["title"],
        _parse_date(args["happened_on"]),
        _parse_date(args["due_on"]),
        args["vet"],
        args["note"],
    )
    return await _attach_photo(conn, dict(row), args["photo_upload_id"], table="pawpages_entries")


async def _update_entry(conn: asyncpg.Connection, args: dict) -> dict:
    row = await conn.fetchrow(
        f"""
        update pawpages_entries set
          title = coalesce($2, title),
          happened_on = coalesce($3, happened_on),
          due_on = coalesce($4, due_on),
          vet = coalesce($5, vet),
          note = coalesce($6, note),
          due_closed_at = case
            when $7 is true then coalesce(due_closed_at, now())
            when $7 is false then null
            else due_closed_at
          end
        where id = $1
        returning {_ENTRY_COLUMNS}
        """,
        args["entry_id"],
        args["title"],
        _parse_date(args["happened_on"]),
        _parse_date(args["due_on"]),
        args["vet"],
        args["note"],
        args["due_closed"],
    )
    if not row:
        return {"error": "no entry with that id"}
    return await _attach_photo(conn, dict(row), args["photo_upload_id"], table="pawpages_entries")


async def _list_entries(conn: asyncpg.Connection, args: dict) -> list[dict]:
    rows = await conn.fetch(
        f"select {_ENTRY_COLUMNS} from pawpages_entries where pet_id = $1 order by happened_on desc, id desc",
        args["pet_id"],
    )
    return [dict(row) for row in rows]


async def _get_entry(conn: asyncpg.Connection, args: dict) -> dict:
    row = await conn.fetchrow(f"select {_ENTRY_COLUMNS} from pawpages_entries where id = $1", args["entry_id"])
    return dict(row) if row else {"error": "no entry with that id"}


async def _delete_entry(conn: asyncpg.Connection, args: dict) -> dict:
    result = await conn.execute("delete from pawpages_entries where id = $1", args["entry_id"])
    return {"deleted": result == "DELETE 1"}


_MAX_DOCUMENT_CHARS = 20_000
_MAX_SCANNED_PAGES = 5


def document_parts(upload_id: str, data: bytes) -> list[dict]:
    """A PDF's contents as content parts for the model. Text straight from
    its text layer when it has one -- cheap, no vision. A scanned PDF has
    none, so its first few pages go as images for the model to read itself.
    Used both when a PDF is sent (conversations router) and by
    read_document."""
    try:
        result = extract_text_from_bytes(data)
    except pymupdf.FileDataError:
        return [{"type": "input_text", "text": f"[document {upload_id} couldn't be opened]"}]

    if not result.needs_vision_fallback:
        text = result.full_text
        cut = " (cut short)" if len(text) > _MAX_DOCUMENT_CHARS else ""
        return [{
            "type": "input_text",
            "text": f"[contents of document {upload_id}, {result.page_count} page(s){cut}]\n{text[:_MAX_DOCUMENT_CHARS]}",
        }]

    shown = min(result.page_count, _MAX_SCANNED_PAGES)
    return [
        {
            "type": "input_text",
            "text": f"[document {upload_id} is a scanned PDF, {result.page_count} page(s); images of the first {shown} follow]",
        },
        *(
            {
                "type": "input_image",
                "image_url": "data:image/png;base64,"
                + base64.b64encode(render_page_image_from_bytes(data, n, dpi=150)).decode(),
            }
            for n in range(1, shown + 1)
        ),
    ]


async def _read_document(conn: asyncpg.Connection, args: dict, fetch_file: FetchFile) -> list[dict]:
    row = await conn.fetchrow(
        "select storage_path, content_type from pawpages_uploads where id = $1", args["upload_id"]
    )
    if row is None:
        raise _ToolError("no upload with that id")
    if row["content_type"] != "application/pdf":
        raise _ToolError("that upload is a photo, not a PDF -- you saw it on the turn it was sent")
    return document_parts(args["upload_id"], await fetch_file(row["storage_path"]))


_HANDLERS = {
    "list_active_pets": _list_active_pets,
    "list_archived_pets": _list_archived_pets,
    "create_pet": _create_pet,
    "update_pet": _update_pet,
    "get_pet": _get_pet,
    "delete_pet": _delete_pet,
    "create_entry": _create_entry,
    "update_entry": _update_entry,
    "list_entries": _list_entries,
    "get_entry": _get_entry,
    "delete_entry": _delete_entry,
}


async def execute_tool(conn: asyncpg.Connection, name: str, arguments: str, fetch_file: FetchFile) -> str | list[dict]:
    """Runs one tool call and returns its output as a function_call_output
    item expects: a JSON string, or a list of content parts when the output
    comes as content parts (read_document). Wrapped in its own
    savepoint: a constraint or RLS violation aborts up to here, not the
    request's whole transaction, so the model can see the error, try
    something else, and the message writes at the end of the request still
    goes through."""
    args = json.loads(arguments) if arguments else {}
    try:
        async with conn.transaction():
            if name == "read_document":
                return await _read_document(conn, args, fetch_file)
            result = await _HANDLERS[name](conn, args)
    except (asyncpg.PostgresError, _ToolError) as exc:
        result = {"error": str(exc)}
    return json.dumps(result, default=str)
