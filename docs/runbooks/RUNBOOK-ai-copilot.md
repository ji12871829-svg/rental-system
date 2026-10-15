# Runbook — staff copilot (Groq free tier + voice)

1. Sign up at Groq (email only, no card) → create an API key.
2. Local: put `GROQ_API_KEY=<key>` in `backend/.env`. Production: Render
   dashboard → service → Environment → add `GROQ_API_KEY` → Save (redeploys).
3. Open the Assistant page: banner gone means live. Ask "who has not paid
   October rent?" as a smoke test.
4. Free-tier reality (Oct 2026): ~1,000 requests/day per model, no card.
   Model default `openai/gpt-oss-20b` via `GROQ_MODEL`. Limits change without
   warning — the provider is swap-able (OpenAI-compatible endpoint).
5. Voice dictation records in the browser (MediaRecorder, 60 s cap) and
   transcribes server-side via Groq Whisper (`whisper-large-v3-turbo`,
   same free tier) — far stronger on accented speech than the browser's
   built-in recognizer, which garbled even short English queries. Unlike
   before, voice AUDIO does leave the device (to Groq, for transcription
   only) — covered by the same data-use check as point 6. Mic needs a secure
   context (HTTPS in production, localhost in dev) plus the site permission.
6. Privacy: prompts may contain tenant names/balances — check the provider's
   current data-use terms before going live; drafts never send without a
   human pressing Approve (existing role-guarded campaign endpoint).

## Memory, retention, briefing (agent update)

- Conversations save per staff user (Threads table). Switching threads
  resumes exact context; Delete is a hard erase (privacy).
- Idle threads auto-delete after 365 days on listing; no scheduler to run.
- The "What needs attention" briefing is deterministic rules over live
  data (top debtors, longest overdue, collection pace, water spikes) — the
  model never invents suggestions. Same payload backs the chat
  (`get_briefing` tool) and the greeting cards.
- Fence unchanged: the agent drafts and prioritizes; money movement, SMS
  sending, and record changes stay behind human approval.
