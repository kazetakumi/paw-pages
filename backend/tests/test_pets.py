import re

import pytest

SLUG_SHAPE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


@pytest.fixture
async def signed_in(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})
    return client


async def test_a_pet_is_created_from_a_name_and_a_species_alone(signed_in):
    created = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})

    assert created.status_code == 201
    pet = created.json()
    assert pet["name"] == "Biscuit"
    assert pet["species"] == "dog"
    assert SLUG_SHAPE.match(pet["slug"]), pet["slug"]

    listed = await signed_in.get("/pets")
    assert [p["name"] for p in listed.json()] == ["Biscuit"]
