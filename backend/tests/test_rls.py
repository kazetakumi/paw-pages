import pytest


async def add_pet(conn, name: str, slug: str) -> str:
    return await conn.fetchval(
        "insert into pawpages_pets (handler_id, name, species, slug)"
        " values ((select auth.uid()), $1, 'dog', $2) returning id",
        name,
        slug,
    )


async def test_the_request_runs_as_authenticated_never_as_service_role(as_handler, seed_handler):
    handler = await seed_handler("Akhil", "akhil@example.com")

    async with as_handler(handler) as conn:
        assert await conn.fetchval("select current_role") == "authenticated"
        assert str(await conn.fetchval("select auth.uid()")) == handler
        assert await conn.fetchval("select rolbypassrls from pg_roles where rolname = 'authenticated'") is False


async def test_handler_b_reads_none_of_handler_as_rows(as_handler, seed_handler):
    a = await seed_handler("Akhil", "a@example.com")
    b = await seed_handler("Bela", "b@example.com")

    async with as_handler(a) as conn:
        pet = await add_pet(conn, "Biscuit", "biscuit-a1b2")
        await conn.execute(
            "insert into pawpages_entries (pet_id, title, happened_on)"
            " values ($1, 'Rabies booster', current_date)",
            pet,
        )

    async with as_handler(b) as conn:
        # No ownership filter anywhere: the policies are the filter.
        assert await conn.fetch("select * from pawpages_pets") == []
        assert await conn.fetch("select * from pawpages_entries") == []
        assert await conn.fetchval("select count(*) from pawpages_handlers") == 1
        assert await conn.fetchval("select name from pawpages_handlers") == "Bela"


async def test_handler_b_cannot_write_over_handler_as_rows(as_handler, seed_handler):
    a = await seed_handler("Akhil", "a@example.com")
    b = await seed_handler("Bela", "b@example.com")

    async with as_handler(a) as conn:
        pet = await add_pet(conn, "Biscuit", "biscuit-a1b2")

    async with as_handler(b) as conn:
        assert await conn.execute("update pawpages_pets set name = 'Stolen' where id = $1", pet) == "UPDATE 0"
        assert await conn.execute("delete from pawpages_pets where id = $1", pet) == "DELETE 0"

    async with as_handler(a) as conn:
        assert await conn.fetchval("select name from pawpages_pets") == "Biscuit"


async def test_a_pet_cannot_be_filed_under_another_handler(as_handler, seed_handler):
    a = await seed_handler("Akhil", "a@example.com")
    b = await seed_handler("Bela", "b@example.com")

    with pytest.raises(Exception, match="row-level security"):
        async with as_handler(b) as conn:
            await conn.execute(
                "insert into pawpages_pets (handler_id, name, species, slug)"
                " values ($1, 'Biscuit', 'dog', 'biscuit-a1b2')",
                a,
            )


async def test_me_carries_no_ownership_filter_and_still_cannot_see_another_handler(
    client, seed_handler
):
    await seed_handler("Akhil", "a@example.com")
    await seed_handler("Bela", "b@example.com")
    await client.post("/auth/signin", json={"email": "b@example.com", "password": "x"})

    response = await client.get("/me")

    assert response.json()["name"] == "Bela"
