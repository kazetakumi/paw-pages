import csv
from dataclasses import dataclass
from pathlib import Path

PRICING_CSV = Path(__file__).parent / "models.csv"
EXCHANGE_RATES_CSV = Path(__file__).parent / "exchange_rates.csv"


@dataclass
class ModelPricing:
    input_per_1m: float
    cached_input_per_1m: float | None
    output_per_1m: float


def load_exchange_rates() -> dict[str, float]:
    """Load currency -> USD conversion rate table from exchange_rates.csv.
    Rates are approximate mid-market snapshots, not a live feed -- update
    the CSV periodically rather than trusting it for real money movement."""
    with EXCHANGE_RATES_CSV.open(newline="", encoding="utf-8") as f:
        return {row["currency"]: float(row["rate_per_usd"]) for row in csv.DictReader(f)}


_EXCHANGE_RATES = load_exchange_rates()
USD_TO_INR = _EXCHANGE_RATES["INR"]


@dataclass
class CostBreakdown:
    input_cost_usd: float
    output_cost_usd: float

    @property
    def total_cost_usd(self) -> float:
        return self.input_cost_usd + self.output_cost_usd

    @property
    def input_cost_inr(self) -> float:
        return self.input_cost_usd * USD_TO_INR

    @property
    def output_cost_inr(self) -> float:
        return self.output_cost_usd * USD_TO_INR

    @property
    def total_cost_inr(self) -> float:
        return self.total_cost_usd * USD_TO_INR


def load_pricing() -> dict[str, ModelPricing]:
    """Load the model -> $/1M-token rate table from models.csv."""
    with PRICING_CSV.open(newline="", encoding="utf-8") as f:
        return {
            row["model"]: ModelPricing(
                input_per_1m=float(row["input_per_1m"]),
                cached_input_per_1m=float(row["cached_input_per_1m"]) if row["cached_input_per_1m"] else None,
                output_per_1m=float(row["output_per_1m"]),
            )
            for row in csv.DictReader(f)
        }


_PRICING = load_pricing()


def calculate_cost(model: str, input_tokens: int, cached_tokens: int, output_tokens: int) -> CostBreakdown:
    """Cost breakdown for one call. Raises KeyError if `model` isn't in models.csv."""
    rates = _PRICING[model]
    billable_input_tokens = input_tokens - cached_tokens
    input_cost = billable_input_tokens / 1_000_000 * rates.input_per_1m
    if cached_tokens and rates.cached_input_per_1m is not None:
        input_cost += cached_tokens / 1_000_000 * rates.cached_input_per_1m
    output_cost = output_tokens / 1_000_000 * rates.output_per_1m
    return CostBreakdown(input_cost_usd=input_cost, output_cost_usd=output_cost)
