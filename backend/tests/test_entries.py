from datetime import date, timedelta

import pytest

TODAY = date.today().isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()


@pytest.fixture
async def signed_in(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})
    return client


@pytest.fixture
async def biscuit(signed_in):
    created = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})
    return created.json()["id"]


async def test_an_entry_saves_from_a_date_and_a_title_alone(signed_in, biscuit):
    created = await signed_in.post(
        "/entries", json={"pet_id": biscuit, "title": "Nail trim", "happened_on": TODAY}
    )

    assert created.status_code == 201
    entry = created.json()
    assert (entry["title"], entry["happened_on"]) == ("Nail trim", TODAY)
    assert (entry["due_on"], entry["vet"], entry["note"]) == (None, None, None)

    feed = await signed_in.get(f"/pets/{biscuit}/entries")
    assert [e["title"] for e in feed.json()["entries"]] == ["Nail trim"]


async def test_a_happened_on_in_the_future_comes_back_named_not_as_a_500(signed_in, biscuit):
    rejected = await signed_in.post(
        "/entries",
        json={"pet_id": biscuit, "title": "Rabies booster", "happened_on": "2099-01-01"},
    )

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "happened_on"
    assert "constraint" not in rejected.text.lower()


async def test_a_due_on_before_happened_on_comes_back_named(signed_in, biscuit):
    rejected = await signed_in.post(
        "/entries",
        json={
            "pet_id": biscuit,
            "title": "Rabies booster",
            "happened_on": TODAY,
            "due_on": YESTERDAY,
        },
    )

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "due_on"


async def test_the_vet_and_the_note_save_on_the_entry_and_come_back_in_the_feed(
    signed_in, biscuit
):
    await signed_in.post(
        "/entries",
        json={
            "pet_id": biscuit,
            "title": "Vet visit",
            "happened_on": YESTERDAY,
            "vet": "Anvayaa Clinic",
            "note": "Limping on the back right leg.",
        },
    )

    entry = (await signed_in.get(f"/pets/{biscuit}/entries")).json()["entries"][0]

    assert entry["vet"] == "Anvayaa Clinic"
    assert entry["note"] == "Limping on the back right leg."


async def test_an_entry_can_be_edited_and_deleted_after_saving(signed_in, biscuit):
    created = await signed_in.post(
        "/entries",
        json={"pet_id": biscuit, "title": "Deworming", "happened_on": YESTERDAY, "vet": "Dr. Menon"},
    )
    entry_id = created.json()["id"]

    edited = await signed_in.patch(
        f"/entries/{entry_id}", json={"title": "Deworming tablet", "vet": None}
    )

    assert edited.status_code == 200
    assert edited.json()["title"] == "Deworming tablet"
    assert edited.json()["vet"] is None
    assert edited.json()["happened_on"] == YESTERDAY

    deleted = await signed_in.delete(f"/entries/{entry_id}")

    assert deleted.status_code == 204
    assert (await signed_in.get(f"/pets/{biscuit}/entries")).json()["entries"] == []
