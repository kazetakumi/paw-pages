"""The regular-conversation loop: messages in, a streamed reply out, for one
model turn. Tool calls are decided here (a real `tools` list goes to
llm.stream()) but not executed here -- running a tool needs the caller's DB
connection, which this module deliberately doesn't have. The caller loops:
call stream_turn, and if the "done" event carries tool_calls, execute them
and call stream_turn again with the results appended, until a turn comes
back with none."""

from .llm import LLM
from .prompts.loader import load_prompt

SYSTEM_PROMPT = load_prompt("chat/system")


def stream_turn(llm: LLM, history: list[dict], tools: list[dict]):
    """Stream one assistant reply. `history` is the conversation so far,
    ending with the new user turn -- each item either {"role": "user" |
    "assistant", "content": str}, or a function_call / function_call_output
    item from a tool round-trip earlier in the conversation. Yields
    LLM.stream()'s events unchanged: {"type": "text.delta", "text": ...} as
    tokens arrive, then one {"type": "done", "text_response": ...,
    "tool_calls": ...} -- tool_calls is a list of the model's requested
    calls, empty when it just replied."""
    messages = [{"role": "developer", "content": SYSTEM_PROMPT}, *history]
    yield from llm.stream(messages, tools=tools)
