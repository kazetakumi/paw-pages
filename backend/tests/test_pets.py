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


async def test_every_identity_field_can_be_added_later(signed_in):
    created = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})
    later = {key: value for key, value in IDENTITY.items() if key not in ("name", "species")}

    patched = await signed_in.patch(f"/pets/{created.json()['id']}", json=later)

    assert patched.status_code == 200
    assert {key: patched.json()[key] for key in later} == later


async def test_a_correction_touches_only_the_fields_it_sends(signed_in):
    created = await signed_in.post("/pets", json=IDENTITY)

    patched = await signed_in.patch(f"/pets/{created.json()['id']}", json={"breed": "Indie"})

    assert patched.json()["breed"] == "Indie"
    assert patched.json()["colour"] == IDENTITY["colour"]
    assert patched.json()["slug"] == created.json()["slug"]


async def test_approximate_with_no_date_of_birth_is_rejected_by_the_field(signed_in):
    rejected = await signed_in.post(
        "/pets", json={"name": "Biscuit", "species": "dog", "dob_is_approx": True}
    )

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "dob_is_approx"
    assert "constraint" not in rejected.text.lower()


async def test_clearing_the_date_of_birth_while_still_approximate_is_rejected(signed_in):
    created = await signed_in.post("/pets", json=IDENTITY)

    rejected = await signed_in.patch(
        f"/pets/{created.json()['id']}", json={"date_of_birth": None}
    )

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "dob_is_approx"


async def test_a_name_the_database_would_refuse_comes_back_named(signed_in):
    rejected = await signed_in.post("/pets", json={"name": "   ", "species": "dog"})

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "name"


async def test_a_species_past_its_length_cap_comes_back_named(signed_in):
    rejected = await signed_in.post("/pets", json={"name": "Pip", "species": "x" * 41})

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "species"


async def test_a_date_of_birth_in_the_future_comes_back_named(signed_in):
    rejected = await signed_in.post(
        "/pets", json={"name": "Pip", "species": "dog", "date_of_birth": "2099-01-01"}
    )

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "date_of_birth"


async def test_a_second_handler_can_neither_read_nor_update_the_first_handlers_pet(
    signed_in, seed_handler, as_handler
):
    """Proved by RLS: nothing below carries a `where handler_id = ...`."""
    mine = (await signed_in.post("/pets", json=IDENTITY)).json()
    await seed_handler("Bela", "bela@example.com")
    await signed_in.post("/auth/signin", json={"email": "bela@example.com", "password": "x"})

    assert (await signed_in.get("/pets")).json() == []
    assert (await signed_in.get(f"/pets/{mine['id']}")).status_code == 404
    assert (await signed_in.patch(f"/pets/{mine['id']}", json={"name": "Stolen"})).status_code == 404


async def test_a_second_handler_cannot_delete_the_first_handlers_pet(
    signed_in, seed_handler, as_handler
):
    """No delete endpoint in this slice, so the policy is checked at the seam
    every pet endpoint hangs off."""
    mine = (await signed_in.post("/pets", json=IDENTITY)).json()
    bela = await seed_handler("Bela", "bela@example.com")

    async with as_handler(bela) as conn:
        assert await conn.execute("delete from pawpages_pets where id = $1", mine["id"]) == "DELETE 0"

    assert (await signed_in.get(f"/pets/{mine['id']}")).status_code == 200
