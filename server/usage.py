"""Per-request token and cost accounting.

Exists to answer one question with data instead of arithmetic: is prompt
caching worth implementing here? The agent loop makes several API calls per
student question, so cost has to be tallied across a whole question, not per
call. `cache_read`/`cache_write` stay at zero until caching is actually added —
that is the point, they are the before/after measurement.

Pricing comes from litellm's own tables rather than a hardcoded one here, so it
covers every provider in the picker and does not drift as prices change. When
litellm cannot price a model, cost is None and token counts still stand.

Nothing here can fail a request: every extraction is defensive, because usage
is diagnostics, not the product.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


def _int(value: object) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


@dataclass
class Usage:
    """Accumulates across every model call made for one student question."""

    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0
    """False once any call could not be priced, so a partial total is never shown as complete."""
    cost_complete: bool = True
    models: list[str] = field(default_factory=list)

    def add(self, response: object, model: str = "") -> None:
        self.calls += 1
        if model and model not in self.models:
            self.models.append(model)

        usage = getattr(response, "usage", None)
        if usage is not None:
            self.input_tokens += _int(getattr(usage, "prompt_tokens", 0))
            self.output_tokens += _int(getattr(usage, "completion_tokens", 0))

            # Anthropic reports cache hits as its own fields; OpenAI nests a
            # cached_tokens count under prompt_tokens_details. Read both.
            self.cache_read_tokens += _int(getattr(usage, "cache_read_input_tokens", 0))
            self.cache_write_tokens += _int(getattr(usage, "cache_creation_input_tokens", 0))
            details = getattr(usage, "prompt_tokens_details", None)
            if details is not None:
                self.cache_read_tokens += _int(getattr(details, "cached_tokens", 0))

        try:
            from litellm import completion_cost

            cost = completion_cost(completion_response=response)
            if cost is None:
                self.cost_complete = False
            else:
                self.cost_usd += float(cost)
        except Exception:
            # Unknown model, missing price table, malformed response -- never fatal.
            self.cost_complete = False

    def as_dict(self) -> dict[str, object]:
        return {
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "cost_usd": round(self.cost_usd, 6) if self.cost_complete else None,
        }

    def log(self, *, mode: str, seconds: float, tool_calls: int = 0) -> None:
        """One structured line per question — greppable in Vercel function logs."""
        cost = f"${self.cost_usd:.5f}" if self.cost_complete else "unpriced"
        # Share of input served from cache: the number to watch if caching is added.
        billed_input = self.input_tokens or 1
        hit_rate = self.cache_read_tokens / billed_input
        logger.info(
            "chat_usage mode=%s model=%s calls=%d tools=%d in=%d out=%d "
            "cache_read=%d cache_write=%d cache_hit=%.0f%% cost=%s latency=%.1fs",
            mode,
            ",".join(self.models) or "?",
            self.calls,
            tool_calls,
            self.input_tokens,
            self.output_tokens,
            self.cache_read_tokens,
            self.cache_write_tokens,
            hit_rate * 100,
            cost,
            seconds,
        )
