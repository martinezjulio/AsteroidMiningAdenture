# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # install Node deps (express, mongoose, dotenv; axios/js-yaml/nodemon dev)
npm run build-config     # compile configs/<ACTIVE_CONFIG> (YAML) → config.json. Run after editing .env or any YAML in configs/.
npm start                # node server.js  → http://localhost:8080 (loads .env via dotenv at startup)
npm run dev              # nodemon (auto-restart on change)
npm run test-concurrency # simulate N concurrent /api/timeline requests (axios)
npm run capture-howto    # regenerate assets/introduction media from the live game (needs npm start + ffmpeg)
npm run export-bonuses -- --study <STUDY_ID>   # paste-ready Prolific bulk-bonus CSV from Mongo; procedure in .claude/docs/computing_bonus.md

# Manually generate a timeline (useful when debugging the Python side)
cd timeline_models && python3 models.py <request_id> '<demonstrator_config_json>'
```

The Python timeline generator has no `requirements.txt` — it uses only stdlib (`json`, `random`, `colorsys`, `itertools`, `typing`). Any Python 3 in `PATH` works; the server probes `python3` → `python` → `py` in order.

`MONGODB_URI` is required — the server exits at startup if it's missing. For local dev, copy `.env.example` to `.env` (which sets `MONGODB_URI=mongodb://localhost:27017/AMGDB` and `PORT=8080`); `dotenv` loads it on `npm start`. In production (Cloud Run) `MONGODB_URI` is injected from Secret Manager and takes precedence over `.env` (which doesn't exist in the prod image anyway). `NODE_ENV=production` only affects the listener host (`0.0.0.0` instead of `localhost`).

**Config authoring model.** `configs/*.yaml` files are the authored source of truth (per-field reference: [CONFIG.md](./CONFIG.md)). `.env`'s `ACTIVE_CONFIG` selects which YAML compiles into `config.json`. `config.json` is a generated artifact — never hand-edit it; the pre-commit hook regenerates it and fails if drift remains. `deploy.sh` runs `npm run build-config` before `gcloud run deploy --source .`, so the deployed `config.json` always reflects the deploying machine's `.env`, not whatever happens to be committed.

## Architecture

Three loosely coupled tiers connected by HTTP and stdio:

1. **Phaser browser client** (`index.html` + `main.js`, ~190KB single file; Phaser is vendored at `vendor/phaser.min.js`). On load it waits for web fonts, `GET /api/config`, then `GET /api/timeline`, walks the returned timeline stage-by-stage, and `POST /api/log`s every user action through an in-order retry queue (`enqueueLog`/`flushLogQueue`); the end screen drains the queue before showing the Prolific link (`prolific_completion_url` in the YAML).
2. **Express server** (`server.js`). Serves only `index.html`, `main.js`, `assets/` and `vendor/` (the repo root is deliberately not exposed — it holds the payoff table), exposes the timeline/log/health endpoints (`/api/log` returns 503 while Mongo is disconnected so the client retries), and shells out to Python for each timeline.
3. **Python timeline generator** (`timeline_models/models.py`). Pure stdlib; reads `../config.json`, prints one JSON timeline to stdout, writes a backup to `timelines/timeline_{requestId}.json`.

### Per-user timeline generation (the core flow)

`GET /api/timeline` is **not cached**. Every user gets a freshly generated timeline:

```
client → /api/timeline → spawn(python3, ['models.py', requestId, JSON.stringify(demonstrator_config)])
                       → capture stdout → JSON.parse → respond
```

Concurrency is bounded by `MAX_CONCURRENT_GENERATIONS` (currently 4) in `server.js`. Excess requests sit in `GENERATION_QUEUE` (FIFO) and are processed in `finishGeneration()`. Each spawn has a 30s timeout. Backup files in `timelines/` older than 1 hour are swept on startup and hourly. **All Python `print()` debug output must go to `stderr`** — `stdout` is parsed as JSON by the server.

### Demonstrator trajectories (always inline)

Demonstrator behavior in watch stages is generated **live in JS** by `ThompsonSampler` in `main.js` (Beta-Bernoulli, α=β=1). Warmup iterations (`demo_1_prior_experience` / `demo_2_prior_experience`) run invisibly first, then the visible run continues from the warmed-up posterior — so observed rewards causally drive observed actions. Full action/reward arrays (warmup + shown) are logged on a synthesized `action: "trajectory_complete"` row. Both partners' runs for a zone are drawn together at the first watch of that zone (`getZoneDemoTrajectory`) so `demonstrator_filter` can constrain the pair; the filter and attempt count are logged on the same row. The legacy "file mode" that loaded pre-computed trajectories from `bandits_data.json` was removed in the config-driven-rounds refactor. Practice (session 0) is play → watch → play in zone 0: the watched partner is slot 1 (the novice), takes one of the 20 demonstrator IDs, and skips `demonstrator_filter`; its ledger row reads PRACTICE with no total and is dropped when Expedition 1 starts.

When adding logged fields, update the schema in `models/gameLog.js` — Mongoose silently drops fields not in the schema.

### Prolific mode vs demo mode

The Prolific ID is read from the `PROLIFIC_PID` URL parameter at load (`PROLIFIC_MODE` in main.js) and never typed. Without it the game runs in demo mode: the consent page is skipped, `enqueueLog`, `logPageRefresh` and `logConsent` send nothing, and there are no Prolific redirects. Consent decisions (agree and decline) go to their own `Consent` collection (`models/consent.js`), not `GameLog`; declining redirects to `prolific_no_consent_url` (see CONFIG.md).

### Stage dispatch (`stage_type` vs `game`)

The timeline mixes two stage shapes; the dispatcher in `loadStage()` (main.js ~1061) reads `stage.stage_type || stage.game`:

- **Meta stages** use `stage_type`: `consent`, `welcome`, `introduction`, `instructions`, `feedback`, `demonstrator_presentation`. No `game_index`/`session_index`.
- **Game stages** use `game`: `practice`, `play`, `watch`, `choice`, `online-choice`, `blind`, `indicate`. Carry full `game_index`/`stage_index`/`session_index`/`round_index`.

Adding a new stage means: write a `setup<Type>(stage)` function, add a `case` to `loadStage()`, extend the `gameLog.js` `game` enum if it logs, and add a label in `showTransitionOverlay()` if it is a gameplay stage. Every stage change goes through `clearScene()` (destroys objects, kills timers/tweens/loader callbacks) — never `children.removeAll()`, which leaves hit areas and timers alive across stages.

### Visual theme

Colors/fonts for canvas text come from the `THEME` object in `main.js`, which mirrors the CSS variables in `index.html`; buttons go through `makeButton()`. Phaser's `font` shorthand splits on spaces, so font family names must be single tokens (`Inter`, `Orbitron`). The canvas is `1000×600` game units scaled with `Phaser.Scale.FIT`; anything positioned in the DOM over the canvas must convert via the canvas's bounding rect (see `displayInstructionLayout`).

### Participant-facing naming

A *session* is called an **expedition** in everything the participant reads (transition slides, reward captions, end screen); config, logs, timeline JSON and code keep `session`. Transition copy is generated in `models.py` (`overlay-title` + `overlay-message`), not in the client. A round is never named on screen either: the recap slide and header talk about **zones** (`EXPEDITION n` top-left, `ZONE n` top-right). Played zones number consecutively; choice/feedback stages use virtual zone `1000 + session` (see CONFIG.md). The action verb is **shoot** (shots, not pulls); the meter is the **Reward Tank**. The running-total row under the canvas is the reward ledger (`reward_breakdown_display: per_game`, `playGames` in main.js); its height is reserved from the timeline before the first stage renders so the canvas never moves.

### Demonstrator visual identity

Style+color is assigned **at timeline generation time in Python**, not at runtime, so the same `demonstrator_global_index` always renders identically across sessions. Constraints: within a session both demonstrators must differ in *both* style and color; globally each `(style, color)` pair is used at most once. There are 6×6 = 36 combinations and at most 20 demonstrator IDs, so the greedy assignment in `models.py` (~line 280) always succeeds. Files live at `assets/demonstrators/styles/style{1-6}/{red,orange,blue,green,yellow,purple}.png`.

### Online-choice logging quirk

The `online-choice` game type is one stage in the timeline but logs as **two** game types: the choice phase logs as `game: "choice"` and the watch phase as `game: "watch"`. Analyses don't need to special-case it. Practice stages (session 0) log as `practice-play` / `practice-watch`, so filter practice out by the `practice` prefix or `session_index == 0`.

### Config surface

The experimenter knob is the YAML named by `.env`'s `ACTIVE_CONFIG`, in `configs/`. Full per-field reference: [CONFIG.md](./CONFIG.md). The fields most likely to bite you:

- `round_game_sequence_conditions`: list-of-lists. Each inner list is one ROUND of stage tokens (`play`, `watch-demo-1`, `watch-demo-2`, `choice`, `online-choice`, `blind`, `indicate`, `feedback`). Repeated `num_rounds` times within a session.
- `session_end_stages`: appended once per session after the round-loop. Pilot uses `[choice, feedback]`.
- `sampling_method`: `"all_conditions_shuffled"` (each condition once, shuffled) or `"conditions_sampled_uniformly"` (draw `num_sessions` with replacement). Combined with `num_times_conditions_repeat` for outer replication.
- `demo_1_prior_experience` / `demo_2_prior_experience`: Thompson warmup iterations from α=β=1 priors, per demonstrator slot.
- `bandit_assignment_mode`: `"session_fixed"` (one zone per session) vs `"round_changing"` (new zone each round).
- `experience_message_text`: optional secondary overlay shown on watch stages. `null` omits it.
- `prop_of_sessions`: float — subsamples the session list AFTER `sampling_method` produces it (≥1.0 = keep all).
- `verbose`: surfaced to client via `/api/config` and gates `verboseLog()` in main.js.

**Directory layout**: `configs/` holds authored YAMLs (one per experimental condition; pilot D lives at `configs/pilot_D_2026-01-20.yaml`). `timelines/` holds per-request generated timeline backups (gitignored except for the directory itself). `config.json` is the YAML→JSON build artifact — committed for fresh-clone usability and as a runtime safety net, never authored.

## Deployment

Production runs on **Google Cloud Run**, built from the `Dockerfile` (Node 20-slim + python3, `NODE_ENV=production`, `PORT=8080`). MongoDB is **Atlas**, with the connection string stored in Secret Manager as `MONGODB_URI` and bound to the service via `--set-secrets MONGODB_URI=MONGODB_URI:latest`.

Redeploy with `./deploy.sh`. The script first runs `npm run build-config` (regenerating `config.json` from the YAML named by the deployer's `.env` `ACTIVE_CONFIG`), then `gcloud run deploy --source . --region <REGION>`. Flags from the first-time deploy — memory, cpu, concurrency, timeout, min/max-instances, allow-unauthenticated, set-secrets — persist across revisions, so subsequent deploys only need `--source` and `--region`. Override at runtime by passing extra args, e.g. `./deploy.sh --memory 2Gi` or `./deploy.sh --no-traffic`. `deploy.example.sh` is a template documenting the one-off first-time setup (enabling APIs, creating the `MONGODB_URI` secret, the initial `gcloud run deploy` with all the persistent flags).
