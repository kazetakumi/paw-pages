"""GET /dashboard and POST /pets/{id}/restore, ported from v1's
backend/app/main.py and due.py -- the two the account screen calls. The
rest of v1's pet and entry routes aren't ported yet.

pawpages_due_items is the one definition of due and overdue; nothing here
works out what overdue means. No `where handler_id = ...`: the RLS
connection has already become the caller, and the view is security_invoker.
"""

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from auth.dependencies import AuthenticatedHandler, get_current_handler
from db.rls import rls_connection

from .schemas import ArchivedPet, Dashboard, DueItem, PetCard, PetOut

router = APIRouter(tags=["pets"])

# Everything a pet shows on any screen. age_* is derived on every read.
_PET_COLUMNS = """id, name, species, breed, sex, date_of_birth, dob_is_approx, colour, slug, is_public,
       (photo_path is not null) as has_photo,
       extract(year  from age(date_of_birth))::int as age_years,
       extract(month from age(date_of_birth))::int as age_months"""

_LEDGER = """select d.entry_id, d.pet_id, d.pet_name, d.title, d.due_on, d.days_until,
       d.is_overdue, e.happened_on, e.vet
       from pawpages_due_items d join pawpages_entries e on e.id = d.entry_id
       order by d.due_on, d.entry_id"""

_PET_CARDS = f"""select {_PET_COLUMNS},
       d.due_on as next_due_on,
       coalesce(d.is_overdue, false) as next_due_is_overdue,
       (select max(happened_on) from pawpages_entries e where e.pet_id = p.id) as last_logged_on
       from pawpages_pets p
       left join lateral (
         select due_on, is_overdue from pawpages_due_items
         where pet_id = p.id order by due_on limit 1
       ) d on true
       where p.archived_at is null
       order by p.created_at"""

_COUNTS = """select
       (select count(*) from pawpages_pets where archived_at is null)     as active_pets,
       (select count(*) from pawpages_pets where archived_at is not null) as archived_pets,
       (select count(*) from pawpages_due_items where is_overdue)         as overdue,
       (select count(*) from pawpages_due_items
         where not is_overdue and days_until <= 30)                       as due_within_30_days"""

_ARCHIVED = """select id, name, archived_reason, archived_at::date as archived_on
       from pawpages_pets where archived_at is not null order by created_at"""


@router.get("/dashboard", response_model=Dashboard)
async def dashboard(
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> Dashboard:
    return Dashboard(
        ledger=[DueItem(**dict(r)) for r in await conn.fetch(_LEDGER)],
        pets=[PetCard(**dict(r)) for r in await conn.fetch(_PET_CARDS)],
        archived=[ArchivedPet(**dict(r)) for r in await conn.fetch(_ARCHIVED)],
        **dict(await conn.fetchrow(_COUNTS)),
    )


@router.post("/pets/{pet_id}/restore", response_model=PetOut)
async def restore_pet(
    pet_id: str,
    handler: AuthenticatedHandler = Depends(get_current_handler),
    conn: asyncpg.Connection = Depends(rls_connection),
) -> PetOut:
    """Both archive columns clear together; same slug, entries and photo."""
    row = await conn.fetchrow(
        f"update pawpages_pets set archived_at = null, archived_reason = null where id = $1 returning {_PET_COLUMNS}",
        pet_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such pet.")
    return PetOut(**dict(row))
