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


def _pick_filing(company: Company, form_type: str, calendar_year: str) -> object:
    """Choose a filing whose SEC filing_date falls in calendar_year when possible."""
    filings = company.get_filings(form=form_type.upper())
    try:
        y = int(calendar_year)
    except ValueError:
        return filings.latest()
    try:
        filtered = filings.filter(filing_date=f"{y}-01-01:{y}-12-31")
        if len(filtered) > 0:
            return filtered.latest()
    except Exception:
        pass
    try:
        for candidate in filings.head(120):
            fd = getattr(candidate, "filing_date", None)
            if fd is not None and getattr(fd, "year", None) == y:
                return candidate
    except Exception:
        pass
    return filings.latest()


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
    filing = _pick_filing(company, form_type, year)

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


def _normalize_form_label(form: str) -> str:
    return form.upper().replace(" ", "").replace("-", "")


def _extract_comparison_form(question: str) -> str:
    lowered = question.lower()
    patterns = [
        (r"\b10[\s\-]?k\b", "10-K"),
        (r"\b10[\s\-]?q\b", "10-Q"),
        (r"\b8[\s\-]?k\b", "8-K"),
        (r"\b20[\s\-]?f\b", "20-F"),
    ]
    for pattern, canonical in patterns:
        if re.search(pattern, lowered):
            return canonical
    return ""


def _wants_additional_filing(question: str) -> bool:
    lowered = question.lower()
    if re.search(r"\b(19|20)\d{2}\b", lowered):
        return True
    if re.search(r"\bhow (does|did|has|have)\b.{0,80}\bcompare\b", lowered):
        return True
    phrases = (
        "compare",
        "comparison",
        "versus",
        " vs ",
        "relative to",
        "prior year",
        "last year",
        "year-ago",
        "year ago",
        "earlier filing",
        "historical filing",
        "past filing",
        "past 10",
        "earlier 10",
        "previous 10",
        "previous filing",
        "last 10",
        "year over year",
        "yoy",
    )
    return any(p in lowered for p in phrases)


def _extract_comparison_year_smart(question: str, display_year: str, same_form: bool) -> str:
    lowered = question.lower()
    year_match = re.search(r"\b(19|20)\d{2}\b", lowered)
    if year_match:
        return year_match.group(0)
    if "previous year" in lowered or "prior year" in lowered or "last year" in lowered:
        try:
            return str(int(display_year) - 1)
        except ValueError:
            return display_year
    if same_form and any(
        token in lowered for token in ("previous", "prior", "earlier", "historical", "past", "older")
    ):
        try:
            return str(int(display_year) - 1)
        except ValueError:
            return display_year
    return display_year


def maybe_get_comparison_context(question: str, ticker: str, year: str, active_form_type: str) -> str:
    if not _wants_additional_filing(question):
        return ""

    normalized_active = _normalize_form_label(active_form_type)
    comparison_raw = _extract_comparison_form(question) or active_form_type
    comparison_form = comparison_raw
    same_form = _normalize_form_label(comparison_raw) == normalized_active

    comparison_year = _extract_comparison_year_smart(question, year, same_form=same_form)

    try:
        active_y = int(year)
        comp_y = int(comparison_year)
    except ValueError:
        return ""

    if same_form and comp_y >= active_y:
        comparison_year = str(active_y - 1)
        try:
            comp_y = int(comparison_year)
        except ValueError:
            return ""

    if same_form and comp_y == active_y:
        return ""

    try:
        bundle = get_filing_text(ticker=ticker, year=comparison_year, form_type=comparison_form)
    except Exception:
        return ""

    label = f"Additional SEC filing context ({comparison_form}, filing_date calendar year ~{comparison_year})"
    return f"{label}:\n{bundle.text[:25000]}"
