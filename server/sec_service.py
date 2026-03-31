import os
import re
from dataclasses import dataclass
from time import time

from edgar import Company, set_identity


@dataclass
class FilingBundle:
    ticker: str
    year: str
    form_type: str
    text: str
    html: str | None = None
    cached: bool = False


_HTML_MAX_CHARS = 350_000
_TEXT_MAX_CHARS = 120_000


def _strip_html_to_text(raw_html: str) -> str:
    without_scripts = re.sub(r"<script[^>]*>[\s\S]*?</script>", " ", raw_html, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", without_scripts)).strip()


_FILING_CACHE: dict[tuple[str, str, str], tuple[float, FilingBundle]] = {}
_CACHE_TTL_SECONDS = 60 * 10
_EDGAR_CONFIGURED = False


def init_edgar_identity() -> None:
    identity = os.getenv("EDGAR_IDENTITY")
    if not identity:
        raise RuntimeError("EDGAR_IDENTITY is required. Example: 'SEC Copilot your@email.com'")
    set_identity(identity)


def ensure_edgar_identity() -> None:
    global _EDGAR_CONFIGURED
    if _EDGAR_CONFIGURED:
        return
    init_edgar_identity()
    _EDGAR_CONFIGURED = True


def get_filing_text(ticker: str, year: str, form_type: str) -> FilingBundle:
    ensure_edgar_identity()
    cache_key = (ticker.upper(), year, form_type.upper())
    cached = _FILING_CACHE.get(cache_key)
    if cached and (time() - cached[0]) < _CACHE_TTL_SECONDS:
        cached_bundle = cached[1]
        return FilingBundle(
            ticker=cached_bundle.ticker,
            year=cached_bundle.year,
            form_type=cached_bundle.form_type,
            text=cached_bundle.text,
            html=cached_bundle.html,
            cached=True,
        )

    company = Company(ticker.upper())
    filings = company.get_filings(form=form_type.upper())
    filing = filings.latest()

    html_content: str | None = None
    if hasattr(filing, "html"):
        try:
            raw_html = filing.html()
            if isinstance(raw_html, str) and raw_html.strip():
                html_content = raw_html[:_HTML_MAX_CHARS]
        except Exception:
            html_content = None

    text = ""
    if hasattr(filing, "text"):
        try:
            text = (filing.text() or "").strip()
        except Exception:
            text = ""
    if not text and html_content:
        text = _strip_html_to_text(html_content)
    if not text and hasattr(filing, "markdown"):
        try:
            text = (filing.markdown() or "").strip()
        except Exception:
            pass

    bundle = FilingBundle(
        ticker=ticker.upper(),
        year=year,
        form_type=form_type.upper(),
        text=text[:_TEXT_MAX_CHARS],
        html=html_content,
        cached=False,
    )
    _FILING_CACHE[cache_key] = (time(), bundle)
    return bundle


def _extract_comparison_form(question: str) -> str:
    lowered = question.lower()
    patterns = [
        r"\b10[\s\-]?k\b",
        r"\b10[\s\-]?q\b",
        r"\b8[\s\-]?k\b",
        r"\b20[\s\-]?f\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, lowered)
        if match:
            return match.group(0).replace(" ", "").upper()
    return ""


def _extract_comparison_year(question: str, default_year: str) -> str:
    lowered = question.lower()
    year_match = re.search(r"\b(19|20)\d{2}\b", lowered)
    if year_match:
        return year_match.group(0)
    if "previous year" in lowered or "prior year" in lowered or "last year" in lowered:
        try:
            return str(int(default_year) - 1)
        except ValueError:
            return default_year
    return default_year


def maybe_get_comparison_context(question: str, ticker: str, year: str, active_form_type: str) -> str:
    lowered = question.lower()
    compare_markers = ["compare", "comparison", "versus", "vs", "relative to", "how does this compare"]
    if not any(marker in lowered for marker in compare_markers):
        return ""

    comparison_form = _extract_comparison_form(question)
    if not comparison_form:
        return ""

    normalized_active = active_form_type.upper().replace(" ", "")
    if comparison_form == normalized_active:
        return ""

    comparison_year = _extract_comparison_year(question, year)
    try:
        bundle = get_filing_text(ticker=ticker, year=comparison_year, form_type=comparison_form)
    except Exception:
        return ""
    return f"Comparison context from {comparison_form} ({comparison_year}):\n{bundle.text[:20000]}"
