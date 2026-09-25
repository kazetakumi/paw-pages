from typing import TypeVar

from pydantic import BaseModel

from .llm import LLM

T = TypeVar("T", bound=BaseModel)


def extract(llm: LLM, text: str, schema: type[T], prompt: str) -> T:
    """One structured extraction: `prompt` sets the extraction task, `text`
    is the source document, `schema` is the Pydantic model the result is
    validated against."""
    messages = [
        {"role": "developer", "content": prompt},
        {"role": "user", "content": text},
    ]
    return llm.run_structured(messages, schema)
