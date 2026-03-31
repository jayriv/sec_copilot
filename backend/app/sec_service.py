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
    cached: bool = False


_FILING_CACHE: dict[tuple[str, str, str], tuple[float, FilingBundle]] = {}
_CACHE_TTL_SECONDS = 60 * 10


def init_edgar_identity() -> None:
    identity = os.getenv("EDGAR_IDENTITY")
    if not identity:
        raise RuntimeError("EDGAR_IDENTITY is required. Example: 'SEC Copilot your@email.com'")
    set_identity(identity)


def get_filing_text(ticker: str, year: str, form_type: str) -> FilingBundle:
    cache_key = (ticker.upper(), year, form_type.upper())
    cached = _FILING_CACHE.get(cache_key)
    if cached and (time() - cached[0]) < _CACHE_TTL_SECONDS:
        cached_bundle = cached[1]
        return FilingBundle(
            ticker=cached_bundle.ticker,
            year=cached_bundle.year,
            form_type=cached_bundle.form_type,
            text=cached_bundle.text,
            cached=True,
        )

    company = Company(ticker.upper())
    filings = company.get_filings(form=form_type.upper())
    filing = filings.latest()

    # Try to pull from full filing text, fallback to markdown extraction.
    text = ""
    if hasattr(filing, "text"):
        text = filing.text()
    if not text and hasattr(filing, "markdown"):
        text = filing.markdown()
    if not text and hasattr(filing, "html"):
        text = re.sub("<[^<]+?>", " ", filing.html())

    bundle = FilingBundle(ticker=ticker.upper(), year=year, form_type=form_type.upper(), text=text[:60000], cached=False)
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
