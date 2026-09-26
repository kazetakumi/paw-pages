"""Bridges backend/api to backend/agent, which sits alongside it rather than
inside it and isn't an installed dependency -- adding backend/ to sys.path
once here so `agent.*` resolves is cheaper than a full uv workspace for a
two-file module. Every router that needs the chat loop gets its LLM from
get_llm() here instead of re-adding the path itself.
"""

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from agent.llm import DEFAULT_MODEL, LLM  # noqa: E402
from agent.pricing.loader import calculate_cost  # noqa: E402
from openai import OpenAI  # noqa: E402

from .config import get_settings

# Every turn is charged in credits priced from models.csv. Raises KeyError at
# startup if DEFAULT_MODEL isn't in there, rather than mid-turn after the
# model has already answered.
calculate_cost(DEFAULT_MODEL, 0, 0, 0)

_llm: LLM | None = None


def get_llm() -> LLM:
    """Built lazily, once, from the same settings every other route reads --
    not agent.llm.get_client(), which reads OPENAI_API_KEY straight off the
    environment and would miss a key that only lives in .env."""
    global _llm
    if _llm is None:
        settings = get_settings()
        _llm = LLM(OpenAI(api_key=settings.openai_api_key), DEFAULT_MODEL)
    return _llm
