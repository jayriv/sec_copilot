from typing import Literal

from pydantic import BaseModel


class FilingAnchorModel(BaseModel):
    id: str
    label: str
    level: int
    source: Literal["toc", "heading", "target", "item"]


class FilingRequest(BaseModel):
    ticker: str
    year: str
    form_type: str


class ChatRequest(FilingRequest):
    question: str
    current_context: str
    selected_text: str | None = None
    """LiteLLM model id, e.g. openai/gpt-4, anthropic/claude-3-5-sonnet-20241022."""
    llm_model: str | None = None
    """Per-request cap for main filing excerpt; server clamps to configured min/max."""
    current_context_max_chars: int | None = None
    """Per-request cap for comparison / additional filing text."""
    additional_context_max_chars: int | None = None
    """When server sets COPILOT_ALLOW_CLIENT_SYSTEM_PROMPT=1, overrides default system prompt."""
    system_prompt: str | None = None


class FilingResponse(BaseModel):
    ticker: str
    year: str
    form_type: str
    filing_text: str
    filing_html: str | None = None
    """When lazy HTML is on, this is only the leading slice; use filing_fragment for the rest."""
    filing_html_partial: bool = False
    filing_anchors: list[FilingAnchorModel] | None = None
    cached: bool = False


class FilingFragmentResponse(BaseModel):
    html: str


class ChatResponse(BaseModel):
    answer: str
    source_quote: str | None = None
