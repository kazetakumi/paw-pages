"""The account: what the app calls a handler, what they can take away, and leaving.

Nothing here stubs the database. The three optional personal fields, their
check constraints and the cascade from `auth.users` are all real. The only
stubbed things are the three Supabase HTTP services — Auth, Storage and the
Admin API — each at its own httpx transport.
"""

import io
import json
import zipfile
from datetime import date

import pytest

from app.config import settings
from app.session import claims_of
from tests.conftest import SERVICE_ROLE_KEY

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


JPEG = b"\xff\xd8\xff\xe0 not really a jpeg, but the bucket only reads the type"


async def test_the_export_carries_every_pet_every_entry_and_every_photo(signed_in, storage_stub):
    """One archive, built on request and streamed. Opened here rather than
    described, so nothing can quietly go missing from it."""
    biscuit = (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()
    toffee = (await signed_in.post("/pets", json={"name": "Toffee", "species": "cat"})).json()
    await signed_in.post(
        "/entries",
        json={
            "pet_id": biscuit["id"],
            "title": "Rabies booster",
            "happened_on": TODAY,
            "note": "Took it well.",
            "vet": "Dr Rao",
        },
    )
    await signed_in.post(
        "/entries", json={"pet_id": toffee["id"], "title": "Nail trim", "happened_on": TODAY}
    )
    await signed_in.put(
        f"/pets/{biscuit['id']}/photo", content=JPEG, headers={"content-type": "image/jpeg"}
    )

    export = await signed_in.get("/me/export")

    assert export.status_code == 200
    assert export.headers["content-type"] == "application/zip"
    assert "attachment" in export.headers["content-disposition"]

    archive = zipfile.ZipFile(io.BytesIO(export.content))
    data = json.loads(archive.read("paw-pages.json"))
    assert data["handler"]["name"] == "Akhil"
    assert data["handler"]["email"] == "akhil@example.com"
    assert {pet["name"] for pet in data["pets"]} == {"Biscuit", "Toffee"}
    logged = {entry["title"] for pet in data["pets"] for entry in pet["entries"]}
    assert logged == {"Rabies booster", "Nail trim"}
    kept = next(e for p in data["pets"] for e in p["entries"] if e["title"] == "Rabies booster")
    assert (kept["note"], kept["vet"]) == ("Took it well.", "Dr Rao")

    photos = [name for name in archive.namelist() if name.startswith("photos/")]
    assert len(photos) == 1, "the photo is missing from the export"
    assert archive.read(photos[0]) == JPEG
    # Read as the handler, so the four owner policies in 0003 are what allowed it.
    method, _, bearer = storage_stub.calls[-1]
    assert method == "GET"
    assert claims_of(bearer)["sub"] == (await signed_in.get("/me")).json()["id"]


@pytest.fixture
async def with_a_photo(signed_in, storage_stub):
    """A handler with something in the bucket that only the rows can name."""
    biscuit = (await signed_in.post("/pets", json={"name": "Biscuit", "species": "dog"})).json()
    await signed_in.post(
        "/entries", json={"pet_id": biscuit["id"], "title": "Rabies booster", "happened_on": TODAY}
    )
    await signed_in.put(
        f"/pets/{biscuit['id']}/photo", content=JPEG, headers={"content-type": "image/jpeg"}
    )
    assert storage_stub.objects != {}
    return signed_in


async def test_deleting_an_account_removes_the_photos_before_the_auth_user(
    with_a_photo, storage_stub, admin_stub
):
    """Order matters: the cascade does not reach storage, so once the rows are
    gone nothing knows which files to remove."""
    bucket_when_the_user_went = []
    admin_stub.on_delete = lambda: bucket_when_the_user_went.append(dict(storage_stub.objects))

    gone = await with_a_photo.delete("/me")

    assert gone.status_code == 204
    assert bucket_when_the_user_went == [{}], "the auth user went before its photos did"


async def test_after_deletion_no_row_and_no_stored_object_is_left_behind(
    with_a_photo, app, storage_stub, admin_stub
):
    gone = await with_a_photo.delete("/me")

    assert gone.status_code == 204
    assert storage_stub.objects == {}
    async with app.state.pool.acquire() as conn:
        for table in ("auth.users", "handlers", "pets", "entries"):
            assert await conn.fetchval(f"select count(*) from {table}") == 0, table
    # The cookie went with it, so the next call is a stranger's.
    assert (await with_a_photo.get("/me")).status_code == 401


async def test_the_service_role_key_deletes_the_auth_user_and_touches_nothing_else(
    with_a_photo, storage_stub, auth_stub, admin_stub
):
    """The one thing it is ever used for. Everything else on this screen runs
    under the handler's own token through the RLS dependency."""
    handler_id = (await with_a_photo.get("/me")).json()["id"]
    await with_a_photo.patch("/me", json={"name": "Akhil J P", "nationality": "Indian"})
    await with_a_photo.patch("/me/email", json={"email": "akhil@newmail.example"})
    await with_a_photo.get("/me/export")

    await with_a_photo.delete("/me")

    assert [(method, path) for method, path, _ in admin_stub.calls] == [
        ("DELETE", f"/auth/v1/admin/users/{handler_id}")
    ]
    assert admin_stub.calls[0][2] == SERVICE_ROLE_KEY
    # Every byte moved, and every credential changed, went as the handler.
    assert storage_stub.calls, "no photo was ever read or written"
    for _, _, bearer in storage_stub.calls:
        assert claims_of(bearer)["sub"] == handler_id
    for _, _, bearer in auth_stub.calls:
        assert bearer != SERVICE_ROLE_KEY


async def test_a_missing_service_role_key_is_a_clear_refusal_not_a_500(
    with_a_photo, storage_stub, admin_stub, monkeypatch
):
    """The key is the one thing this ticket cannot supply itself. Without it
    the account stays whole rather than half deleted."""
    monkeypatch.setattr(settings, "supabase_service_role_key", "")

    refused = await with_a_photo.delete("/me")

    assert refused.status_code == 503
    assert "SUPABASE_SERVICE_ROLE_KEY" in refused.json()["detail"]
    assert admin_stub.calls == []
    assert storage_stub.objects != {}, "a photo was destroyed on the way to finding out"
    assert (await with_a_photo.get("/me")).status_code == 200


async def test_every_account_endpoint_is_shut_to_anyone_without_a_session(client):
    assert (await client.get("/me")).status_code == 401
    assert (await client.patch("/me", json={"name": "Nobody"})).status_code == 401
    assert (await client.patch("/me/email", json={"email": "no@example.com"})).status_code == 401
    assert (await client.patch("/me/password", json={"password": "a longer secret"})).status_code == 401
    assert (await client.get("/me/export")).status_code == 401
    assert (await client.delete("/me")).status_code == 401
