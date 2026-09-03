"""Tool-using agent loop for SEC Copilot.

Tools split by verb, not by document. Adding the eleventh textbook adds no
tool — course material stays one faceted search — and the filing tools work the
same whatever company is loaded. Five stable tools, regardless of corpus size:

    search_filing            keyword search over the filing already in context
    get_filing_section       pull one Item in full (Item 7, Item 1A, ...)
    search_course_material   the open-courseware index, optionally lens-filtered
    search_other_filing      another year/form for the same company
    calc                     arithmetic, because models are bad at it

Why a loop at all, beyond routing:

* `_smart_excerpt` in the single-shot path keeps the head and tail of a filing
  and drops the middle — often MD&A and the notes. Searching retrieves the
  relevant 8k tokens instead of the positionally lucky 80k.
* `maybe_get_comparison_context` decides via regex whether a question wants
  another filing. A tool call does that better and generalizes.
* Multi-hop questions ("is their revenue recognition aggressive?") need the
  concept, then the policy note, then a comparison. One shot cannot do that.

Serverless reality: vercel.json allows 60s, so the loop is bounded by both a
turn cap and a wall-clock budget, and always degrades to an answer rather than
a timeout. Any failure raises, and the caller falls back to single-shot.
"""

from __future__ import annotations

import ast
import json
import operator
import os
import time
from dataclasses import dataclass, field
from typing import Any, Iterator

from litellm import completion

from server import courseware, filing_index
from server.llm_service import DEFAULT_SYSTEM_PROMPT, resolve_model
from server.usage import Usage

AGENT_INSTRUCTIONS = """
You have tools. Use them instead of guessing, and instead of assuming the
filing text you were given is complete — you were given the filing's outline,
not its contents.

Work like an analyst:
1. For anything about this company, search or open the filing. Never state a
   company figure you have not seen in a tool result.
2. For a concept, method, or definition, search course material and cite it.
3. Compute ratios with `calc` rather than doing arithmetic in your head, and
   show the inputs.
4. Stop searching once you can answer. Two to four tool calls is normal.

If a tool returns nothing useful, say what you looked for and what was missing
rather than filling the gap from general knowledge.
""".strip()

OUTPUT_CONTRACT = "Output format:\nANSWER: <answer>\nSOURCE_QUOTE: <one short verbatim quote from the filing, or none>"


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def agent_enabled() -> bool:
    """On by default. Set COPILOT_AGENT_MODE=0 to force the single-shot path.

    Safe as a default because every failure mode falls back: a model without
    tool support, a provider error, or a bad loop all drop through to ask_llm
    in copilot_api.chat rather than costing the student an answer.
    """
    raw = os.getenv("COPILOT_AGENT_MODE", "").strip().lower()
    if not raw:
        return True
    return raw in ("1", "true", "yes", "on")


# ---------------------------------------------------------------------------
# tools
# ---------------------------------------------------------------------------


def tool_schemas(lens_names: list[str]) -> list[dict[str, Any]]:
    lens_desc = (
        "Optional lens filter. Prefer leaving it unset — relevance across the whole corpus "
        "routes better than a guess, and a concept often lives outside the chapter you would "
        "expect. Available: " + ", ".join(lens_names)
        if lens_names
        else "Optional lens filter."
    )
    return [
        {
            "type": "function",
            "function": {
                "name": "search_filing",
                "description": (
                    "Keyword search the current filing. Use for any company-specific fact, "
                    "figure, policy, or risk. Returns the best-matching passages with their Item section."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Terms as they would appear in the filing, e.g. 'deferred revenue' or 'goodwill impairment'.",
                        }
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_filing_section",
                "description": (
                    "Return one Item of the current filing in full. Use when the question is about a "
                    "whole section (Item 7 MD&A, Item 1A risk factors) rather than a specific fact."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "section": {"type": "string", "description": "e.g. 'Item 7' or 'Item 1A'."}
                    },
                    "required": ["section"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_course_material",
                "description": (
                    "Search open accounting textbooks for concepts, methods, definitions, and how to "
                    "interpret a measure. Returns passages with citations you must reproduce inline. "
                    "This is explanation, never this company's data."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "The concept to look up."},
                        "lens": {"type": "string", "description": lens_desc},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_other_filing",
                "description": (
                    "Search a different filing from the same company — another year, or another form "
                    "type — for comparisons and trends. Returns matching passages, not the whole document."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "year": {"type": "string", "description": "Calendar year, e.g. '2023'."},
                        "form_type": {"type": "string", "description": "e.g. '10-K', '10-Q'."},
                        "query": {"type": "string", "description": "What to look for in that filing."},
                    },
                    "required": ["year", "form_type", "query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "calc",
                "description": (
                    "Evaluate an arithmetic expression. Use for every ratio, growth rate, and margin "
                    "instead of computing mentally."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "e.g. '5000 / 2500' or '(482 - 431) / 431 * 100'.",
                        }
                    },
                    "required": ["expression"],
                },
            },
        },
    ]


_CALC_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
}


def _safe_eval(node: ast.AST) -> float:
    """Arithmetic only. Never eval() — this string comes from a model."""
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ValueError("only numbers are allowed")
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _safe_eval(node.operand)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp) and type(node.op) in _CALC_BINOPS:
        return _CALC_BINOPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    raise ValueError("unsupported expression")


def calc(expression: str) -> str:
    try:
        value = _safe_eval(ast.parse(expression, mode="eval"))
    except ZeroDivisionError:
        return "error: division by zero"
    except Exception:
        return "error: not a plain arithmetic expression"
    rounded = round(value, 6)
    return f"{expression} = {int(rounded) if rounded == int(rounded) else rounded}"


@dataclass
class AgentContext:
    ticker: str
    year: str
    form_type: str
    filing_text: str
    courseware_max_chars: int
    passages: list[Any] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)


def _run_tool(name: str, args: dict[str, Any], ctx: AgentContext) -> str:
    if name == "search_filing":
        hits = filing_index.get_index(ctx.filing_text).search(str(args.get("query", "")))
        if not hits:
            return "No matching passages in this filing."
        return json.dumps(hits, ensure_ascii=False)

    if name == "get_filing_section":
        index = filing_index.get_index(ctx.filing_text)
        body = index.section_text(str(args.get("section", "")), max_chars=20000)
        if not body:
            return f"Section not found. Available: {', '.join(index.outline()) or '(none detected)'}"
        return body

    if name == "search_course_material":
        if ctx.courseware_max_chars <= 0:
            return "Course material is disabled for this question."
        query = str(args.get("query", ""))
        lens = args.get("lens") or None
        found = courseware.retrieve(query, lens=lens)
        note = ""
        if not found and lens:
            # A confident lens guess can exclude the very chapter that answers the
            # question — "gross margin" under a statement-analysis lens misses the
            # merchandising chapter entirely. Retry unfiltered rather than burning
            # a turn on an empty result.
            found = courseware.retrieve(query)
            if found:
                note = f"\n\n(Nothing matched under lens '{lens}'; these are from the whole corpus.)"
        found = courseware.fit_passages(found, ctx.courseware_max_chars)
        if not found:
            return "Nothing relevant in the course material for that query."
        # Record for the response's citation chips.
        seen = {p.id for p in ctx.passages}
        ctx.passages.extend(p for p in found if p.id not in seen)
        # Lens guidance rides along with the passages so it lands exactly when
        # the model is about to reason with them — no mid-conversation system
        # message, which not every provider handles the same way.
        guidance = courseware.dominant_lens_guidance(found)
        body = courseware.format_passages(found) + note
        if guidance:
            body += f"\n\n---\nHow to reason with this material:\n{guidance}"
        return body

    if name == "search_other_filing":
        from server.sec_service import get_filing_text

        bundle = get_filing_text(
            ticker=ctx.ticker,
            year=str(args.get("year", "")),
            form_type=str(args.get("form_type", "")),
        )
        hits = filing_index.get_index(bundle.text).search(str(args.get("query", "")))
        if not hits:
            return f"No matching passages in the {args.get('year')} {args.get('form_type')}."
        return json.dumps(
            {"filing": f"{bundle.ticker} {bundle.year} {bundle.form_type}", "hits": hits},
            ensure_ascii=False,
        )

    if name == "calc":
        return calc(str(args.get("expression", "")))

    return f"Unknown tool: {name}"


# ---------------------------------------------------------------------------
# loop
# ---------------------------------------------------------------------------


def run_agent_events(
    question: str,
    *,
    ticker: str,
    year: str,
    form_type: str,
    filing_text: str,
    selected_text: str = "",
    llm_model: str | None = None,
    system_prompt: str | None = None,
    courseware_max_chars: int = 12000,
    usage: Usage | None = None,
) -> Iterator[dict[str, Any]]:
    """Run the loop, yielding progress events as they happen.

    Yields {"type": "tool_start"|"tool_end", ...} per tool call and exactly one
    final {"type": "result", ...}. Streaming exists so a student sees what the
    copilot is doing during the seconds it spends searching, rather than an
    undifferentiated spinner. `run_agent` below wraps this for callers that
    just want the answer.
    """
    model = resolve_model(llm_model)
    # The last turn is reserved for answering with tools withheld, so a cap of 1
    # would leave zero turns to actually gather anything.
    max_turns = max(2, _env_int("COPILOT_AGENT_MAX_TURNS", 5))
    budget = _env_float("COPILOT_AGENT_TIME_BUDGET_S", 40.0)
    started = time.monotonic()

    ctx = AgentContext(
        ticker=ticker,
        year=year,
        form_type=form_type,
        filing_text=filing_text,
        courseware_max_chars=courseware_max_chars,
    )

    index = filing_index.get_index(filing_text)
    outline = index.outline()
    tools = tool_schemas(sorted(courseware.lenses().keys()))

    base_prompt = (system_prompt or "").strip() or DEFAULT_SYSTEM_PROMPT
    system = f"{base_prompt}\n\n{AGENT_INSTRUCTIONS}"

    user = (
        f"Filing: {ticker} {year} {form_type}\n"
        f"Sections available: {', '.join(outline) if outline else '(no Item headings detected)'}\n\n"
        f"Question:\n{question}\n\n"
        f"Selected text from the filing:\n{selected_text or '(none)'}\n\n"
        f"{OUTPUT_CONTRACT}"
    )

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    content = ""
    for turn in range(max_turns):
        # >= not >: time.monotonic() is ~15.6ms-granular on Windows, so a warm
        # index can leave elapsed at exactly 0.0 and let a zero budget through.
        out_of_time = (time.monotonic() - started) >= budget
        last_turn = turn == max_turns - 1
        if out_of_time or last_turn:
            # Final pass with tools withheld, so the loop always ends in an
            # answer rather than another tool call we have no budget to run.
            messages.append(
                {
                    "role": "user",
                    "content": "Answer now from what you have gathered. Do not request more tools. "
                    + OUTPUT_CONTRACT,
                }
            )
            response = completion(model=model, messages=messages, temperature=0.1)
            if usage is not None:
                usage.add(response, model)
            content = response.choices[0].message.content or ""
            break

        response = completion(
            model=model, messages=messages, tools=tools, tool_choice="auto", temperature=0.1
        )
        if usage is not None:
            usage.add(response, model)
        message = response.choices[0].message
        tool_calls = getattr(message, "tool_calls", None) or []

        if not tool_calls:
            content = message.content or ""
            break

        messages.append(
            {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments,
                        },
                    }
                    for call in tool_calls
                ],
            }
        )

        for call in tool_calls:
            name = call.function.name
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            yield {"type": "tool_start", "tool": name, "args": args}
            try:
                result = _run_tool(name, args, ctx)
            except Exception as exc:  # a broken tool must not kill the turn
                result = f"Tool error: {exc}"
            yield {"type": "tool_end", "tool": name, "args": args, "chars": len(result)}
            ctx.trace.append(
                {
                    "tool": name,
                    "args": args,
                    "chars": len(result),
                    "preview": result[:160],
                }
            )
            messages.append(
                {"role": "tool", "tool_call_id": call.id, "name": name, "content": result}
            )

    answer = content
    source_quote = ""
    if "SOURCE_QUOTE:" in content:
        head, _, tail = content.partition("SOURCE_QUOTE:")
        answer = head.replace("ANSWER:", "").strip()
        source_quote = tail.strip()
    else:
        answer = content.replace("ANSWER:", "").strip()

    yield {
        "type": "result",
        "answer": answer,
        "source_quote": "" if source_quote.lower() == "none" else source_quote,
        "passages": ctx.passages,
        "trace": ctx.trace,
    }


def run_agent(**kwargs: Any) -> tuple[str, str, list[Any], list[dict[str, Any]]]:
    """Non-streaming wrapper: (answer, source_quote, courseware_passages, trace)."""
    result: dict[str, Any] = {}
    for event in run_agent_events(**kwargs):
        if event.get("type") == "result":
            result = event
    return (
        result.get("answer", ""),
        result.get("source_quote", ""),
        result.get("passages", []),
        result.get("trace", []),
    )
