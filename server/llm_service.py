import os

from litellm import completion

DEFAULT_SYSTEM_PROMPT = (
    "You are SEC Copilot. Answer using only the excerpts below. "
    "When 'Additional context' contains another SEC filing or year, use it for comparisons or questions about that period. "
    "If an answer appears in 'Current filing context', state it and quote it; do not claim numbers are absent when they appear there. "
    "If you cannot find a figure in the excerpts (including after truncation), say it is not in the provided excerpt—not that the filing has no such data. "
    "Return one short verbatim source quote from the current filing when possible."
)

_CURRENT_MIN = int(os.getenv("COPILOT_CURRENT_CONTEXT_CHARS_MIN", "2000"))
_CURRENT_MAX = int(os.getenv("COPILOT_CURRENT_CONTEXT_CHARS_MAX", "120000"))
_ADDITIONAL_MIN = int(os.getenv("COPILOT_ADDITIONAL_CONTEXT_CHARS_MIN", "0"))
_ADDITIONAL_MAX = int(os.getenv("COPILOT_ADDITIONAL_CONTEXT_CHARS_MAX", "80000"))


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def _smart_excerpt(text: str, max_chars: int) -> str:
    """Prefer head + tail so balance sheets / MD&A later in the filing can appear in context."""
    if len(text) <= max_chars:
        return text
    head = int(max_chars * 0.62)
    tail = max_chars - head - 120
    if tail < 2000:
        return text[:max_chars]
    return (
        text[:head]
        + "\n\n[... middle of filing omitted for length ...]\n\n"
        + text[-tail:]
    )


def ask_llm(
    question: str,
    current_context: str,
    additional_context: str = "",
    selected_text: str = "",
    llm_model: str | None = None,
    *,
    current_context_max_chars: int | None = None,
    additional_context_max_chars: int | None = None,
    system_prompt_override: str | None = None,
) -> tuple[str, str]:
    model = (llm_model or "").strip() or os.getenv("LITELLM_MODEL", "openai/gpt-4").strip()

    base_current = int(os.getenv("COPILOT_CURRENT_CONTEXT_CHARS", "80000"))
    base_additional = int(os.getenv("COPILOT_ADDITIONAL_CONTEXT_CHARS", "60000"))

    current_max = _clamp(
        current_context_max_chars if current_context_max_chars is not None else base_current,
        _CURRENT_MIN,
        _CURRENT_MAX,
    )
    additional_max = _clamp(
        additional_context_max_chars if additional_context_max_chars is not None else base_additional,
        _ADDITIONAL_MIN,
        _ADDITIONAL_MAX,
    )

    current_excerpt = _smart_excerpt(current_context, current_max)
    additional_excerpt = additional_context[:additional_max] if additional_context else ""

    allow_custom = os.getenv("COPILOT_ALLOW_CLIENT_SYSTEM_PROMPT", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    if system_prompt_override is not None and str(system_prompt_override).strip():
        if not allow_custom:
            raise ValueError(
                "Custom system prompts from the client are disabled. Set COPILOT_ALLOW_CLIENT_SYSTEM_PROMPT=1 on the server."
            )
        system_prompt = str(system_prompt_override).strip()
    else:
        system_prompt = os.getenv("COPILOT_SYSTEM_PROMPT", "").strip() or DEFAULT_SYSTEM_PROMPT
    user_prompt = (
        f"Question:\n{question}\n\n"
        f"Selected text:\n{selected_text or '(none)'}\n\n"
        f"Current filing context:\n{current_excerpt}\n\n"
        f"Additional context:\n{additional_excerpt or '(none)'}\n\n"
        "Output format:\nANSWER: <answer>\nSOURCE_QUOTE: <quote or none>"
    )

    response = completion(
        model=model,
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        temperature=0.1,
    )
    content = response.choices[0].message.content or ""
    answer = content
    source_quote = ""
    if "SOURCE_QUOTE:" in content:
        parts = content.split("SOURCE_QUOTE:")
        answer = parts[0].replace("ANSWER:", "").strip()
        source_quote = parts[1].strip()
    return answer, ("" if source_quote.lower() == "none" else source_quote)
