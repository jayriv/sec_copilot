from pydantic import BaseModel


class FilingRequest(BaseModel):
    ticker: str
    year: str
    form_type: str


class ChatRequest(FilingRequest):
    question: str
    current_context: str
    selected_text: str | None = None


class FilingResponse(BaseModel):
    ticker: str
    year: str
    form_type: str
    filing_text: str
    filing_html: str | None = None
    cached: bool = False


class ChatResponse(BaseModel):
    answer: str
    source_quote: str | None = None
