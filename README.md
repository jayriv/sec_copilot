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

## Notes
- This machine currently has Node 14; Next 14 typically requires Node 18+.
- Upgrade Node to 18+ before running frontend install/start.
