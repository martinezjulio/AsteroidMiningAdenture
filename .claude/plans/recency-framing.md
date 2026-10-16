# Recency framing, demonstrator-pair filter, choice confound fixes

Approved 2026-10-15. Full rationale in the session plan; decisions: keep the task memory-based and the bandit noisy (no ledger/pip persistence, no warmup/shots/payoff changes).

- [x] 1. Generator copy and stage data — timeline_models/models.py
  - [x] 1.1 Last-play-in-zone title + message (~15 lines)
  - [x] 1.2 Intro partner paragraph: partners differ, skill is stable; fix "its" (~3 lines)
  - [x] 1.3 Intro bonus sentence from bonus_per_reward / bonus_currency (~8 lines)
  - [x] 1.4 Per-session display_order on presentation + choice stages; names in that order (~8 lines)
- [x] 2. Client partner order and choice cursor
  - [x] 2.1 setupDemonstratorPresentation honors display_order — main.js (~6 lines)
  - [x] 2.2 setupChoice: order, no preselected cell, slot-based selection, log choice_display_order — main.js (~30 lines)
  - [x] 2.3 choice_display_order in schema — models/gameLog.js (~1 line)
- [x] 3. Demonstrator-pair filter
  - [x] 3.1 demonstrator_filter + demonstrator_filter_max_attempts: pilot_E.yaml, server.js /api/config, CONFIG.md (~10 lines)
  - [x] 3.2 Per-zone pair draw with rejection sampling; setupWatch reads the cache — main.js (~40 lines)
  - [x] 3.3 Filter fields on trajectory_complete — main.js + models/gameLog.js (~6 lines)
- [x] 4. Pips: PIP_RADIUS 4→6, PIP_SPACING 10→14 — main.js (~2 lines)
- [x] 5. CLAUDE.md: one sentence on per-zone pair draw + filter

- [x] 6. Intro + How to Play as DOM pages; game frame first appears on the practice slide — index.html, main.js
- [x] 7. [BLUE] highlight for the partner sentence — models.py, main.js, index.html
- [x] 8. Intro bonus in cents (rest of game stays in dollars) — models.py
- [x] 9. Reward recap after the last round of every expedition (expedition-total wording, Continue) — models.py, main.js, CONFIG.md

## Findings
- 1.1: solo-session recap uses number words ("You've mined here three times already."); first-and-last play in a zone says "only visit".
- 2.2: `position` is `required: Number` in the log schema, so the unselected choice cursor logs as -1, not null.
- 3.2: `setupIndicate` and the online-choice watch phase still build their own samplers (both unused in pilot E); only `setupWatch` reads the per-zone pair cache.
