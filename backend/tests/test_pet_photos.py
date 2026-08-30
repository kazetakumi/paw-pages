"""Pet photos: one per pet, streamed out of a private bucket by our own routes.

Nothing here asks Supabase Storage for a signed URL, and no test asserts on a
Supabase domain, because neither ever exists. The only stubbed thing is the
Storage HTTP client; who may read an object is still decided by the policies in
migration 0003 against the real database.
"""

from uuid import UUID

import pytest

from app.config import settings
from app.session import claims_of

JPEG = b"\xff\xd8\xff\xe0 not really a jpeg, but the bucket only reads the type"
PNG = b"\x89PNG\r\n\x1a\n not really a png either"


@pytest.fixture
async def signed_in(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})
    return client


@pytest.fixture
async def biscuit(signed_in):
    return (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()


def upload(client, pet_id, content=JPEG, content_type="image/jpeg"):
    return client.put(
        f"/pets/{pet_id}/photo", content=content, headers={"content-type": content_type}
    )


async def test_a_photo_is_uploaded_for_a_pet(signed_in, biscuit, storage_stub):
    saved = await upload(signed_in, biscuit["id"])

    assert saved.status_code == 200
    assert saved.json()["has_photo"] is True
    # The path convention every policy in 0003 keys off: {pet_id}/{filename}.
    [stored] = storage_stub.objects
    assert stored.startswith(f"{biscuit['id']}/")
    assert storage_stub.objects[stored] == ("image/jpeg", JPEG)


async def test_replacing_a_photo_leaves_the_previous_object_behind_nowhere(
    signed_in, biscuit, storage_stub
):
    """The foreign key cascade does not reach storage and there is no cleanup
    job, so the object the replacement displaced is deleted here or never."""
    first = await upload(signed_in, biscuit["id"])
    [displaced] = storage_stub.objects

    replaced = await upload(signed_in, biscuit["id"], content=PNG, content_type="image/png")

    assert replaced.status_code == 200
    assert first.status_code == 200
    assert displaced not in storage_stub.objects
    [kept] = storage_stub.objects
    assert storage_stub.objects[kept] == ("image/png", PNG)


async def test_removing_a_photo_deletes_the_stored_object_not_just_the_path(
    signed_in, biscuit, storage_stub
):
    await upload(signed_in, biscuit["id"])

    removed = await signed_in.delete(f"/pets/{biscuit['id']}/photo")

    assert removed.status_code == 200
    assert removed.json()["has_photo"] is False
    assert storage_stub.objects == {}
    assert (await signed_in.get(f"/pets/{biscuit['id']}")).json()["has_photo"] is False


async def test_the_owners_route_serves_the_bytes_with_the_handlers_own_token(
    signed_in, biscuit, storage_stub, seed_handler
):
    """No signed URL, no redirect, no Supabase domain: our route hands over the
    bytes, and it reads them as the handler so the four owner policies apply."""
    await upload(signed_in, biscuit["id"])

    served = await signed_in.get(f"/pets/{biscuit['id']}/photo")

    assert served.status_code == 200
    assert served.content == JPEG
    assert served.headers["content-type"] == "image/jpeg"
    method, _, bearer = storage_stub.calls[-1]
    assert method == "GET"
    assert claims_of(bearer)["sub"] == (await signed_in.get("/me")).json()["id"]


async def test_a_pet_with_no_photo_has_nothing_to_serve(signed_in, biscuit):
    assert (await signed_in.get(f"/pets/{biscuit['id']}/photo")).status_code == 404


async def test_another_handlers_pet_has_no_photo_route_at_all(client, seed_handler, biscuit):
    await seed_handler("Mira", "mira@example.com")
    await client.post("/auth/signin", json={"email": "mira@example.com", "password": "x"})

    assert (await client.get(f"/pets/{biscuit['id']}/photo")).status_code == 404
    assert (await upload(client, biscuit["id"])).status_code == 404
    assert (await client.delete(f"/pets/{biscuit['id']}/photo")).status_code == 404


async def test_the_public_route_serves_the_same_bytes_as_anon(
    signed_in, biscuit, storage_stub, client
):
    await upload(signed_in, biscuit["id"])
    await signed_in.patch(f"/pets/{biscuit['id']}", json={"is_public": True})

    served = await client.get(f"/public/pets/{biscuit['slug']}/photo")

    assert served.status_code == 200
    assert served.content == JPEG
    method, _, bearer = storage_stub.calls[-1]
    # Nobody's token: the anon key, so the public-read policy is what answers.
    assert (method, bearer) == ("GET", settings.supabase_anon_key)


async def test_a_private_pets_photo_is_not_served_by_the_public_route(signed_in, biscuit, client):
    await upload(signed_in, biscuit["id"])

    assert (await client.get(f"/public/pets/{biscuit['slug']}/photo")).status_code == 404
    assert (await client.get(f"/public/pets/{biscuit['slug']}")).status_code == 404


async def test_an_archived_pets_photo_stops_resolving_when_its_page_goes_dark(
    signed_in, biscuit, client, app
):
    """Archiving is ticket 08, so the pet is archived in SQL. Nothing in this
    module reacts to it: the photo and the page both come off `public_pets`."""
    await upload(signed_in, biscuit["id"])
    await signed_in.patch(f"/pets/{biscuit['id']}", json={"is_public": True})
    assert (await client.get(f"/public/pets/{biscuit['slug']}/photo")).status_code == 200

    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "update pets set archived_at = now(), archived_reason = 'passed_away' where id = $1",
            UUID(biscuit["id"]),
        )

    assert (await client.get(f"/public/pets/{biscuit['slug']}/photo")).status_code == 404
    assert (await client.get(f"/public/pets/{biscuit['slug']}")).status_code == 404
    # The object itself is untouched: archiving keeps a pet's history and photo.
    assert (await signed_in.get(f"/pets/{biscuit['id']}/photo")).status_code == 200


async def test_a_type_the_bucket_would_refuse_comes_back_named(signed_in, biscuit, storage_stub):
    """The bucket allows four types. Mirroring them here is what turns its
    refusal into a message beside the file picker rather than a 500."""
    refused = await upload(signed_in, biscuit["id"], content=b"GIF89a", content_type="image/gif")

    assert refused.status_code == 422
    assert refused.json()["detail"]["field"] == "photo"
    assert "JPEG" in refused.json()["detail"]["message"]
    assert storage_stub.objects == {}


async def test_an_image_over_the_buckets_five_megabytes_comes_back_named(
    signed_in, biscuit, storage_stub
):
    refused = await upload(signed_in, biscuit["id"], content=b"x" * (5 * 1024 * 1024 + 1))

    assert refused.status_code == 422
    assert refused.json()["detail"] == {
        "field": "photo",
        "message": "That image is over 5 MB. Choose a smaller one.",
    }
    assert storage_stub.objects == {}


async def test_the_photo_routes_are_shut_to_anyone_without_a_session(client, biscuit):
    await client.post("/auth/signout")
    pet_id = biscuit["id"]

    assert (await client.get(f"/pets/{pet_id}/photo")).status_code == 401
    assert (await upload(client, pet_id)).status_code == 401
    assert (await client.delete(f"/pets/{pet_id}/photo")).status_code == 401


async def test_the_public_page_says_whether_there_is_a_photo_to_ask_for(
    signed_in, biscuit, client
):
    """`has_photo`, never the path: the visitor is given our route to the bytes
    and never a way to name the object behind it."""
    await signed_in.patch(f"/pets/{biscuit['id']}", json={"is_public": True})
    assert (await client.get(f"/public/pets/{biscuit['slug']}")).json()["has_photo"] is False

    await upload(signed_in, biscuit["id"])

    page = await client.get(f"/public/pets/{biscuit['slug']}")
    assert page.json()["has_photo"] is True
    assert "photo_path" not in page.text


async def test_a_storage_failure_leaves_the_row_and_the_bucket_in_step(
    signed_in, biscuit, storage_stub
):
    """The object goes missing under us, so the delete storage is asked for
    fails. The request is one transaction, so the row is not quietly emptied of
    a photo the handler still believes is there."""
    await upload(signed_in, biscuit["id"])
    storage_stub.objects.clear()

    refused = await signed_in.delete(f"/pets/{biscuit['id']}/photo")

    assert refused.status_code == 502
    assert (await signed_in.get(f"/pets/{biscuit['id']}")).json()["has_photo"] is True
