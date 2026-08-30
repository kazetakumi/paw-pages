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


async def test_the_three_personal_fields_are_unset_by_default_and_settable(signed_in):
    """None of them drives anything. They are collected because they were asked
    for, which is also why the delete screen names all three."""
    account = (await signed_in.get("/me")).json()
    assert (account["date_of_birth"], account["gender"], account["nationality"]) == (
        None,
        None,
        None,
    )

    filled = await signed_in.patch(
        "/me",
        json={"date_of_birth": "1994-08-14", "gender": "Male", "nationality": "Indian"},
    )

    assert filled.status_code == 200
    assert filled.json()["date_of_birth"] == "1994-08-14"
    assert filled.json()["gender"] == "Male"
    assert filled.json()["nationality"] == "Indian"

    cleared = await signed_in.patch("/me", json={"gender": None})
    assert cleared.json()["gender"] is None
    assert cleared.json()["nationality"] == "Indian"


async def test_age_is_derived_from_the_date_of_birth_and_never_stored(signed_in, app):
    """A birthday on the first of January, this many years back, is that many
    years old on every day of the year — so nothing here recomputes the age the
    way the database does."""
    born = date(date.today().year - 32, 1, 1)

    filled = await signed_in.patch("/me", json={"date_of_birth": born.isoformat()})

    assert filled.json()["age"] == 32
    async with app.state.pool.acquire() as conn:
        columns = await conn.fetch(
            "select column_name from information_schema.columns where table_name = 'handlers'"
        )
    assert "age" not in [column["column_name"] for column in columns]


async def test_a_date_of_birth_in_the_future_comes_back_named_not_as_a_500(signed_in):
    rejected = await signed_in.patch("/me", json={"date_of_birth": "2099-01-01"})

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["field"] == "date_of_birth"
    assert "constraint" not in rejected.text.lower()


async def test_the_email_address_is_changed_through_its_own_endpoint(signed_in, app):
    """Losing access to an old inbox must not lock a handler out. The address
    lives in auth.users; `handlers` never duplicates it."""
    changed = await signed_in.patch("/me/email", json={"email": "akhil@newmail.example"})

    assert changed.status_code == 200
    assert changed.json()["email"] == "akhil@newmail.example"
    async with app.state.pool.acquire() as conn:
        assert await conn.fetchval("select email from auth.users") == "akhil@newmail.example"


async def test_an_email_already_registered_comes_back_beside_the_email_field(
    signed_in, seed_handler
):
    await seed_handler("Mira", "mira@example.com")

    refused = await signed_in.patch("/me/email", json={"email": "mira@example.com"})

    assert 400 <= refused.status_code < 500
    assert refused.json()["detail"]["field"] == "email"


async def test_the_password_is_changed_through_its_own_endpoint(signed_in, auth_stub):
    changed = await signed_in.patch("/me/password", json={"password": "a longer secret"})

    assert changed.status_code == 204
    assert auth_stub.passwords["akhil@example.com"] == "a longer secret"


async def test_a_password_supabase_refuses_comes_back_beside_the_password_field(signed_in):
    refused = await signed_in.patch("/me/password", json={"password": ""})

    assert refused.status_code == 422
    assert refused.json()["detail"]["field"] == "password"
