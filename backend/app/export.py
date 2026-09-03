"""The whole account as one archive, built on request and streamed.

There is no job queue in v1 and at this scale there does not need to be: a
handler's records zip while they wait. A pet's history is theirs regardless of
what happens to this app, so the archive is plain JSON plus the photo files as
they were uploaded, readable without this app or any other.
"""

import json
import tempfile
import zipfile
from pathlib import PurePosixPath
from typing import Iterator

FILENAME = "paw-pages-export.zip"
DOCUMENT = "paw-pages.json"

# Everything the handler ever typed, columns and all. No `where handler_id =
# ...`: this runs on the RLS connection, so the policies are the filter.
PETS = """select id, name, species, breed, sex, date_of_birth, dob_is_approx, colour,
       slug, is_public, archived_at, archived_reason, photo_path, created_at
from pets order by created_at"""

ENTRIES = """select id, pet_id, title, happened_on, due_on, due_closed_at, vet, note,
       weight_value, weight_unit, photo_path, created_at
from entries order by happened_on, id"""


def entry_photo_name(entry_id: str, path: str) -> str:
    """An entry's photo under its own id, so two entries on one pet cannot
    collide the way two names could."""
    return f"photos/entries/{entry_id}{PurePosixPath(path).suffix}"


def photo_name(slug: str, path: str) -> str:
    """The photo under a name the handler will recognise, keeping the type the
    file had. The storage path itself never leaves the backend."""
    return f"photos/{slug}{PurePosixPath(path).suffix}"


def build(account: dict, pets: list[dict], entries: list[dict], photos: dict[str, bytes]):
    """The archive, on disk once it outgrows memory, rewound and ready to send."""
    by_pet: dict = {}
    for entry in entries:
        by_pet.setdefault(entry.pop("pet_id"), []).append(entry)

    for pet in pets:
        path = pet.pop("photo_path")
        pet["photo"] = photo_name(pet["slug"], path) if path else None
        pet["entries"] = by_pet.get(pet["id"], [])

    buffer = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            DOCUMENT, json.dumps({"handler": account, "pets": pets}, indent=2, default=str)
        )
        for name, content in photos.items():
            archive.writestr(name, content)
    buffer.seek(0)
    return buffer


def chunks(buffer, size: int = 64 * 1024) -> Iterator[bytes]:
    try:
        while block := buffer.read(size):
            yield block
    finally:
        buffer.close()
