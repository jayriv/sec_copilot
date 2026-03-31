# SEC Copilot

Minimalist, session-aware SEC filing research app.

## Stack
- Frontend: Next.js + Tailwind + Lucide
- Backend: FastAPI on Vercel Python serverless (`api/index.py`) + `edgartools` + `litellm`
- Persistence: Browser `localStorage` keyed by `ticker + year + formType`

## Local development

From the repository root:

1. Python 3.12+ and Node.js 18+ recommended.
2. Create a local env file (not committed):
   - Copy `.env.example` to `.env` in the project root.
   - Fill `OPENAI_API_KEY`, `EDGAR_IDENTITY`, and optional `LITELLM_MODEL` (`gpt-4` default).
3. Install JS dependencies: `npm install`
4. Run both servers: `npm run dev`
   - Next.js: `http://localhost:3000` (proxies `/api/py/*` to FastAPI)
   - FastAPI: `http://127.0.0.1:8000`

API routes live under **`/api/py`** (for example `/api/py/health`).

## Deploy on Vercel

1. Import this GitHub repo in Vercel (framework: Next.js; root directory: repo root — default).
2. In **Project → Settings → Environment Variables**, add:
   - `OPENAI_API_KEY`
   - `EDGAR_IDENTITY` (format: `Your Name your@email.com`)
   - `LITELLM_MODEL` (`gpt-4` or your chosen model)
3. Deploy. The frontend uses same-origin requests to `/api/py/*` by default (no `NEXT_PUBLIC_API_BASE_URL` needed).

If the UI shows **api offline**, open `/api/py/health` on your deployment in the browser. That endpoint must return `{"status":"ok"}` without needing SEC data. In **Vercel → Project → Logs** (Functions), check for import errors: Python must load `edgartools` successfully, and **EDGAR_IDENTITY** must be set for `/filing` and `/chat` (not for `/health`).
4. Optional: set **Function** max duration / plan limits; `vercel.json` requests up to 60s for `api/index.py` (requires a plan that supports it).

### Notes
- Python + Next.js in one project follows the common pattern: Next rewrites `/api/py/:path*` to the Python serverless entry in production, and to `localhost:8000` in development (see `next.config.js`).
- Serverless bundles must stay within Vercel size limits; large scientific stacks may require trimming dependencies.

## Secret scanning (pre-commit)

- Install: `pip install pre-commit detect-secrets`
- Enable: `pre-commit install`
- Manual run: `pre-commit run detect-secrets --all-files`

This blocks commits that include likely secrets.
