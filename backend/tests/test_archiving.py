"""Archiving a pet, and putting it back.

Nothing here filters archived pets out by hand. `due_items`, `public_pets` and
`public_entries` all carry `archived_at is null`, so these tests set the two
columns through the endpoint and then ask the ledger and the public page what
they can see.
"""

from datetime import date, timedelta

import pytest

TODAY = date.today()


def days_from_today(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


@pytest.fixture
async def signed_in(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})
    return client


@pytest.fixture
async def add_pet(signed_in):
    async def _add(name: str, species: str = "dog") -> dict:
        created = await signed_in.post("/pets", json={"name": name, "species": species})
        assert created.status_code == 201, created.text
        return created.json()

    return _add


@pytest.fixture
async def log(signed_in):
    async def _log(pet_id: str, title: str, happened_on: str, due_on: str | None = None) -> str:
        created = await signed_in.post(
            "/entries",
            json={"pet_id": pet_id, "title": title, "happened_on": happened_on, "due_on": due_on},
        )
        assert created.status_code == 201, created.text
        return created.json()["id"]

    return _log


async def test_an_archive_with_no_reason_is_rejected_naming_the_field(signed_in, add_pet):
    """`archive_is_complete` says the two columns travel together, so there is
    no such thing as archiving without saying why."""
    toffee = await add_pet("Toffee")

    refused = await signed_in.post(f"/pets/{toffee['id']}/archive", json={})

    assert refused.status_code == 422
    assert refused.json()["detail"]["field"] == "reason"


async def test_a_reason_outside_the_three_is_rejected(signed_in, add_pet):
    toffee = await add_pet("Toffee")

    refused = await signed_in.post(f"/pets/{toffee['id']}/archive", json={"reason": "lost"})

    assert refused.status_code == 422
    assert refused.json()["detail"]["field"] == "reason"
    assert (await signed_in.get("/dashboard")).json()["archived_pets"] == 0


@pytest.mark.parametrize("reason", ["passed_away", "rehomed", "other"])
async def test_each_of_the_three_reasons_archives_the_pet(signed_in, add_pet, reason):
    toffee = await add_pet("Toffee")

    archived = await signed_in.post(f"/pets/{toffee['id']}/archive", json={"reason": reason})

    assert archived.status_code == 200
    assert (await signed_in.get("/dashboard")).json()["archived_pets"] == 1


@pytest.fixture
async def published(signed_in, add_pet, log):
    """A pet with a standing due date and a live public page."""
    toffee = await add_pet("Toffee")
    await log(toffee["id"], "Rabies booster", days_from_today(-400), days_from_today(-46))
    await signed_in.patch(f"/pets/{toffee['id']}", json={"is_public": True})
    return toffee


async def test_archiving_empties_the_ledger_and_darkens_the_page_in_one_request(
    signed_in, client, published
):
    """One update to two columns. The exclusions live in `due_items` and
    `public_pets`, so neither the ledger query nor the public route filters."""
    before = (await signed_in.get("/dashboard")).json()
    assert [item["title"] for item in before["ledger"]] == ["Rabies booster"]
    assert (await client.get(f"/public/pets/{published['slug']}")).status_code == 200

    archived = await signed_in.post(f"/pets/{published['id']}/archive", json={"reason": "rehomed"})

    assert archived.status_code == 200
    board = (await signed_in.get("/dashboard")).json()
    assert board["ledger"] == []
    assert [pet["name"] for pet in board["pets"]] == []
    assert (await client.get(f"/public/pets/{published['slug']}")).status_code == 404


async def test_restoring_puts_the_ledger_item_and_the_public_page_back(
    signed_in, client, published
):
    await signed_in.post(f"/pets/{published['id']}/archive", json={"reason": "rehomed"})

    restored = await signed_in.post(f"/pets/{published['id']}/restore")

    assert restored.status_code == 200
    board = (await signed_in.get("/dashboard")).json()
    assert [item["title"] for item in board["ledger"]] == ["Rabies booster"]
    assert [pet["name"] for pet in board["pets"]] == ["Toffee"]
    assert board["archived_pets"] == 0
    # Same slug: it was claimed at insert and archiving never gave it up.
    page = await client.get(f"/public/pets/{published['slug']}")
    assert page.status_code == 200
    assert page.json()["name"] == "Toffee"


async def test_an_archived_pet_keeps_every_entry_and_its_photo(signed_in, add_pet, log):
    """Archiving is not a soft delete. The record survives it whole, which is
    the only reason restoring is worth offering."""
    toffee = await add_pet("Toffee")
    await log(toffee["id"], "Rabies booster", days_from_today(-400), days_from_today(-46))
    await log(toffee["id"], "Nail trim", days_from_today(-30))
    await signed_in.put(
        f"/pets/{toffee['id']}/photo",
        content=b"\xff\xd8\xff\xe0 a jpeg as far as the bucket is concerned",
        headers={"content-type": "image/jpeg"},
    )

    archived = await signed_in.post(
        f"/pets/{toffee['id']}/archive", json={"reason": "passed_away"}
    )

    assert archived.json()["has_photo"] is True
    assert (await signed_in.get(f"/pets/{toffee['id']}/photo")).status_code == 200
    feed = (await signed_in.get(f"/pets/{toffee['id']}/entries")).json()["entries"]
    assert [entry["title"] for entry in feed] == ["Nail trim", "Rabies booster"]


async def test_archiving_takes_the_pet_out_of_all_three_summary_counts(signed_in, add_pet, log):
    toffee = await add_pet("Toffee")
    await log(toffee["id"], "Rabies booster", days_from_today(-400), days_from_today(-46))
    await log(toffee["id"], "Deworming", days_from_today(-400), days_from_today(7))
    counted = (await signed_in.get("/dashboard")).json()
    assert (counted["active_pets"], counted["overdue"], counted["due_within_30_days"]) == (1, 1, 1)

    await signed_in.post(f"/pets/{toffee['id']}/archive", json={"reason": "passed_away"})

    board = (await signed_in.get("/dashboard")).json()

    assert (board["active_pets"], board["overdue"], board["due_within_30_days"]) == (0, 0, 0)
    assert board["archived_pets"] == 1


async def test_the_archived_list_carries_each_pets_reason_and_the_date_it_was_archived(
    signed_in, add_pet
):
    """Archived pets stay findable, so they come back with the home screen —
    named, with why and when, and nothing else the cards would need."""
    toffee = await add_pet("Toffee")
    momo = await add_pet("Momo", "cat")
    await signed_in.post(f"/pets/{toffee['id']}/archive", json={"reason": "passed_away"})
    await signed_in.post(f"/pets/{momo['id']}/archive", json={"reason": "rehomed"})

    archived = (await signed_in.get("/dashboard")).json()["archived"]

    assert [pet["name"] for pet in archived] == ["Toffee", "Momo"]
    assert [pet["archived_reason"] for pet in archived] == ["passed_away", "rehomed"]
    assert [pet["archived_on"] for pet in archived] == [TODAY.isoformat()] * 2
    assert [pet["id"] for pet in archived] == [toffee["id"], momo["id"]]


async def test_a_second_handler_can_neither_archive_nor_restore_the_first_handlers_pet(
    signed_in, add_pet, seed_handler
):
    """Proved by RLS. Neither endpoint carries a `where handler_id = ...`, so a
    pet that is not theirs is absent rather than forbidden — which is a 404."""
    toffee = await add_pet("Toffee")
    await seed_handler("Bela", "bela@example.com")
    await signed_in.post("/auth/signin", json={"email": "bela@example.com", "password": "x"})

    refused = await signed_in.post(f"/pets/{toffee['id']}/archive", json={"reason": "rehomed"})

    assert refused.status_code == 404

    await signed_in.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})
    await signed_in.post(f"/pets/{toffee['id']}/archive", json={"reason": "rehomed"})
    await signed_in.post("/auth/signin", json={"email": "bela@example.com", "password": "x"})

    assert (await signed_in.post(f"/pets/{toffee['id']}/restore")).status_code == 404
    assert (await signed_in.get("/dashboard")).json()["archived"] == []

    await signed_in.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})

    assert (await signed_in.get("/dashboard")).json()["archived_pets"] == 1


async def test_archiving_needs_a_session(client, add_pet):
    toffee = await add_pet("Toffee")
    await client.post("/auth/signout")

    archive = await client.post(f"/pets/{toffee['id']}/archive", json={"reason": "other"})
    restore = await client.post(f"/pets/{toffee['id']}/restore")

    assert [archive.status_code, restore.status_code] == [401, 401]
