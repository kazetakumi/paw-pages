"""Pet photos: one per pet, streamed out of a private bucket by our own routes.

Nothing here asks Supabase Storage for a signed URL, and no test asserts on a
Supabase domain, because neither ever exists. The only stubbed thing is the
Storage HTTP client; who may read an object is still decided by the policies in
migration 0003 against the real database.
"""

import pytest

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
