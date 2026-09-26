from datetime import date
from uuid import UUID

from pydantic import BaseModel


class PetOut(BaseModel):
    id: UUID
    name: str
    species: str
    breed: str | None
    sex: str | None
    date_of_birth: date | None
    dob_is_approx: bool
    colour: str | None
    slug: str
    is_public: bool
    # Whether there's a photo to ask for -- never the path.
    has_photo: bool
    age_years: int | None
    age_months: int | None


class DueItem(BaseModel):
    entry_id: UUID
    pet_id: UUID
    pet_name: str
    title: str
    due_on: date
    # Straight off pawpages_due_items. Negative is how far past it is.
    days_until: int
    is_overdue: bool
    happened_on: date
    vet: str | None


class PetCard(PetOut):
    next_due_on: date | None
    next_due_is_overdue: bool
    last_logged_on: date | None


class ArchivedPet(BaseModel):
    id: UUID
    name: str
    archived_reason: str
    archived_on: date


class Dashboard(BaseModel):
    ledger: list[DueItem]
    pets: list[PetCard]
    active_pets: int
    overdue: int
    due_within_30_days: int
    archived_pets: int
    archived: list[ArchivedPet]
