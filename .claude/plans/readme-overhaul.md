# README overhaul: lean README + new ARCHITECTURE.md

Approved 2026-11-03. Full rationale and audit table in the chat plan; this file tracks execution.

- [x] 1. Save this checklist — .claude/plans/readme-overhaul.md
- [x] 2. Fix `.env.example` — `ACTIVE_CONFIG=pilot.yaml` → `pilot_E.yaml` (~1 line)
- [x] 3. Write `ARCHITECTURE.md` (new, ~280 lines)
  - [x] 3.1 Overview + per-user timeline generation
  - [x] 3.2 Timeline JSON: shape, stage catalogue, zone/demonstrator objects
  - [x] 3.3 Client stage dispatch + demonstrators (Thompson, visual identity)
  - [x] 3.4 Participant-facing naming + logging (collections, fields, enums, quirks, delivery)
  - [x] 3.5 HTTP API table, assets, known gaps
- [x] 4. Rewrite `README.md` (~140 lines): intro, prereqs, quick start, demo vs Prolific, configuration, scripts, deployment, after a study, troubleshooting, further reading
- [x] 5. Verify: links resolve, npm scripts exist, endpoints match server.js, GameLog fields match gameLog.js, `.env.example` config exists, line counts, read-through

## Findings
- `setupBlind` is called from `loadStage` but never defined; `blind` stages crash the client. Documented under Known gaps, not fixed.
- `CONFIG.md:3` names pilot_D as active; `.env` uses pilot_E. Not fixed (outside ask).
