"""Entry photos: one per entry, out of the same private bucket as a pet's.

The path shape is the pet's — `{pet_id}/{filename}` — so 0004's four handler
policies cover these without a new rule. What these tests prove is the part
storage cannot: that an object is removed whenever the row pointing at it goes
away, because nothing else will ever remove it.
"""

import zipfile
from datetime import date
from io import BytesIO

import pytest

TODAY = date.today().isoformat()

JPEG = b"\xff\xd8\xff\xe0 not really a jpeg, but the bucket only reads the type"
PNG = b"\x89PNG\r\n\x1a\n not really a png either"


@pytest.fixture
async def signed_in(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})
    return client


@pytest.fixture
async def biscuit(signed_in):
    return (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()["id"]


@pytest.fixture
async def entry(signed_in, biscuit):
    created = await signed_in.post(
        "/entries", json={"pet_id": biscuit, "title": "Vet visit", "happened_on": TODAY}
    )
    return created.json()["id"]


def upload(client, entry_id, content=JPEG, content_type="image/jpeg"):
    return client.put(
        f"/entries/{entry_id}/photo", content=content, headers={"content-type": content_type}
    )


async def test_a_photo_is_uploaded_for_an_entry(signed_in, entry, storage_stub):
    saved = await upload(signed_in, entry)

    assert saved.status_code == 200
    assert saved.json()["has_photo"] is True
    assert len(storage_stub.objects) == 1


async def test_an_entry_starts_with_no_photo(signed_in, entry):
    read = await signed_in.get(f"/entries/{entry}/photo")

    assert read.status_code == 404


async def test_the_photo_comes_back_as_the_bytes_that_went_in(signed_in, entry, storage_stub):
    await upload(signed_in, entry)

    read = await signed_in.get(f"/entries/{entry}/photo")

    assert read.status_code == 200
    assert read.content == JPEG
    assert read.headers["content-type"] == "image/jpeg"


async def test_the_photo_is_stored_under_the_pet_that_owns_the_entry(
    signed_in, biscuit, entry, storage_stub
):
    # Segment one is what every policy in 0004 keys off. If it were the entry
    # id instead, all four would deny and this feature would need a migration.
    await upload(signed_in, entry)

    path = next(iter(storage_stub.objects))
    assert path.split("/")[0] == biscuit


async def test_replacing_a_photo_leaves_nothing_behind(signed_in, entry, storage_stub):
    await upload(signed_in, entry)
    first = next(iter(storage_stub.objects))

    await upload(signed_in, entry, content=PNG, content_type="image/png")

    assert first not in storage_stub.objects
    assert len(storage_stub.objects) == 1


async def test_deleting_the_photo_removes_the_object(signed_in, entry, storage_stub):
    await upload(signed_in, entry)

    removed = await signed_in.delete(f"/entries/{entry}/photo")

    assert removed.status_code == 200
    assert removed.json()["has_photo"] is False
    assert storage_stub.objects == {}


async def test_deleting_the_entry_removes_its_photo(signed_in, entry, storage_stub):
    # Storage has no foreign keys: the cascade that removes the row cannot
    # reach the object, so the endpoint has to.
    await upload(signed_in, entry)

    await signed_in.delete(f"/entries/{entry}")

    assert storage_stub.objects == {}


async def test_closing_the_account_takes_entry_photos_with_it(
    signed_in, entry, storage_stub, admin_stub
):
    await upload(signed_in, entry)

    await signed_in.delete("/me")

    assert storage_stub.objects == {}


async def test_a_file_that_is_not_an_image_comes_back_named(signed_in, entry):
    rejected = await upload(signed_in, entry, content=b"%PDF-1.4", content_type="application/pdf")

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "photo"


async def test_a_photo_on_someone_elses_entry_is_not_found(
    signed_in, entry, seed_handler, client, storage_stub
):
    await seed_handler("Priya", "priya@example.com")
    await client.post("/auth/signin", json={"email": "priya@example.com", "password": "x"})

    refused = await upload(client, entry)

    assert refused.status_code == 404
    assert storage_stub.objects == {}


async def test_an_entry_photo_is_not_on_the_public_page(signed_in, biscuit, entry, storage_stub):
    # `public_entries` never carried a photo and this did not change that. A
    # visitor gets the pet's picture and nothing from the record itself.
    await upload(signed_in, entry)
    await signed_in.patch(f"/pets/{biscuit}", json={"is_public": True})
    slug = (await signed_in.get(f"/pets/{biscuit}")).json()["slug"]

    page = await signed_in.get(f"/public/pets/{slug}")

    assert page.status_code == 200
    assert all("photo" not in line for line in page.json()["entries"][0])


async def test_the_export_carries_an_entry_photo(signed_in, entry, storage_stub):
    await upload(signed_in, entry)

    archive = await signed_in.get("/me/export")

    names = zipfile.ZipFile(BytesIO(archive.content)).namelist()
    assert f"photos/entries/{entry}.jpg" in names
