import time

from openai import OpenAI

from .observability import Logger

logger = Logger()

DEFAULT_MODEL = "gpt-5.6-luna"

_client: OpenAI | None = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()  # constructed lazily so importing this module never needs a key
    return _client


class LLM:

    def __init__(self, client: OpenAI, model: str):
        self.client = client
        self.model = model

    def run(self, messages: list, tools: list, step: str | None = None):
        """One blocking completion. `step` overrides the log label — left
        None, the call logs as "decide" or "reply" depending on whether
        tool calls came back; a subagent passes its own label (e.g.
        "subagent.compose") so main-loop and subagent calls stay
        distinguishable in the log."""
        s = time.time()
        response = self.client.responses.create(model=self.model, input=messages, tools=tools)
        e = time.time()
        tool_calls = [item for item in response.output if item.type == "function_call"]
        logger.log_llm_call(
            step=step or ("decide" if tool_calls else "reply"),
            model=self.model,
            usage=response.usage,
            latency_ms=(e - s) * 1000,
        )

        text_response = response.output_text  # SDK's own aggregate — "" when there's none
        return text_response, tool_calls

    def run_structured(self, messages: list, output_model, step: str = "structured"):
        """One structured completion: decoding is constrained to output_model's
        JSON schema, so the return value is a validated instance of output_model —
        never free text, never malformed. Deliberately has no tools parameter: this
        is the subagent primitive (one call in, one object out); run() is the agent
        primitive. That asymmetry is a design constraint, not a gap."""
        s = time.time()
        response = self.client.responses.parse(
            model=self.model, input=messages, text_format=output_model,
        )
        e = time.time()
        logger.log_llm_call(step=step, model=self.model, usage=response.usage, latency_ms=(e - s) * 1000)
        if response.output_parsed is None:
            raise ValueError("structured call returned no parsed output (model refusal or truncation)")
        return response.output_parsed

    def stream(self, messages: list, tools: list, step: str | None = None):
        """Same call as run(), but as a stream: yields {"type": "text.delta", "text": ...}
        as tokens arrive, then exactly one final {"type": "done", "text_response": ..., "tool_calls": ...,
        "usage": ...} carrying what run() used to return in one shot, plus the call's token
        usage for the caller to charge. The final event is how a generator hands back a
        "return value" — there's no other channel once you're yielding."""
        s = time.time()
        with self.client.responses.stream(model=self.model, input=messages, tools=tools) as stream:
            for event in stream:
                if event.type == "response.output_text.delta":
                    yield {"type": "text.delta", "text": event.delta}
            response = stream.get_final_response()
        e = time.time()

        tool_calls = [item for item in response.output if item.type == "function_call"]
        logger.log_llm_call(
            step=step or ("decide" if tool_calls else "reply"),
            model=self.model,
            usage=response.usage,
            latency_ms=(e - s) * 1000,
        )

        text_response = response.output_text
        yield {"type": "done", "text_response": text_response, "tool_calls": tool_calls, "usage": response.usage}
