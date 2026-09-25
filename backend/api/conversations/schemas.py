from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SendMessageRequest(BaseModel):
    # Null starts a new conversation; the id it gets travels back as the
    # first SSE event so the caller can send the next message in the thread.
    conversation_id: str | None = None
    message: str = Field(min_length=1)


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
