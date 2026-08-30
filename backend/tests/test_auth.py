async def test_signup_creates_the_handler_row_through_the_trigger(client, auth_stub):
    response = await client.post(
        "/auth/signup",
        json={"name": "Akhil", "email": "akhil@example.com", "password": "correct horse"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Akhil"


async def test_signin_sets_an_httponly_secure_samesite_lax_cookie(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")

    response = await client.post(
        "/auth/signin", json={"email": "akhil@example.com", "password": "correct horse"}
    )

    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("pp_session=")
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=lax" in cookie
    # Nothing a browser script could read, and no token in the body either.
    assert "access_token" not in response.text


async def test_me_returns_the_signed_in_handlers_name(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post(
        "/auth/signin", json={"email": "akhil@example.com", "password": "correct horse"}
    )

    response = await client.get("/me")

    assert response.status_code == 200
    assert response.json()["name"] == "Akhil"


async def test_me_401s_with_no_cookie(client):
    response = await client.get("/me")

    assert response.status_code == 401


async def test_an_expired_access_token_is_refreshed_and_the_cookie_re_issued(
    client, seed_handler, auth_stub
):
    await seed_handler("Akhil", "akhil@example.com")
    auth_stub.access_token_lifetime = -600  # signed in, but already expired
    signin = await client.post(
        "/auth/signin", json={"email": "akhil@example.com", "password": "correct horse"}
    )
    stale = signin.cookies["pp_session"]

    response = await client.get("/me")

    assert response.status_code == 200
    assert response.json()["name"] == "Akhil"
    assert "set-cookie" in response.headers, "the refreshed session was not re-issued"
    assert client.cookies["pp_session"] != stale


async def test_a_refresh_token_supabase_rejects_ends_the_session(client, seed_handler, auth_stub):
    await seed_handler("Akhil", "akhil@example.com")
    auth_stub.access_token_lifetime = -600
    await client.post(
        "/auth/signin", json={"email": "akhil@example.com", "password": "correct horse"}
    )
    auth_stub.forget_refresh_tokens()

    response = await client.get("/me")

    assert response.status_code == 401


async def test_signing_out_clears_the_cookie_and_the_next_call_401s(client, seed_handler):
    await seed_handler("Akhil", "akhil@example.com")
    await client.post(
        "/auth/signin", json={"email": "akhil@example.com", "password": "correct horse"}
    )

    signout = await client.post("/auth/signout")

    assert signout.status_code == 204
    assert "pp_session" not in client.cookies
    assert (await client.get("/me")).status_code == 401


async def test_signing_out_without_a_session_is_still_fine(client):
    assert (await client.post("/auth/signout")).status_code == 204


async def test_an_already_registered_email_is_a_field_level_error_pointing_at_sign_in(
    client, seed_handler
):
    await seed_handler("Akhil", "akhil@example.com")

    response = await client.post(
        "/auth/signup",
        json={"name": "Akhil", "email": "akhil@example.com", "password": "correct horse"},
    )

    assert 400 <= response.status_code < 500
    detail = response.json()["detail"]
    assert detail["field"] == "email"
    assert "sign in" in detail["message"].lower()


async def test_a_decoy_signup_response_is_the_same_field_level_error_not_a_5xx(
    client, seed_handler, auth_stub
):
    await seed_handler("Akhil", "akhil@example.com")
    auth_stub.hide_existing_users = True  # email-enumeration protection, as in production

    response = await client.post(
        "/auth/signup",
        json={"name": "Akhil", "email": "akhil@example.com", "password": "correct horse"},
    )

    assert 400 <= response.status_code < 500
    assert response.json()["detail"]["field"] == "email"
