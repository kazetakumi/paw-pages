"""The public page: the switch on the handler's side, the document on the visitor's.

Nothing here reads `pets` or `entries`. The visitor's route in is `public_pets`
and `public_entries`, and the tests below are about what those two views will
and will not hand over.
"""

from datetime import date

import pytest


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


async def test_a_new_pet_publishes_nothing(signed_in):
    created = await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})

    assert created.json()["is_public"] is False


async def test_switching_one_pet_on_leaves_every_other_pet_alone(signed_in):
    biscuit = (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()
    pip = (await signed_in.post("/pets", json={"name": "Pip", "species": "budgerigar"})).json()

    switched = await signed_in.patch(f"/pets/{biscuit['id']}", json={"is_public": True})

    assert switched.json()["is_public"] is True
    listed = {pet["name"]: pet["is_public"] for pet in (await signed_in.get("/pets")).json()}
    assert listed == {"Biscuit": True, "Pip": False}
    assert (await signed_in.get(f"/pets/{pip['id']}")).json()["is_public"] is False


async def test_a_visitor_with_no_account_and_no_cookie_can_read_the_page(signed_in, client):
    pet = (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()
    await signed_in.patch(f"/pets/{pet['id']}", json={"is_public": True})
    client.cookies.clear()

    page = await client.get(f"/public/pets/{pet['slug']}")

    assert page.status_code == 200
    assert page.json()["name"] == "Biscuit"
    assert not client.cookies


@pytest.fixture
async def published(signed_in):
    """Biscuit, on, with an entry carrying everything a visitor may not have."""
    pet = (
        await signed_in.post(
            "/pets",
            json={
                "name": "Biscuit",
                "species": "dog",
                "breed": "Indian Pariah",
                "sex": "male",
                "colour": "Tan & white",
                "date_of_birth": "2022-03-12",
            },
        )
    ).json()
    await signed_in.post(
        "/entries",
        json={
            "pet_id": pet["id"],
            "title": "Rabies booster",
            "happened_on": "2025-07-14",
            "due_on": "2026-07-14",
            "vet": "Dr Nadar, Cessna Lifeline",
            "note": "Slight limp for a day afterwards.",
        },
    )
    await signed_in.patch(f"/pets/{pet['id']}", json={"is_public": True})
    return pet


SECRETS = [
    "note",
    "vet",
    "Cessna Lifeline",
    "Slight limp",
    "2022-03-12",
    "handler",
    "akhil@example.com",
    "Akhil",
]


async def test_the_payload_carries_no_note_no_vet_no_id_and_no_exact_date_of_birth(
    published, client
):
    """Asserted over the whole response, not field by field: a new column on
    either view would have to leak past this, not merely past a list of keys."""
    client.cookies.clear()

    body = (await client.get(f"/public/pets/{published['slug']}")).text

    for forbidden in SECRETS:
        assert forbidden.lower() not in body.lower(), forbidden
    # No id of any kind — not the pet's, not the entry's, not the handler's.
    assert published["id"] not in body
    assert "id" not in (await client.get(f"/public/pets/{published['slug']}")).json()


async def test_the_date_of_birth_appears_only_as_a_month_and_a_year(published, client):
    client.cookies.clear()

    page = (await client.get(f"/public/pets/{published['slug']}")).json()

    assert page["born"] == "Mar 2022"
    assert (page["age_years"], page["age_months"]) == _age_since("2022-03-12")


async def test_private_archived_and_absent_slugs_are_the_same_404(published, signed_in, client, app):
    """Nothing in the three responses tells a visitor which case they hit.

    Archiving has no endpoint yet, so the pet is archived in SQL — the point
    here is the view's `archived_at is null`, not a route ticket 08 owns.
    """
    absent = await client.get("/public/pets/never-existed-0000")

    await signed_in.patch(f"/pets/{published['id']}", json={"is_public": False})
    private = await client.get(f"/public/pets/{published['slug']}")

    await signed_in.patch(f"/pets/{published['id']}", json={"is_public": True})
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "update pets set archived_at = now(), archived_reason = 'rehomed' where id = $1",
            published["id"],
        )
    archived = await client.get(f"/public/pets/{published['slug']}")

    assert [r.status_code for r in (absent, private, archived)] == [404, 404, 404]
    assert absent.content == private.content == archived.content
    assert absent.headers.get("content-length") == archived.headers.get("content-length")


async def test_switching_the_page_off_makes_the_link_404_at_once(published, signed_in, client):
    assert (await client.get(f"/public/pets/{published['slug']}")).status_code == 200

    await signed_in.patch(f"/pets/{published['id']}", json={"is_public": False})

    assert (await client.get(f"/public/pets/{published['slug']}")).status_code == 404


async def test_toggling_off_and_on_returns_the_identical_slug(published, signed_in, client):
    """The slug was claimed at insert, so a link already handed out keeps working."""
    off = await signed_in.patch(f"/pets/{published['id']}", json={"is_public": False})
    on = await signed_in.patch(f"/pets/{published['id']}", json={"is_public": True})

    assert off.json()["slug"] == on.json()["slug"] == published["slug"]
    assert (await client.get(f"/public/pets/{published['slug']}")).status_code == 200


async def test_the_public_request_runs_as_anon_and_reads_both_views_in_one_transaction(
    published, as_visitor
):
    async with as_visitor() as conn:
        assert await conn.fetchval("select current_role") == "anon"
        assert await conn.fetchval("select rolbypassrls from pg_roles where rolname = 'anon'") is False

        # Both views, and the same transaction id for both: the entries can
        # never belong to a different read of the pet.
        pet = await conn.fetchrow(
            "select slug, txid_current() as tx from public_pets where slug = $1",
            published["slug"],
        )
        entries = await conn.fetchrow(
            "select title, txid_current() as tx from public_entries where slug = $1",
            published["slug"],
        )
        assert pet["tx"] == entries["tx"]

        # And the tables underneath stay shut: anon has the same grants Supabase
        # gives it, and still no policy on either table.
        assert await conn.fetch("select * from pets") == []
        assert await conn.fetch("select * from entries") == []


async def test_the_endpoint_itself_goes_through_anons_grant_on_the_views(published, client, app):
    """Withdraw anon's grant and the live route stops working.

    A request that had quietly stayed superuser would not notice.
    """
    async with app.state.pool.acquire() as conn:
        await conn.execute("revoke select on public_pets from anon")
    try:
        with pytest.raises(Exception, match="permission denied"):
            await client.get(f"/public/pets/{published['slug']}")
    finally:
        async with app.state.pool.acquire() as conn:
            await conn.execute("grant select on public_pets to anon")

    assert (await client.get(f"/public/pets/{published['slug']}")).status_code == 200


async def test_every_entry_appears_as_a_date_a_title_and_the_next_due_date(
    published, signed_in, client
):
    """All entries or none — there is no per-entry visibility switch."""
    await signed_in.post(
        "/entries",
        json={"pet_id": published["id"], "title": "Grooming", "happened_on": "2026-03-18"},
    )

    page = (await client.get(f"/public/pets/{published['slug']}")).json()

    assert page["entries"] == [
        {"title": "Grooming", "happened_on": "2026-03-18", "due_on": None},
        {"title": "Rabies booster", "happened_on": "2025-07-14", "due_on": "2026-07-14"},
    ]
