"""Normalize ASGI paths so FastAPI routes work behind Next.js / Vercel rewrites.

Production rewrites `/api/py/:path*` → `/api/:path*` (e.g. `/api/chat`). Local dev
proxies to `/api/py/chat`. We collapse both to `/chat`, `/health`, etc.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class NormalizeApiPathMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.scope.get("path") or ""
        if path.startswith("/api/py"):
            rest = path[7:]
            if not rest:
                rest = "/"
            elif not rest.startswith("/"):
                rest = "/" + rest
            request.scope["path"] = rest
        elif path.startswith("/api/") and len(path) > 5:
            rest = path[4:]
            if not rest:
                rest = "/"
            elif not rest.startswith("/"):
                rest = "/" + rest
            request.scope["path"] = rest
        return await call_next(request)
