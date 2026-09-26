from pydantic import BaseModel


class UploadOut(BaseModel):
    id: str
