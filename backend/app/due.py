"""The ledger: what the `due_items` view says is outstanding.

`due_items` is the one definition of due and overdue. Nothing here works out
what overdue means — `days_until` and `is_overdue` are selected, never derived,
and the archived-pet exclusion lives inside the view rather than in a filter.
"""

from datetime import date
from uuid import UUID

from pydantic import BaseModel


class DueItem(BaseModel):
    entry_id: UUID
    pet_id: UUID
    pet_name: str
    title: str
    due_on: date
    # Both straight off the view. Negative days_until is how far past it is.
    days_until: int
    is_overdue: bool


class Dashboard(BaseModel):
    ledger: list[DueItem]


LEDGER = """select entry_id, pet_id, pet_name, title, due_on, days_until, is_overdue
       from due_items order by due_on, entry_id"""
