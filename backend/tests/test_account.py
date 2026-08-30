"""The account: what the app calls a handler, what they can take away, and leaving.

Nothing here stubs the database. The three optional personal fields, their
check constraints and the cascade from `auth.users` are all real. The only
stubbed things are the three Supabase HTTP services — Auth, Storage and the
Admin API — each at its own httpx transport.
"""

from datetime import date

import pytest

TODAY = date.today().isoformat()


@pytest.fixture
async def signed_in(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post("/auth/signin", json={"email": "akhil@example.com", "password": "x"})
    return client


async def test_the_display_name_is_changed_through_patch_me(signed_in):
    changed = await signed_in.patch("/me", json={"name": "Akhil J P"})

    assert changed.status_code == 200
    assert changed.json()["name"] == "Akhil J P"
    assert (await signed_in.get("/me")).json()["name"] == "Akhil J P"


async def test_the_account_shows_the_join_date_and_the_pet_and_entry_counts(signed_in):
    biscuit = (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()
    await signed_in.post("/pets", json={"name": "Toffee", "species": "cat"})
    for title in ("Rabies booster", "Nail trim"):
        await signed_in.post(
            "/entries", json={"pet_id": biscuit["id"], "title": title, "happened_on": TODAY}
        )

    account = (await signed_in.get("/me")).json()

    assert account["joined_on"] == TODAY
    assert account["pet_count"] == 2
    assert account["entry_count"] == 2
    # From the caller's own verified claims; `handlers` never duplicates it.
    assert account["email"] == "akhil@example.com"
