"""The handler as the account screen reads and writes it.

Mirrors of the checks on `handlers`, the same way `pets` mirrors its own, so a
value the database would refuse comes back named beside the field it was typed
into.
"""

from datetime import date
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
# Optional and unset by default. Free text within the length the check allows:
# nothing in the app branches on either, and no list would fit everyone.
Gender = Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]
Nationality = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]


class HandlerPatch(BaseModel):
    """A correction to the account. Only the fields sent are touched; null
    clears one, which is how an optional field goes back to unset."""

    name: Name | None = None
    date_of_birth: date | None = None
    gender: Gender | None = None
    nationality: Nationality | None = None


class HandlerOut(BaseModel):
    id: UUID
    name: str
    # From the caller's own verified claims. `handlers` never duplicates it:
    # the email and the password both live in auth.users.
    email: str
    joined_on: date
    pet_count: int
    entry_count: int
    # The three optional ones. None until the handler fills them in.
    date_of_birth: date | None
    gender: str | None
    nationality: str | None
    # Derived by the database from date_of_birth on every read, never stored,
    # so nobody is ever asked to keep an age up to date.
    age: int | None
