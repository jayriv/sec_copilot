import os
import sys
import tempfile


def _ensure_edgar_local_data_dir() -> None:
    """Point edgartools at a writable dir before import (Vercel home is read-only)."""
    if os.environ.get("EDGAR_LOCAL_DATA_DIR"):
        return
    serverless = bool(
        os.environ.get("VERCEL")
        or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
        or os.environ.get("AWS_EXECUTION_ENV")
    )
    if not serverless:
        return
    base = os.path.join(tempfile.gettempdir(), "edgartools")
    os.makedirs(base, exist_ok=True)
    os.environ["EDGAR_LOCAL_DATA_DIR"] = base


_ensure_edgar_local_data_dir()

_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _root not in sys.path:
    sys.path.insert(0, _root)

from server.copilot_api import app
