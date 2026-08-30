"""The ledger: what the `due_items` view says is outstanding.

`due_items` is the one definition of due and overdue. Nothing here works out
what overdue means — `days_until` and `is_overdue` are selected, never derived,
and the archived-pet exclusion lives inside the view rather than in a filter.
"""

from datetime import date
from uuid import UUID

from pydantic import BaseModel

from .pets import PetOut


class DueItem(BaseModel):
    entry_id: UUID
    pet_id: UUID
    pet_name: str
    title: str
    due_on: date
    # Both straight off the view. Negative days_until is how far past it is.
    days_until: int
    is_overdue: bool
    # The entry the item came from: what "last given" says, and what the next
    # one is pre-filled from.
    happened_on: date
    vet: str | None


class PetRecord(PetOut):
    """A pet as its own page opens: what it needs, before its history."""

    due_items: list[DueItem]


class PetCard(PetOut):
    """A pet as the home screen draws it: what it owes and when it was last seen."""

    next_due_on: date | None
    next_due_is_overdue: bool
    last_logged_on: date | None


class ArchivedPet(BaseModel):
    """An archived pet as the home screen keeps it: findable, out of the way.

    Why and when, and nothing a card would need — an archived pet has no next
    due date, because `due_items` has no row for it.
    """

    id: UUID
    name: str
    archived_reason: str
    archived_on: date


class Dashboard(BaseModel):
    ledger: list[DueItem]
    pets: list[PetCard]
    # The summary line, as drawn. Archived pets are counted, never carded.
    active_pets: int
    overdue: int
    due_within_30_days: int
    archived_pets: int
    archived: list[ArchivedPet]


# `due_items` owns due and overdue; the join back to `entries` only fetches
# the two columns the view leaves out.
LEDGER = """select d.entry_id, d.pet_id, d.pet_name, d.title, d.due_on, d.days_until,
       d.is_overdue, e.happened_on, e.vet
       from due_items d join entries e on e.id = d.entry_id
       {where} order by d.due_on, d.entry_id"""

# The nearest outstanding item comes from the view, so an archived pet has no
# next due for the same reason it has no ledger rows.
PET_CARDS = """select {columns},
       d.due_on as next_due_on,
       coalesce(d.is_overdue, false) as next_due_is_overdue,
       (select max(happened_on) from entries e where e.pet_id = p.id) as last_logged_on
       from pets p
       left join lateral (
         select due_on, is_overdue from due_items
         where pet_id = p.id order by due_on limit 1
       ) d on true
       where p.archived_at is null
       order by p.created_at"""

# `days_until` is the view's, so "within thirty days" is a window on a number
# Postgres worked out, not a second opinion about what due means.
COUNTS = """select
       (select count(*) from pets where archived_at is null)     as active_pets,
       (select count(*) from pets where archived_at is not null) as archived_pets,
       (select count(*) from due_items where is_overdue)         as overdue,
       (select count(*) from due_items
         where not is_overdue and days_until <= 30)              as due_within_30_days"""

# A calendar date, like every other date the API sends: when it was archived is
# something a handler reads, not an instant anything is compared against.
ARCHIVED = """select id, name, archived_reason, archived_at::date as archived_on
       from pets where archived_at is not null order by created_at"""
