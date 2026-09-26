from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, StringConstraints

# Mirrors of the checks on pawpages_pets, so a bad field comes back named.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Species = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Breed = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]
Colour = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]


class PetPatch(BaseModel):
    """Only the fields sent are touched; null clears one."""

    name: Name | None = None
    species: Species | None = None
    breed: Breed | None = None
    sex: Literal["male", "female"] | None = None
    date_of_birth: date | None = None
    dob_is_approx: bool | None = None
    colour: Colour | None = None
    is_public: bool | None = None


class ArchiveIn(BaseModel):
    reason: Literal["passed_away", "rehomed", "other"]


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


class PetRecord(PetOut):
    """A pet as its own page opens: what it owes, before its history."""

    due_items: list[DueItem]


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
