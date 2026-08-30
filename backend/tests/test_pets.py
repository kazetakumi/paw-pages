import re

import pytest

from app import pets

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


async def test_two_pets_with_the_same_name_get_different_slugs(signed_in):
    first = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})
    second = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})

    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["slug"] != second.json()["slug"]
    assert second.json()["slug"].startswith("biscuit-")


async def test_a_real_slug_collision_is_retried_rather_than_failing(signed_in, monkeypatch):
    """The suffix is forced to collide, because a chance collision is 1 in 1.7m.

    Without a savepoint per attempt the first violation would poison the whole
    request transaction and the retry could never succeed.
    """
    suffixes = iter(["aaaa", "aaaa", "bbbb"])
    monkeypatch.setattr(pets, "_suffix", lambda: next(suffixes))

    first = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})
    second = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})

    assert (first.json()["slug"], second.json()["slug"]) == ("biscuit-aaaa", "biscuit-bbbb")
