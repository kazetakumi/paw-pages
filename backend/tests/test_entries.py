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


async def test_recent_titles_are_the_handlers_own_distinct_last_four_across_all_pets(
    signed_in, biscuit
):
    momo = (await signed_in.post("/pets", json={"name": "Momo", "species": "cat"})).json()["id"]
    # oldest first, so the expected order is the reverse of this
    logged = [
        (biscuit, "Rabies booster", "2024-01-10"),
        (momo, "Grooming", "2024-02-10"),
        (biscuit, "Deworming", "2024-03-10"),
        (momo, "Rabies booster", "2024-04-10"),
        (biscuit, "Vet visit", "2024-05-10"),
        (momo, "Nail trim", "2024-06-10"),
    ]
    for pet_id, title, happened_on in logged:
        await signed_in.post(
            "/entries", json={"pet_id": pet_id, "title": title, "happened_on": happened_on}
        )

    titles = (await signed_in.get("/entry-titles/recent")).json()

    assert titles == ["Nail trim", "Vet visit", "Rabies booster", "Deworming"]
    assert len(titles) == len(set(titles))


async def test_a_handler_with_no_entries_gets_no_titles_to_suggest(signed_in):
    assert (await signed_in.get("/entry-titles/recent")).json() == []


async def test_the_feed_pages_by_cursor_with_no_gap_or_repeat_at_the_boundary(signed_in, biscuit):
    """Two entries share a date, so the boundary can only hold if the cursor
    orders by id as well — exactly as entries_pet_feed_idx does."""
    logged = [
        ("Rabies booster", "2024-01-10"),
        ("Grooming", "2024-02-10"),
        ("Deworming", "2024-03-10"),
        ("Vet visit", "2024-03-10"),
        ("Nail trim", "2024-04-10"),
        ("Flea drops", "2024-05-10"),
        ("Weigh-in", "2024-06-10"),
    ]
    for title, happened_on in logged:
        await signed_in.post(
            "/entries", json={"pet_id": biscuit, "title": title, "happened_on": happened_on}
        )

    seen, cursor, pages = [], None, 0
    while True:
        query = f"?limit=3{f'&cursor={cursor}' if cursor else ''}"
        page = (await signed_in.get(f"/pets/{biscuit}/entries{query}")).json()
        seen += page["entries"]
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert pages == 3
    assert [e["happened_on"] for e in seen] == sorted(
        (h for _, h in logged), reverse=True
    )
    assert len(seen) == len(logged)
    assert len({e["id"] for e in seen}) == len(logged)


async def test_the_last_page_of_a_feed_offers_no_cursor(signed_in, biscuit):
    await signed_in.post(
        "/entries", json={"pet_id": biscuit, "title": "Nail trim", "happened_on": TODAY}
    )

    page = (await signed_in.get(f"/pets/{biscuit}/entries?limit=3")).json()

    assert len(page["entries"]) == 1
    assert page["next_cursor"] is None


async def test_a_cursor_says_nothing_about_the_row_it_points_at(signed_in, biscuit):
    for title in ["Rabies booster", "Grooming"]:
        await signed_in.post(
            "/entries", json={"pet_id": biscuit, "title": title, "happened_on": "2024-03-10"}
        )

    cursor = (await signed_in.get(f"/pets/{biscuit}/entries?limit=1")).json()["next_cursor"]

    assert "2024" not in cursor
    assert (await signed_in.get(f"/pets/{biscuit}/entries?cursor=nonsense")).status_code == 400
