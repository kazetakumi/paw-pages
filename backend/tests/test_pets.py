import re
from datetime import date

import pytest

from app import pets

SLUG_SHAPE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def _age_since(born: str) -> tuple[int, int]:
    """Whole years and leftover months, worked out independently of the API."""
    birth, today = date.fromisoformat(born), date.today()
    months = (today.year - birth.year) * 12 + today.month - birth.month
    if today.day < birth.day:
        months -= 1
    return months // 12, months % 12


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


IDENTITY = {
    "name": "Biscuit",
    "species": "dog",
    "breed": "Indian Pariah",
    "sex": "male",
    "date_of_birth": "2022-03-12",
    "dob_is_approx": True,
    "colour": "Tan & white",
}


async def test_every_identity_field_can_be_set_at_creation_and_read_back(signed_in):
    created = await signed_in.post("/pets", json=IDENTITY)
    assert created.status_code == 201

    pet = (await signed_in.get(f"/pets/{created.json()['id']}")).json()

    assert {key: pet[key] for key in IDENTITY} == IDENTITY


async def test_species_is_free_text_and_nothing_branches_on_it(signed_in):
    for species in ["dog", "Indian star tortoise", "budgerigar", "hermit crab"]:
        created = await signed_in.post("/pets", json={"name": "Pip", "species": species})

        assert created.status_code == 201
        assert created.json()["species"] == species


async def test_age_is_derived_from_the_date_of_birth_and_never_stored(signed_in, app):
    created = await signed_in.post(
        "/pets", json={"name": "Biscuit", "species": "dog", "date_of_birth": "2022-03-12"}
    )

    pet = (await signed_in.get(f"/pets/{created.json()['id']}")).json()

    assert (pet["age_years"], pet["age_months"]) == _age_since("2022-03-12")
    async with app.state.pool.acquire() as conn:
        columns = await conn.fetch(
            "select column_name from information_schema.columns where table_name = 'pets'"
        )
    assert not [c["column_name"] for c in columns if "age" in c["column_name"]]


async def test_a_pet_with_no_date_of_birth_has_no_age(signed_in):
    created = await signed_in.post("/pets", json={"name": "Pip", "species": "budgerigar"})

    pet = created.json()

    assert pet["date_of_birth"] is None
    assert (pet["age_years"], pet["age_months"]) == (None, None)
