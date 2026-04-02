import os

from litellm import completion


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
) -> tuple[str, str]:
    model = os.getenv("LITELLM_MODEL", "gpt-4")

    current_max = int(os.getenv("COPILOT_CURRENT_CONTEXT_CHARS", "80000"))
    additional_max = int(os.getenv("COPILOT_ADDITIONAL_CONTEXT_CHARS", "60000"))

    current_excerpt = _smart_excerpt(current_context, current_max)
    additional_excerpt = additional_context[:additional_max] if additional_context else ""

    system_prompt = (
        "You are SEC Copilot. Answer using only the excerpts below. "
        "When 'Additional context' contains another SEC filing or year, use it for comparisons or questions about that period. "
        "If an answer appears in 'Current filing context', state it and quote it; do not claim numbers are absent when they appear there. "
        "If you cannot find a figure in the excerpts (including after truncation), say it is not in the provided excerpt—not that the filing has no such data. "
        "Return one short verbatim source quote from the current filing when possible."
    )
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
