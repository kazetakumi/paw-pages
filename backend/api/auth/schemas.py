from pydantic import BaseModel, EmailStr, Field


class SignUpRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str | None = None


class SignInRequest(BaseModel):
    email: EmailStr
    password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    access_token: str
    password: str = Field(min_length=8)


class MessageResponse(BaseModel):
    message: str


class HandlerOut(BaseModel):
    """Matches web/src/api.ts's `Handler` type. pet_count, entry_count and the
    three optional personal fields are placeholders here -- the auth module
    only knows what Supabase Auth told it, not pawpages_handlers/pets/entries.
    The Handler module (GET /me) owns the real query.
    """

    id: str
    name: str
    email: str
    joined_on: str
    pet_count: int = 0
    entry_count: int = 0
    date_of_birth: str | None = None
    gender: str | None = None
    nationality: str | None = None
    age: int | None = None
