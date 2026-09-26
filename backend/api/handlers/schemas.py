from datetime import date
from typing import Annotated

from pydantic import BaseModel, StringConstraints

# Mirrors of the checks on pawpages_handlers, so a value the database would
# refuse comes back named beside the field it was typed into.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Gender = Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]
Nationality = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]


class MeOut(BaseModel):
    id: str
    name: str
    # From Supabase Auth, never pawpages_handlers: the email and the password
    # both live in auth.users.
    email: str
    joined_on: date
    pet_count: int
    entry_count: int
    # The balance after today's refill. Can dip a few below 0: a chat turn
    # is charged once it has run, whatever it cost.
    credits: int
    date_of_birth: date | None
    gender: str | None
    nationality: str | None
    # Derived by the database from date_of_birth on every read, never stored.
    age: int | None


class MePatch(BaseModel):
    """Only the fields sent are touched; null clears an optional one."""

    name: Name | None = None
    date_of_birth: date | None = None
    gender: Gender | None = None
    nationality: Nationality | None = None


class EmailIn(BaseModel):
    email: str


class PasswordIn(BaseModel):
    password: str
