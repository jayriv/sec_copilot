import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import logging

from server import agent, courseware
from server.llm_service import ask_llm, courseware_char_cap
from server.models import (
    AgentStep,
    ChatRequest,
    ChatResponse,
    CoursewareCitation,
    FilingAnchorModel,
    FilingFragmentResponse,
    FilingResponse,
)

logger = logging.getLogger(__name__)
from server.path_normalize import NormalizeApiPathMiddleware
from server.sec_service import get_filing_fragment_html, get_filing_text, maybe_get_comparison_context, prepare_filing_display

load_dotenv()

app = FastAPI(
    title="SEC Copilot API",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(NormalizeApiPathMiddleware)


@app.get("/health")
def health() -> dict[str, object]:
    """Backend liveness; does not call SEC. EDGAR_IDENTITY is required for /filing and /chat."""
    return {
        "status": "ok",
        "edgar_identity_configured": bool(os.getenv("EDGAR_IDENTITY", "").strip()),
        "courseware": courseware.status(),
    }


@app.get("/filing", response_model=FilingResponse)
def filing(ticker: str, year: str, form_type: str) -> FilingResponse:
    try:
        bundle = get_filing_text(ticker=ticker, year=year, form_type=form_type)
        display_html, partial, anchors = prepare_filing_display(bundle)
        anchor_models = [FilingAnchorModel(**a) for a in anchors] if anchors else None
        return FilingResponse(
            ticker=bundle.ticker,
            year=bundle.year,
            form_type=bundle.form_type,
            filing_text=bundle.text,
            filing_html=display_html,
            filing_html_partial=partial,
            filing_anchors=anchor_models,
            cached=bundle.cached,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch filing: {exc}") from exc


@app.get("/filing/fragment", response_model=FilingFragmentResponse)
def filing_fragment(ticker: str, year: str, form_type: str, fragment: str) -> FilingFragmentResponse:
    try:
        html = get_filing_fragment_html(ticker=ticker, year=year, form_type=form_type, fragment=fragment)
        if not html:
            raise HTTPException(
                status_code=404,
                detail="Fragment not found or filing has no HTML.",
            )
        return FilingFragmentResponse(html=html)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load section: {exc}") from exc


def _chat_response(
    answer: str,
    source_quote: str,
    passages: list,
    *,
    mode: str,
    trace: list[dict] | None = None,
) -> ChatResponse:
    return ChatResponse(
        answer=answer,
        source_quote=source_quote,
        citations=[
            CoursewareCitation(
                id=p.id,
                citation=p.citation,
                heading_path=p.heading_path,
                source_id=p.source_id,
                lens=p.lens,
                score=round(p.score, 4),
            )
            for p in passages
        ],
        lenses=[label for _, label in courseware.dominant_lenses(passages)],
        mode=mode,  # type: ignore[arg-type]
        trace=[AgentStep(**step) for step in (trace or [])],
    )


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    try:
        sp = (payload.system_prompt or "").strip() or None
        courseware_cap = courseware_char_cap(payload.courseware_max_chars)

        if agent.agent_enabled():
            try:
                answer, source_quote, passages, trace = agent.run_agent(
                    question=payload.question,
                    ticker=payload.ticker,
                    year=payload.year,
                    form_type=payload.form_type,
                    filing_text=payload.current_context,
                    selected_text=payload.selected_text or "",
                    llm_model=payload.llm_model,
                    system_prompt=sp,
                    courseware_max_chars=courseware_cap,
                )
                return _chat_response(answer, source_quote, passages, mode="agent", trace=trace)
            except Exception:
                # A model without tool support, a provider hiccup, or a bad tool
                # loop must not cost the student an answer. Fall through.
                logger.warning("Agent loop failed; falling back to single-shot.", exc_info=True)

        additional_context = maybe_get_comparison_context(
            question=payload.question,
            ticker=payload.ticker,
            year=payload.year,
            active_form_type=payload.form_type,
        )
        passages = []
        if courseware_cap > 0:
            # The selection is the strongest retrieval signal the app has: a student
            # highlighting "deferred revenue" in a 10-K should surface the textbook
            # section on revenue recognition. Retrieval must never break chat, so a
            # failure here degrades to a filing-only answer.
            query = " ".join(filter(None, [payload.question, payload.selected_text or ""])).strip()
            try:
                passages = courseware.fit_passages(courseware.retrieve(query), courseware_cap)
            except Exception:
                passages = []

        answer, source_quote = ask_llm(
            question=payload.question,
            current_context=payload.current_context,
            additional_context=additional_context,
            selected_text=payload.selected_text or "",
            llm_model=payload.llm_model,
            current_context_max_chars=payload.current_context_max_chars,
            additional_context_max_chars=payload.additional_context_max_chars,
            system_prompt_override=sp,
            courseware_context=courseware.format_passages(passages),
            lens_guidance=courseware.dominant_lens_guidance(passages),
        )
        return _chat_response(answer, source_quote, passages, mode="single")
    except ValueError as exc:
        msg = str(exc).strip() or repr(exc)
        if "COPILOT_ALLOW_CLIENT_SYSTEM_PROMPT" in msg:
            raise HTTPException(status_code=403, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc
    except Exception as exc:
        msg = str(exc).strip() or repr(exc)
        if ("api key" in msg.lower()) or ("invalid" in msg.lower() and "key" in msg.lower()):
            msg = (
                f"{msg} — Set the matching provider API key in Vercel "
                "(e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY)."
            )
        raise HTTPException(status_code=500, detail=f"Failed to answer question: {msg}") from exc
