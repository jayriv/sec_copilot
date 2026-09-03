# SEC Copilot

Minimalist, session-aware SEC filing research app.

## Stack
- Frontend: Next.js + Tailwind + Lucide
- Backend: FastAPI on Vercel Python serverless (`api/index.py`) + `edgartools` + `litellm`
- Chat model: **GPT-5.4 mini** by default (`openai/gpt-5.4-mini`); switchable per user in the model picker
- Grounding: open-courseware retrieval over a committed vector index (see [courseware/README.md](courseware/README.md))
- Persistence: Browser `localStorage` keyed by `ticker + year + formType`

## Local development

From the repository root:

1. Python 3.12+ and Node.js 18+ recommended.
2. Create a local env file (not committed):
   - Copy `.env.example` to `.env` in the project root.
   - Fill `EDGAR_IDENTITY` and `OPENAI_API_KEY` (the default chat model and the courseware embeddings both run on OpenAI).
   - `LITELLM_MODEL` **overrides** the built-in default; leave it unset or set it to `openai/gpt-5.4-mini`.
3. Install JS dependencies: `npm install`
4. Run both servers: `npm run dev`
   - Next.js: `http://localhost:3000` (proxies `/api/py/*` to FastAPI)
   - FastAPI: `http://127.0.0.1:8000`

API routes live under **`/api/py`** (for example `/api/py/health`).

Filings are returned as **plain text** (for the LLM) and, when available, **HTML** from edgartools for the reader so tables and structure resemble the original filing more closely than raw text extraction.

## Deploy on Vercel

1. Import this GitHub repo in Vercel (framework: Next.js; root directory: repo root — default).
2. In **Project → Settings → Environment Variables**, add:
   - `OPENAI_API_KEY` (required: default chat model + courseware embeddings)
   - `EDGAR_IDENTITY` (format: `Your Name your@email.com`)
   - `LITELLM_MODEL` (`openai/gpt-5.4-mini`; **overrides** the code default if set to something else)
   - Optional: `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` to enable those models in the picker
   - Optional: `EDGAR_LOCAL_DATA_DIR` — **`api/index.py` sets this under `gettempdir()/edgartools` automatically** on Vercel / Lambda-style runtimes ([local storage guide](https://edgartools.readthedocs.io/en/stable/guides/local-storage/)). Override if your host still tries to use a read-only home directory.
3. Deploy. The frontend uses same-origin requests to `/api/py/*` by default (no `NEXT_PUBLIC_API_BASE_URL` needed).

If the UI shows **api offline**, open `/api/py/health` on your deployment in the browser. That endpoint must return `{"status":"ok"}` without needing SEC data. In **Vercel → Project → Logs** (Functions), check for import errors: Python must load `edgartools` successfully, and **EDGAR_IDENTITY** must be set for `/filing` and `/chat` (not for `/health`).
4. Optional: set **Function** max duration / plan limits; `vercel.json` requests up to 60s for `api/index.py` (requires a plan that supports it).

### Notes
- **Course material:** answers are grounded in open textbooks indexed under `courseware/`. Retrieval runs per question, is capped by the **Course material** slider (0 = off), and returns citations shown as chips under each answer. Company facts always come from the filing; the textbook supplies concepts only. Adding a book is a manifest entry plus one script run — see [courseware/README.md](courseware/README.md).
- **Model choice**, measured per whole question on the agent loop (all tool turns included):

  | model | cost | latency | cites? | facts? |
  |---|---:|---:|:--:|:--:|
  | `gpt-5.4-mini` (default) | $0.004 | 3.7s | yes | yes |
  | `gpt-5.4` | $0.016 | 4.1s | yes | yes |
  | `gpt-4o` | $0.019 | 6.1s | yes | yes |
  | `gpt-4o-mini` | $0.001 | 5.5s | **no** | yes |
  | `gpt-4` | $0.635 | **80.2s** | **no** | **no** |

  `gpt-4` is delisted: it exceeds the 60s function limit and costs 150x the default for a worse answer. Re-measure with the `chat_usage` logs if you change models.
- **Agent mode (on by default; `COPILOT_AGENT_MODE=0` to disable):** instead of stuffing the filing into one prompt, the copilot gets five tools — `search_filing`, `get_filing_section`, `search_course_material`, `search_other_filing`, `calc` — and decides what to look up. Tools are split by verb, not by document, so adding textbooks never adds tools. This fixes three things the single-shot path cannot: `_smart_excerpt` drops the middle of a filing (often MD&A and the notes), `maybe_get_comparison_context` routes comparisons by regex, and multi-hop questions need concept → policy → comparison. Bounded by `COPILOT_AGENT_MAX_TURNS` and `COPILOT_AGENT_TIME_BUDGET_S`; the last turn always answers with tools withheld, and any failure falls back to the single-shot path. Answers carry a collapsible research trail.
- **Live progress:** `/chat/stream` sends server-sent events (`tool_start` / `tool_end` / `done`), so the chat panel shows what the copilot is doing — "Searching the filing for …", "Looking up … in the textbook" — instead of a spinner. Verified incremental locally (`Transfer-Encoding: chunked`, events at +2.7s / +4.8s / +5.8s / +7.1s). The client falls back to plain `POST /chat` if the endpoint is missing, the browser has no `response.body`, or a proxy buffers, so a host that cannot stream degrades to exactly the previous behaviour.
- **Usage logging:** every question emits one `chat_usage` line (Vercel → Logs → Functions) with mode, calls, tokens, cache hits, cost, and latency, and the same figures come back on the `/chat` response as `usage`. Cost is priced by litellm, so it covers every provider in the picker and is `null` rather than wrong when a model is unpriced. The agent loop makes several calls per question, so the tally sums the whole question, not one call.
- **Context size & system prompt:** The chat panel includes sliders for **current filing** and **additional (comparison) context** character caps (saved in the browser). The **Admin** page (`/admin`) pre-fills the default system prompt for editing; enable **Use custom prompt** to send your saved text with chat. The API accepts client prompts only when **`COPILOT_ALLOW_CLIENT_SYSTEM_PROMPT=1`** is set (see `.env.example`). Optional **`COPILOT_SYSTEM_PROMPT`** sets the server default when the UI does not send an override.
- Python + Next.js in one project follows the common pattern: Next rewrites `/api/py/:path*` to the Python serverless entry in production, and to `localhost:8000` in development (see `next.config.js`). In production the rewrite target is **`/api/`** (not `/api/:path*`): on Vercel, only the bare `/api` path invokes `api/index.py`; rewriting to `/api/health` is handled by Next.js and returns 404 unless you use `/api/`.
- Serverless bundles must stay within Vercel size limits; large scientific stacks may require trimming dependencies.

## Secret scanning (pre-commit)

- Install: `pip install pre-commit detect-secrets`
- Enable: `pre-commit install`
- Manual run: `pre-commit run detect-secrets --all-files`

This blocks commits that include likely secrets.
