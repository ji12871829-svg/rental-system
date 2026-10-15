# Runbook — staff copilot (Groq free tier + voice)

1. Sign up at Groq (email only, no card) → create an API key.
2. Local: put `GROQ_API_KEY=<key>` in `backend/.env`. Production: Render
   dashboard → service → Environment → add `GROQ_API_KEY` → Save (redeploys).
3. Open the Assistant page: banner gone means live. Ask "who has not paid
   October rent?" as a smoke test.
4. Free-tier reality (Oct 2026): ~1,000 requests/day per model, no card.
   Model default `openai/gpt-oss-20b` via `GROQ_MODEL`. Limits change without
   warning — the provider is swap-able (OpenAI-compatible endpoint).
5. Voice dictation is browser-native (Chrome/Edge); elsewhere the mic hides
   and typing works. No audio ever leaves the device for transcription.
6. Privacy: prompts may contain tenant names/balances — check the provider's
   current data-use terms before going live; drafts never send without a
   human pressing Approve (existing role-guarded campaign endpoint).
