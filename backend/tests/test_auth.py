async def test_signup_creates_the_handler_row_through_the_trigger(client, auth_stub):
    response = await client.post(
        "/auth/signup",
        json={"name": "Akhil", "email": "akhil@example.com", "password": "correct horse"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Akhil"
