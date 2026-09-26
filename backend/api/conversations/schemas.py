from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, model_validator


class SendMessageRequest(BaseModel):
    # Null starts a new conversation; the id it gets travels back as the
    # first SSE event so the caller can send the next message in the thread.
    conversation_id: str | None = None
    message: str = ""
    # Ids from POST /uploads, for photos attached to this message.
    upload_ids: list[UUID] = []

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.message and not self.upload_ids:
            raise ValueError("send a message, a photo, or both")
        return self


class ConversationSummary(BaseModel):
    id: str
    # Null for a conversation the handler hasn't renamed and that never got a
    # real title -- the sidebar falls back to its own placeholder.
    title: str | None
    updated_at: datetime


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ConversationDetail(BaseModel):
    id: str
    title: str | None
    history: list[ConversationTurn]
