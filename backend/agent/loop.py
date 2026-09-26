"""Runs one chat turn to completion, tool round-trips and all. Calls
stream_turn; whenever it comes back asking for tool calls, runs them and
calls stream_turn again with the results appended -- until a turn comes
back with none, or MAX_TOOL_ROUNDS is hit as a guard against a model stuck
calling tools back-to-back. Yields {"type": "text.delta", "text": ...} as
tokens arrive, then one {"type": "done", "text_response": ..., "items":
...} -- text_response is the last round's text, items is everything this
turn added after the user message, in order, for the caller to persist.

Needs the caller's RLS-scoped asyncpg connection to run tools against --
this module has no connection of its own, same as tools/registry.py.
"""

import asyncpg
from starlette.concurrency import iterate_in_threadpool

from .chat import stream_turn
from .llm import LLM
from .tools.registry import TOOLS, execute_tool

MAX_TOOL_ROUNDS = 5


async def run_turn(llm: LLM, history: list[dict], conn: asyncpg.Connection):
    # Every item this turn produces: each round's assistant text, then its
    # function_call / function_call_output pairs. Replayed to the model
    # alongside history on the next round, and handed back to be saved.
    items: list[dict] = []
    reply_text = ""

    for _ in range(MAX_TOOL_ROUNDS):
        tool_calls = []
        async for event in iterate_in_threadpool(stream_turn(llm, history + items, TOOLS)):
            if event["type"] == "text.delta":
                yield event
            else:
                reply_text = event["text_response"]
                tool_calls = event["tool_calls"]

        if reply_text:
            items.append({"role": "assistant", "content": reply_text})

        if not tool_calls:
            break

        for call in tool_calls:
            output = await execute_tool(conn, call.name, call.arguments)
            items.append({"type": "function_call", "call_id": call.call_id, "name": call.name, "arguments": call.arguments})
            items.append({"type": "function_call_output", "call_id": call.call_id, "output": output})

    yield {"type": "done", "text_response": reply_text, "items": items}
