"""The reset round trip, with Supabase Auth stubbed at the HTTP boundary.

The stub stands in for the email: the link's token is read off it, the way a
handler would read it out of their inbox.
"""


async def test_a_reset_request_asks_supabase_auth_to_email_a_link(
    client, seed_handler, auth_stub
):
    await seed_handler("Akhil", "akhil@example.com")

    response = await client.post("/auth/password-reset", json={"email": "akhil@example.com"})

    assert response.status_code == 204
    assert "akhil@example.com" in auth_stub.recovery_tokens


async def test_an_unregistered_email_looks_exactly_the_same_from_outside(client, auth_stub):
    response = await client.post("/auth/password-reset", json={"email": "nobody@example.com"})

    assert response.status_code == 204
    assert auth_stub.recovery_tokens == {}


async def test_the_emailed_token_sets_the_new_password(client, seed_handler, auth_stub):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post("/auth/password-reset", json={"email": "akhil@example.com"})
    emailed_token = auth_stub.recovery_tokens["akhil@example.com"]

    response = await client.post(
        "/auth/password-reset/confirm",
        json={"access_token": emailed_token, "password": "a whole new horse"},
    )

    assert response.status_code == 204
    assert auth_stub.passwords["akhil@example.com"] == "a whole new horse"


async def test_a_stale_link_is_told_to_ask_for_a_new_one(client):
    response = await client.post(
        "/auth/password-reset/confirm",
        json={"access_token": "expired.or.forged", "password": "a whole new horse"},
    )

    assert response.status_code == 400
    assert "new one" in response.json()["detail"]


async def test_the_emailed_link_comes_back_to_the_reset_screen(client, seed_handler, auth_stub):
    await seed_handler("Akhil", "akhil@example.com")

    await client.post("/auth/password-reset", json={"email": "akhil@example.com"})

    assert auth_stub.recovery_redirect.endswith("/reset-password")
