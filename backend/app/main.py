from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.llm_service import ask_llm
from app.models import ChatRequest, ChatResponse, FilingResponse
from app.sec_service import get_filing_text, init_edgar_identity, maybe_get_comparison_context

load_dotenv()
init_edgar_identity()

app = FastAPI(title="SEC Copilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/filing", response_model=FilingResponse)
def filing(ticker: str, year: str, form_type: str) -> FilingResponse:
    try:
        bundle = get_filing_text(ticker=ticker, year=year, form_type=form_type)
        return FilingResponse(
            ticker=bundle.ticker,
            year=bundle.year,
            form_type=bundle.form_type,
            filing_text=bundle.text,
            cached=bundle.cached,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch filing: {exc}") from exc


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    try:
        additional_context = maybe_get_comparison_context(
            question=payload.question,
            ticker=payload.ticker,
            year=payload.year,
            active_form_type=payload.form_type,
        )
        answer, source_quote = ask_llm(
            question=payload.question,
            current_context=payload.current_context,
            additional_context=additional_context,
            selected_text=payload.selected_text or "",
        )
        return ChatResponse(answer=answer, source_quote=source_quote)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to answer question: {exc}") from exc
