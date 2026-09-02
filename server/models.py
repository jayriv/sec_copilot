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


class CoursewareCitation(BaseModel):
    """One open-courseware passage sent with the question."""

    id: str
    citation: str
    """e.g. 'BAP, Ch. 5, pp. 205-206'"""
    heading_path: str
    source_id: str
    lens: list[str] = []
    score: float


class ChatRequest(FilingRequest):
    question: str
    current_context: str
    selected_text: str | None = None
    """LiteLLM model id, e.g. anthropic/claude-sonnet-5, openai/gpt-5.4."""
    llm_model: str | None = None
    """Per-request cap for retrieved course material; 0 disables courseware for this question."""
    courseware_max_chars: int | None = None
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


class AgentStep(BaseModel):
    """One tool call the agent made, for the UI's reasoning trail."""

    tool: str
    args: dict = {}
    chars: int = 0
    preview: str = ""


class ChatResponse(BaseModel):
    answer: str
    source_quote: str | None = None
    """Course material sent with this question, for attribution in the UI."""
    citations: list[CoursewareCitation] = []
    """Lens labels whose guidance shaped the answer, e.g. ['Financial statement analysis']."""
    lenses: list[str] = []
    """'agent' when the tool loop ran, 'single' for the one-shot path."""
    mode: Literal["agent", "single"] = "single"
    """Tool calls made, in order. Empty in single-shot mode."""
    trace: list[AgentStep] = []
