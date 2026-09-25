from pydantic import BaseModel


class MeOut(BaseModel):
    id: str
    name: str
    email: str
    joined_on: str
