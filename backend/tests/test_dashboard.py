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
    async def _add(name: str, species: str = "dog") -> str:
        created = await signed_in.post("/pets", json={"name": name, "species": species})
        return created.json()["id"]

    return _add


@pytest.fixture
async def log(signed_in):
    async def _log(pet_id: str, title: str, happened_on: str, due_on: str | None = None) -> str:
        created = await signed_in.post(
            "/entries",
            json={
                "pet_id": pet_id,
                "title": title,
                "happened_on": happened_on,
                "due_on": due_on,
            },
        )
        assert created.status_code == 201, created.text
        return created.json()["id"]

    return _log


async def test_the_ledger_is_oldest_problem_first_across_every_pet(signed_in, add_pet, log):
    biscuit = await add_pet("Biscuit")
    momo = await add_pet("Momo", "cat")
    await log(momo, "Deworming", days_from_today(-400), days_from_today(7))
    await log(biscuit, "DHPP booster", days_from_today(-400), days_from_today(23))
    await log(biscuit, "Rabies booster", days_from_today(-400), days_from_today(-46))

    ledger = (await signed_in.get("/dashboard")).json()["ledger"]

    assert [item["title"] for item in ledger] == ["Rabies booster", "Deworming", "DHPP booster"]
    assert [item["pet_name"] for item in ledger] == ["Biscuit", "Momo", "Biscuit"]
    assert [item["days_until"] for item in ledger] == [-46, 7, 23]


@pytest.mark.parametrize(
    "days_out, overdue, days_until",
    [(-1, True, -1), (0, False, 0), (1, False, 1)],
    ids=["the day before", "the day of", "the day after"],
)
async def test_overdue_turns_over_at_midnight_and_the_database_decides_when(
    signed_in, add_pet, log, days_out, overdue, days_until
):
    """The boundary, read off due_items. Neither the API nor the browser
    reimplements `due_on < current_date and due_closed_at is null`."""
    biscuit = await add_pet("Biscuit")
    await log(biscuit, "Rabies booster", days_from_today(-400), days_from_today(days_out))

    item = (await signed_in.get("/dashboard")).json()["ledger"][0]

    assert item["is_overdue"] is overdue
    assert item["days_until"] == days_until


async def test_a_closed_due_date_leaves_the_ledger_however_far_past_it_is(signed_in, add_pet, log):
    biscuit = await add_pet("Biscuit")
    entry_id = await log(biscuit, "Rabies booster", days_from_today(-400), days_from_today(-46))
    await signed_in.post(f"/entries/{entry_id}/mark-done")

    assert (await signed_in.get("/dashboard")).json()["ledger"] == []


async def test_mark_done_leaves_the_entry_in_the_history(signed_in, add_pet, log):
    biscuit = await add_pet("Biscuit")
    entry_id = await log(biscuit, "Rabies booster", days_from_today(-400), days_from_today(-46))

    marked = await signed_in.post(f"/entries/{entry_id}/mark-done")

    assert marked.status_code == 200
    assert marked.json()["is_overdue"] is False

    feed = (await signed_in.get(f"/pets/{biscuit}/entries")).json()["entries"]

    assert [(e["title"], e["due_on"]) for e in feed] == [
        ("Rabies booster", days_from_today(-46))
    ]
    assert feed[0]["is_overdue"] is False


async def test_marking_an_entry_with_no_due_date_done_is_not_a_500(signed_in, add_pet, log):
    biscuit = await add_pet("Biscuit")
    entry_id = await log(biscuit, "Grooming", days_from_today(-1))

    refused = await signed_in.post(f"/entries/{entry_id}/mark-done")

    assert refused.status_code == 404


async def test_logging_the_next_one_creates_the_entry_and_closes_the_old_due_date_together(
    signed_in, add_pet, log
):
    biscuit = await add_pet("Biscuit")
    outstanding = await log(
        biscuit, "Rabies booster", days_from_today(-400), days_from_today(-46)
    )

    created = await signed_in.post(
        "/entries",
        json={
            "pet_id": biscuit,
            "title": "Rabies booster",
            "happened_on": days_from_today(0),
            "due_on": days_from_today(365),
            "closes_entry_id": outstanding,
        },
    )

    assert created.status_code == 201

    ledger = (await signed_in.get("/dashboard")).json()["ledger"]

    assert [item["entry_id"] for item in ledger] == [created.json()["id"]]
    assert ledger[0]["is_overdue"] is False
    assert len((await signed_in.get(f"/pets/{biscuit}/entries")).json()["entries"]) == 2


async def test_a_rejected_next_one_closes_nothing(signed_in, add_pet, log):
    """One request, one transaction: the old due date only closes if the new
    entry actually saved."""
    biscuit = await add_pet("Biscuit")
    outstanding = await log(
        biscuit, "Rabies booster", days_from_today(-400), days_from_today(-46)
    )

    rejected = await signed_in.post(
        "/entries",
        json={
            "pet_id": biscuit,
            "title": "Rabies booster",
            "happened_on": "2099-01-01",
            "closes_entry_id": outstanding,
        },
    )

    assert rejected.status_code == 422

    ledger = (await signed_in.get("/dashboard")).json()["ledger"]

    assert [item["entry_id"] for item in ledger] == [outstanding]
