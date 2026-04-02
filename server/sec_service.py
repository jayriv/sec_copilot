import os
import re
from dataclasses import dataclass
from time import time

from edgar import Company, set_identity

from server.filing_anchors import build_filing_anchors, extract_fragment_html


@dataclass
class FilingBundle:
    ticker: str
    year: str
    form_type: str
    text: str
    html: str | None = None
    anchors: list[dict] | None = None
    cached: bool = False


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return max(1, int(raw.strip()))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


# 10-K HTML often exceeds 1–3 MB; a 350k cap cut off later Items (e.g. Item 7 MD&A) in the reader.
_HTML_MAX_CHARS = _int_env("SEC_COPILOT_HTML_MAX_CHARS", 8_000_000)
_TEXT_MAX_CHARS = _int_env("SEC_COPILOT_TEXT_MAX_CHARS", 500_000)
# Initial HTML payload: TOC + early pages. Set SEC_COPILOT_LAZY_FILING_HTML=0 to send full HTML in one response.
_LAZY_HTML = _env_bool("SEC_COPILOT_LAZY_FILING_HTML", True)
_HEAD_HTML_CHARS = _int_env("SEC_COPILOT_HTML_HEAD_CHARS", 500_000)
_FRAGMENT_MAX_CHARS = _int_env("SEC_COPILOT_FRAGMENT_MAX_CHARS", 2_500_000)


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
        anchors = cached_bundle.anchors
        if cached_bundle.html and anchors is None:
            anchors = build_filing_anchors(cached_bundle.html)
        return FilingBundle(
            ticker=cached_bundle.ticker,
            year=cached_bundle.year,
            form_type=cached_bundle.form_type,
            text=cached_bundle.text,
            html=cached_bundle.html,
            anchors=anchors,
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

    anchors = build_filing_anchors(html_content) if html_content else None
    bundle = FilingBundle(
        ticker=ticker.upper(),
        year=year,
        form_type=form_type.upper(),
        text=text[:_TEXT_MAX_CHARS],
        html=html_content,
        anchors=anchors,
        cached=False,
    )
    _FILING_CACHE[cache_key] = (time(), bundle)
    return bundle


def prepare_filing_display(bundle: FilingBundle) -> tuple[str | None, bool, list[dict] | None]:
    """Slice HTML for the first response when lazy mode is on; anchors always come from the full document."""
    anchors = bundle.anchors
    if bundle.html and anchors is None:
        anchors = build_filing_anchors(bundle.html)
    display_html = bundle.html
    partial = False
    if bundle.html and _LAZY_HTML and len(bundle.html) > _HEAD_HTML_CHARS:
        display_html = bundle.html[:_HEAD_HTML_CHARS]
        partial = True
    return display_html, partial, anchors


def get_filing_fragment_html(ticker: str, year: str, form_type: str, fragment: str) -> str | None:
    bundle = get_filing_text(ticker=ticker, year=year, form_type=form_type)
    if not bundle.html:
        return None
    return extract_fragment_html(bundle.html, fragment, _FRAGMENT_MAX_CHARS)


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
        " vs. ",
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
        "another year",
        "another filing",
        "different year",
        "different filing",
        "other year",
        "other filing",
        "second filing",
        "cross-year",
        "cross year",
    )
    return any(p in lowered for p in phrases)


def _explicit_calendar_year_in_question(question: str) -> str | None:
    m = re.search(r"\b(19|20)\d{2}\b", question)
    return m.group(0) if m else None


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
    # "Compare …" without naming a year → prior fiscal year vs the filing on screen
    if same_form and not year_match and re.search(
        r"\b(compare|comparison|versus|yoy|year over year)\b|\bvs\.?\b", lowered
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
    explicit_year = _explicit_calendar_year_in_question(question)

    try:
        active_y = int(year)
        comp_y = int(comparison_year)
    except ValueError:
        return ""

    # If the user did not name a calendar year, "compare" often meant prior year; clamping
    # future years to active_y-1 made sense. If they *did* name a year (e.g. 2026 vs 2024 on
    # screen), fetch that filing — do not rewrite 2026 into 2023.
    if same_form and comp_y >= active_y and explicit_year is None:
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

    compare_chars = _int_env("SEC_COPILOT_COMPARISON_TEXT_CHARS", 60_000)
    label = f"Additional SEC filing context ({comparison_form}, filing_date calendar year ~{comparison_year})"
    return f"{label}:\n{bundle.text[:compare_chars]}"
