import os

from litellm import completion


def ask_llm(
    question: str,
    current_context: str,
    additional_context: str = "",
    selected_text: str = "",
) -> tuple[str, str]:
    model = os.getenv("LITELLM_MODEL", "gpt-4")

    system_prompt = (
        "You are SEC Copilot. Answer using filing context only. "
        "If comparison context exists, explain similarities and differences clearly. "
        "Return one short verbatim source quote from the current filing when possible."
    )
    user_prompt = (
        f"Question:\n{question}\n\n"
        f"Selected text:\n{selected_text or '(none)'}\n\n"
        f"Current filing context:\n{current_context[:22000]}\n\n"
        f"Additional context:\n{additional_context[:12000] or '(none)'}\n\n"
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
