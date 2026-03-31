# SEC Copilot

Minimalist, session-aware SEC filing research app.

## Stack
- Frontend: Next.js + Tailwind + Lucide
- Backend: FastAPI + edgartools + litellm
- Persistence: Browser localStorage keyed by `ticker + year + formType`

## Run
1. Backend
   - `cd backend`
   - `python -m venv .venv`
   - `.venv\Scripts\activate`
   - `pip install -r requirements.txt`
   - `copy .env.example .env` and fill keys
   - `uvicorn app.main:app --reload --port 8000`
2. Frontend
   - `cd frontend`
   - `npm install`
   - `copy .env.example .env.local`
   - `npm run dev`

## Secret Scanning (Pre-commit)
- Install: `pip install pre-commit detect-secrets`
- Enable hook: `pre-commit install`
- Run scan manually: `pre-commit run detect-secrets --all-files`

This blocks commits that include likely secrets (API keys, tokens, private keys).

## Deploy (GitHub Pages + Hosted Backend)
GitHub Pages serves only the static frontend. The FastAPI backend must be deployed separately (Render/Railway/Fly).

1. Deploy backend from `backend/` with:
   - Build: `pip install -r requirements.txt`
   - Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Env vars:
     - `OPENAI_API_KEY=...`
     - `EDGAR_IDENTITY=Your Name your@email.com`
     - `LITELLM_MODEL=gpt-4`
2. In GitHub repo settings, add Actions secret:
   - `NEXT_PUBLIC_API_BASE_URL=https://<your-backend-domain>`
3. In GitHub repo settings, enable Pages:
   - Source: `GitHub Actions`
4. Push to `main`. Workflow `.github/workflows/deploy-pages.yml` will publish the frontend.

Expected URL: `https://jayriv.github.io/sec_copilot/`

## Notes
- This machine currently has Node 14; Next 14 typically requires Node 18+.
- Upgrade Node to 18+ before running frontend install/start.
