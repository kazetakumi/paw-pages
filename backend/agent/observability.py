import json
from datetime import datetime, timezone
from pathlib import Path

from .pricing.loader import USD_TO_INR, calculate_cost

LOG_PATH = Path(__file__).parent / "logs" / "llm_usage.jsonl"


class Logger:

    def __init__(self, log_path: Path = LOG_PATH):
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.session_input_cost_usd = 0.0
        self.session_output_cost_usd = 0.0
        self.session_has_unpriced_calls = False

    @property
    def session_total_cost_usd(self) -> float:
        return self.session_input_cost_usd + self.session_output_cost_usd

    @property
    def session_input_cost_inr(self) -> float:
        return self.session_input_cost_usd * USD_TO_INR

    @property
    def session_output_cost_inr(self) -> float:
        return self.session_output_cost_usd * USD_TO_INR

    @property
    def session_total_cost_inr(self) -> float:
        return self.session_total_cost_usd * USD_TO_INR

    def log_llm_call(self, step: str, model: str, usage, latency_ms: float) -> None:
        input_tokens = usage.input_tokens
        cached_tokens = usage.input_tokens_details.cached_tokens
        output_tokens = usage.output_tokens

        try:
            cost = calculate_cost(model, input_tokens, cached_tokens, output_tokens)
        except KeyError:
            # Model not in pricing/models.csv yet (e.g. a brand-new release) --
            # log the call anyway rather than breaking the actual LLM call over it.
            cost = None
            self.session_has_unpriced_calls = True
        else:
            self.session_input_cost_usd += cost.input_cost_usd
            self.session_output_cost_usd += cost.output_cost_usd

        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "step": step,
            "model": model,
            "input_tokens": input_tokens,
            "cached_tokens": cached_tokens,
            "output_tokens": output_tokens,
            "total_tokens": usage.total_tokens,
            "input_cost_usd": round(cost.input_cost_usd, 6) if cost else None,
            "output_cost_usd": round(cost.output_cost_usd, 6) if cost else None,
            "cost_usd": round(cost.total_cost_usd, 6) if cost else None,
            "input_cost_inr": round(cost.input_cost_inr, 4) if cost else None,
            "output_cost_inr": round(cost.output_cost_inr, 4) if cost else None,
            "cost_inr": round(cost.total_cost_inr, 4) if cost else None,
            "latency_ms": round(latency_ms, 1),
        }
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
