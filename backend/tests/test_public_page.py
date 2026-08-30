"""The public page: the switch on the handler's side, the document on the visitor's.

Nothing here reads `pets` or `entries`. The visitor's route in is `public_pets`
and `public_entries`, and the tests below are about what those two views will
and will not hand over.
"""

import pytest


@pytest.fixture
async def signed_in(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})
    return client


async def test_a_new_pet_publishes_nothing(signed_in):
    created = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})

    assert created.json()["is_public"] is False


async def test_switching_one_pet_on_leaves_every_other_pet_alone(signed_in):
    biscuit = (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()
    pip = (await signed_in.post("/pets", json={"name": "Pip", "species": "budgerigar"})).json()

    switched = await signed_in.patch(f"/pets/{biscuit['id']}", json={"is_public": True})

    assert switched.json()["is_public"] is True
    listed = {pet["name"]: pet["is_public"] for pet in (await signed_in.get("/pets")).json()}
    assert listed == {"Biscuit": True, "Pip": False}
    assert (await signed_in.get(f"/pets/{pip['id']}")).json()["is_public"] is False


async def test_a_visitor_with_no_account_and_no_cookie_can_read_the_page(signed_in, client):
    pet = (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()
    await signed_in.patch(f"/pets/{pet['id']}", json={"is_public": True})
    client.cookies.clear()

    page = await client.get(f"/public/pets/{pet['slug']}")

    assert page.status_code == 200
    assert page.json()["name"] == "Biscuit"
    assert not client.cookies
