"""The regular-conversation loop: no tools yet, just messages in, a streamed
reply out. Tool use is meant to land inside `stream_turn` later -- passing a
real `tools` list to `llm.stream()` -- not as a separate code path, so keep
this thin rather than building anything around the tools=[] gap."""

from .llm import LLM
from .prompts.loader import load_prompt

SYSTEM_PROMPT = load_prompt("chat/system")


def stream_turn(llm: LLM, history: list[dict]):
    """Stream one assistant reply. `history` is the conversation so far,
    ending with the new user turn -- each item {"role": "user" | "assistant",
    "content": str}, oldest first. Yields LLM.stream()'s events unchanged:
    {"type": "text.delta", "text": ...} as tokens arrive, then one {"type":
    "done", "text_response": ..., "tool_calls": []} -- tool_calls is always
    empty here since no tools are passed yet."""
    messages = [{"role": "developer", "content": SYSTEM_PROMPT}, *history]
    yield from llm.stream(messages, tools=[])
