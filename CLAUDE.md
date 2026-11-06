# CLAUDE.md

Guidance for Claude Code in this repository. Setup and running: [README.md](./README.md). Internals (tiers, timeline JSON, demonstrators, logging schema, HTTP API): [ARCHITECTURE.md](./ARCHITECTURE.md). Every config field: [CONFIG.md](./CONFIG.md).

## Commands

```bash
npm install
npm run build-config     # compile configs/<ACTIVE_CONFIG> (from .env) → config.json; run after editing .env or any YAML
npm start                # http://localhost:8080; demo mode unless the URL has ?PROLIFIC_PID=...
npm run dev              # nodemon
npm run test-concurrency # concurrent /api/timeline requests against a running server
npm run capture-howto    # regenerate assets/introduction/* from the live game (server running, ffmpeg on PATH)
npm run export-bonuses -- --study <STUDY_ID>        # Prolific bulk-bonus list from Mongo; procedure in .claude/docs/computing_bonus.md
cd timeline_models && python3 models.py <request_id> # one timeline by hand: JSON on stdout, copy in timelines/
```

`MONGODB_URI` is required or the server exits; `.env` (copied from `.env.example`) provides it locally, Cloud Run injects it from Secret Manager. Install the pre-commit hook once per clone (`ln -sf ../../scripts/pre-commit .git/hooks/pre-commit`); it rebuilds `config.json` and fails the commit on drift. The Python generator is stdlib only.

## Invariants

Easy to break and not enforced by tooling. The reasoning is in ARCHITECTURE.md.

- **`configs/*.yaml` are authored; `config.json` is generated.** Never hand-edit `config.json`. `deploy.sh` rebuilds it from the deployer's `.env` before every deploy, so what ships is whatever the deployer's `ACTIVE_CONFIG` names.
- **`models.py` stdout is parsed as JSON by the server.** All debug output goes to `stderr`.
- **Mongoose drops fields not in the schema.** Add any new logged field to `models/gameLog.js` first, and any new logged `game` value to its enum.
- **Every stage change goes through `clearScene()`.** Never `children.removeAll()`, which leaves hit areas and timers alive across stages.
- **Adding a stage type** means all of: `setup<Type>(stage)`, a `case` in `loadStage()`, the `gameLog.js` enum if it logs, a label in `showTransitionOverlay()` and `maybeAddSummaryIcon()` if it is gameplay, emission in `models.py`, and a row in `CONFIG.md`'s token table.
- **Demonstrator behaviour is simulated in the browser** (`ThompsonSampler`: invisible warmup from `demo_N_prior_experience`, then the shown run continues from that posterior; both partners of a zone are drawn together so `demonstrator_filter` can constrain the pair). **Appearance is assigned in Python** at generation time so a `demonstrator_global_index` always looks the same. Keep each on its side of the boundary.
- **Participant-facing words**: a session is an *expedition*, a round is never named, the action is *shoot*, the meter is the *Reward Tank*. Code, config, timeline and logs keep `session` and `round`. Transition copy lives in `models.py`, not the client.
- **Phaser font names must be single tokens** (`Inter`, `Orbitron`). Canvas text styling comes from `THEME` in `main.js`, which mirrors the CSS variables in `index.html`; DOM placed over the canvas converts coordinates through the canvas bounding rect.
- **The server serves only `/`, `/main.js`, `/assets`, `/vendor`, mounted under `BASE_PATH`** (`/` locally, `/ver2_2026_11_05` in production via `deploy.sh`). Client URLs must stay relative (`api/log`, never `/api/log`) or they break only in production. Never expose the repo root; it holds the payoff table.

## Analysis gotchas

- `online-choice` logs as two games: `choice` then `watch`.
- Practice logs as `practice-play` / `practice-watch` (`practice` before 2026-10-19). Filter by prefix or `session_index == 0`.
- A reload starts a new `uid`; `refresh_count` is stamped at log time and never updated.
- Without `?PROLIFIC_PID=` the game is in demo mode and logs nothing.

## Deployment

Google Cloud Run + MongoDB Atlas. Redeploy with `./deploy.sh` (extra flags pass through, e.g. `--no-traffic`). First-time setup is in the comments of `deploy.example.sh`; Atlas notes and secret rotation are in README.md.
