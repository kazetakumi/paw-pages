"""Publishing an entry photo, one entry at a time.

The point of these is the default. An entry photo is private until the handler
says otherwise, and stays private when the flag is off, when the pet is private
and when the pet is archived — each of which is a separate way in, so each gets
its own test. A visitor reads as `anon` throughout: what they can see is
decided by `pawpages_public_entries` and the storage policies, not by the route.
"""

from datetime import date

import pytest

TODAY = date.today().isoformat()

JPEG = b"\xff\xd8\xff\xe0 not really a jpeg, but the bucket only reads the type"


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
        "/entries",
        json={"pet_id": biscuit, "title": "Rabies booster", "happened_on": TODAY},
    )
    return created.json()["id"]


async def publish_pet(client, pet_id) -> str:
    await client.patch(f"/pets/{pet_id}", json={"is_public": True})
    return (await client.get(f"/pets/{pet_id}")).json()["slug"]


async def upload(client, entry_id):
    return await client.put(
        f"/entries/{entry_id}/photo", content=JPEG, headers={"content-type": "image/jpeg"}
    )


async def test_a_new_entry_keeps_its_photo_private(signed_in, entry, storage_stub):
    saved = await upload(signed_in, entry)

    assert saved.json()["photo_is_public"] is False


async def test_a_published_photo_reaches_the_public_page(
    signed_in, biscuit, entry, storage_stub, client
):
    await upload(signed_in, entry)
    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": True})
    slug = await publish_pet(signed_in, biscuit)

    page = await client.get(f"/public/pets/{slug}")

    line = page.json()["entries"][0]
    assert line["title"] == "Rabies booster"
    assert line["photo_id"] == entry


async def test_the_published_photo_is_the_bytes_that_went_in(
    signed_in, biscuit, entry, storage_stub, client
):
    await upload(signed_in, entry)
    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": True})
    slug = await publish_pet(signed_in, biscuit)

    shown = await client.get(f"/public/pets/{slug}/entries/{entry}/photo")

    assert shown.status_code == 200
    assert shown.content == JPEG


async def test_an_unpublished_photo_stays_off_the_page(
    signed_in, biscuit, entry, storage_stub, client
):
    await upload(signed_in, entry)
    slug = await publish_pet(signed_in, biscuit)

    page = await client.get(f"/public/pets/{slug}")
    shown = await client.get(f"/public/pets/{slug}/entries/{entry}/photo")

    assert page.json()["entries"][0]["photo_id"] is None
    assert shown.status_code == 404


async def test_unpublishing_takes_the_photo_back(
    signed_in, biscuit, entry, storage_stub, client
):
    await upload(signed_in, entry)
    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": True})
    slug = await publish_pet(signed_in, biscuit)

    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": False})

    assert (await client.get(f"/public/pets/{slug}/entries/{entry}/photo")).status_code == 404


async def test_a_published_photo_on_a_private_pet_is_not_reachable(
    signed_in, biscuit, entry, storage_stub, client
):
    # The pet's own switch still governs. Publishing the photo of an entry on a
    # pet nobody can see publishes nothing.
    await upload(signed_in, entry)
    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": True})
    slug = (await signed_in.get(f"/pets/{biscuit}")).json()["slug"]

    shown = await client.get(f"/public/pets/{slug}/entries/{entry}/photo")

    assert shown.status_code == 404


async def test_archiving_the_pet_takes_a_published_photo_down(
    signed_in, biscuit, entry, storage_stub, client
):
    await upload(signed_in, entry)
    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": True})
    slug = await publish_pet(signed_in, biscuit)

    await signed_in.post(f"/pets/{biscuit}/archive", json={"reason": "rehomed"})

    assert (await client.get(f"/public/pets/{slug}/entries/{entry}/photo")).status_code == 404


async def test_the_visitor_reads_a_published_photo_as_anon(
    signed_in, biscuit, entry, storage_stub, client
):
    # The bearer proves nothing was borrowed from the handler's session: the
    # storage policy is what allowed this, not a token that can see everything.
    from app.config import settings

    await upload(signed_in, entry)
    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": True})
    slug = await publish_pet(signed_in, biscuit)
    storage_stub.calls.clear()

    await client.get(f"/public/pets/{slug}/entries/{entry}/photo")

    assert storage_stub.calls[-1][2] == settings.supabase_anon_key


async def test_an_entry_with_no_photo_publishes_nothing(
    signed_in, biscuit, entry, storage_stub, client
):
    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": True})
    slug = await publish_pet(signed_in, biscuit)

    page = await client.get(f"/public/pets/{slug}")

    assert page.json()["entries"][0]["photo_id"] is None


async def test_another_pets_entry_id_is_not_a_way_in(
    signed_in, biscuit, entry, storage_stub, client
):
    # The slug and the entry have to belong together, or the route is a way to
    # read any published photo from any public page.
    other = (await signed_in.post("/pets", json={"name": "Momo", "species": "cat"})).json()["id"]
    await upload(signed_in, entry)
    await signed_in.patch(f"/entries/{entry}", json={"photo_is_public": True})
    await publish_pet(signed_in, biscuit)
    other_slug = await publish_pet(signed_in, other)

    shown = await client.get(f"/public/pets/{other_slug}/entries/{entry}/photo")

    assert shown.status_code == 404
