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


class PetCard(PetOut):
    """A pet as the home screen draws it: what it owes and when it was last seen."""

    next_due_on: date | None
    next_due_is_overdue: bool
    last_logged_on: date | None


class Dashboard(BaseModel):
    ledger: list[DueItem]
    pets: list[PetCard]


LEDGER = """select entry_id, pet_id, pet_name, title, due_on, days_until, is_overdue
       from due_items order by due_on, entry_id"""

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
