"""Runs one chat turn to completion, tool round-trips and all. Calls
stream_turn; whenever it comes back asking for tool calls, runs them and
calls stream_turn again with the results appended -- until a turn comes
back with none, or MAX_TOOL_ROUNDS is hit as a guard against a model stuck
calling tools back-to-back. Yields {"type": "text.delta", "text": ...} as
tokens arrive, then one {"type": "done", "text_response": ..., "items":
..., "usage": ...} -- text_response is the last round's text, items is
everything this turn added after the user message, in order, for the caller
to persist, and usage is every round's tokens summed and priced, for the
caller to charge.

Needs the caller's RLS-scoped asyncpg connection to run tools against, and
its fetch_file for reading an upload's bytes out of storage -- this module
has neither of its own, same as tools/registry.py.
"""

import asyncpg
from starlette.concurrency import iterate_in_threadpool

from .chat import stream_turn
from .llm import LLM
from .pricing.loader import calculate_cost
from .tools.registry import TOOLS, FetchFile, execute_tool

MAX_TOOL_ROUNDS = 5


async def run_turn(llm: LLM, history: list[dict], conn: asyncpg.Connection, fetch_file: FetchFile):
    # Every item this turn produces: each round's assistant text, then its
    # function_call / function_call_output pairs. Replayed to the model
    # alongside history on the next round, and handed back to be saved.
    items: list[dict] = []
    reply_text = ""
    usage = {"input_tokens": 0, "cached_tokens": 0, "output_tokens": 0}

    for _ in range(MAX_TOOL_ROUNDS):
        tool_calls = []
        async for event in iterate_in_threadpool(stream_turn(llm, history + items, TOOLS)):
            if event["type"] == "text.delta":
                yield event
            else:
                reply_text = event["text_response"]
                tool_calls = event["tool_calls"]
                usage["input_tokens"] += event["usage"].input_tokens
                usage["cached_tokens"] += event["usage"].input_tokens_details.cached_tokens
                usage["output_tokens"] += event["usage"].output_tokens

        if reply_text:
            items.append({"role": "assistant", "content": reply_text})

        if not tool_calls:
            break

        for call in tool_calls:
            output = await execute_tool(conn, call.name, call.arguments, fetch_file)
            items.append({"type": "function_call", "call_id": call.call_id, "name": call.name, "arguments": call.arguments})
            items.append({"type": "function_call_output", "call_id": call.call_id, "output": output})

    # Every round runs on the same model and cost is linear in tokens, so
    # pricing the sum once equals summing each round's price.
    usage["cost_usd"] = calculate_cost(llm.model, **usage).total_cost_usd
    yield {"type": "done", "text_response": reply_text, "items": items, "usage": usage}
