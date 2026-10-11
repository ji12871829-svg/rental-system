# OLbano PLAZA: THE LEDGER POSTS ITSELF

> **Type:** Product film (30–60 s), one camera, the app inside an iPhone.
> **Format:** square 1440 × 1440 master, 60 fps.
> **Music:** search royalty-free sources (user go-ahead given); UI sounds on actions; no voiceover.
> **Approved:** 2026-10-08 (step 0 approved as presented in chat).

A ~45-second product film for **Olbano Plaza** (the white-labeled name in the app's
title bar; "RPMS" is only the engine), showing the one flow that sells it — a tenant's
M-Pesa payment reconciling itself into the rent ledger and firing out a numbered
receipt — plus the dashboard and water metering around it. It should feel like a quiet
superpower for one landlord in Nairobi: the books are never stale, and nobody argues a
bill. Built entirely in code from the real interface, no templates or stock motion.

## Inputs

- Real frontend source: `frontend/src/pages/**` (screens, copy, tokens), Inter font,
  brand tokens from `frontend/src/index.css` (light UI: #ffffff/#fafafa, hairline
  #ebebeb; brand blue #2563eb, amber #f59e0b highlight, ink #0b1220-family).
- Brand assets: `frontend/public/building/building-1-*.webp`, `frontend/public/photos/*`,
  `frontend/public/favicon.svg`, `frontend/public/pwa-512.png`.
- Prior project notes: `videos/olbano-two-phones/` (BRIEF.md, tokens, real-figures).
- Music: royalty-free search (step 4). No user track.
- The real interface only, no invented features and no redesign.

## Direction

- **Canvas:** the landing page's own dark ink (#0b1220-family); the app's light UI
  glows inside the phone against it. Accent brand blue #2563eb with one amber #f59e0b
  highlight per screen (the landing's inline-highlight rule). Inter 700 tight-tracked
  for the wordmark; Inter for interface labels.
- **Motion:** every transition grows from a real action — the STK prompt opens the
  receipt, the receipt's number slides into the ledger row, the ledger pulls the camera
  back. No crossfades, particles or flips. Results hold 1–2 s; phone always readable.
- **Sound:** calm warm electronic bed (~100 BPM, afro-house lean), a crisp sound on each
  UI action (STK buzz, confirmation chime, receipt-print tick). The bed's lift lands on
  the payment confirmation. No voiceover.
- **Avoid:** fabricated testimonials/claims, tenant names or real phone numbers,
  dark-navy restyle of the old kit videos (this film uses the real light UI), blur-ins
  and glass effects, stock imagery.

## Structure (beat map draft — refined at step 2)

| # | Beat | What happens |
|---|---|---|
| 0 | Wordmark (0–3 s) | Ink canvas, Olbano Plaza + building photo, "Run Olbano Plaza from one ledger." Photo collapses into the iPhone — last frame meets first |
| 1 | Dashboard (3–10 s) | Real Dashboard: arrears metric, collection donut, who has paid / who owes — one number counting in, one hold |
| 2 | Rent Collection (10–18 s) | Rent Collection screen → "Send M-Pesa Prompt" tapped, STK push sends |
| 3 | The drop (18–26 s) | Portal status timeline: request sent → M-Pesa confirmed → posted to ledger; balance rolls to KSh 0, numbered receipt lands — "60 seconds, from payment to posted receipt" |
| 4 | Water (26–34 s) | Record Meter Reading → per-unit bill computed |
| 5 | Pull-back + close (34–45 s) | Camera pulls back to ink canvas: "The next rent payment could post itself." + address; last frame folds into beat 0 |

## Build

- Square 1440 × 1440; deterministic `seek(t)` every frame; 60 fps; springs and `track()`
  only, no CSS animation/timers/randomness.
- **Fictional data**: invented tenant names, amounts, receipt numbers. Only real
  features: STK push, auto-reconciliation, numbered receipts, metered water, arrears,
  tenant portal.
- Deliverables in `docs/launch-film/`: `brief.md`, `src/`, `out/*.mp4` (+ loop, poster),
  `dist/*.html`, `out/*-post.txt`, `README.md`.
- Render with music cut to the beat map; `check.mjs` clean; reviewers pass at ≥8 before
  final render.

## First

Capture/confirm the real screens, then the beat map + four stills (opening wordmark,
the STK tap, the receipt-lands drop, the end card) for review before the full build.

## Status

- **Step:** 0 complete; brief approved (format + music decided).
- **Done:** environment set up (Chrome for Testing, python3 shim), product read,
  brief written and approved.
- **Next:** step 1 materials — confirm real screens (run or capture the frontend),
  fonts and brand assets packed; then step 2 concept (beat map + 4 stills) for approval.
- **Open:** music search (step 4); logo/wordmark source (favicon.svg vs pwa icon);
  whether the app can run locally for capture or screens are rebuilt from source.
