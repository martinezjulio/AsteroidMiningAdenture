# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # install Node deps (express, mongoose, dotenv; axios/js-yaml/nodemon dev)
npm run build-config     # compile configs/<ACTIVE_CONFIG> (YAML) → config.json. Run after editing .env or any YAML in configs/.
npm start                # node server.js  → http://localhost:8080 (loads .env via dotenv at startup)
npm run dev              # nodemon (auto-restart on change)
npm run test-concurrency # simulate N concurrent /api/timeline requests (axios)

# Manually generate a timeline (useful when debugging the Python side)
cd timeline_models && python3 models.py <request_id> '<demonstrator_config_json>'
```

The Python timeline generator has no `requirements.txt` — it uses only stdlib (`json`, `random`, `colorsys`, `itertools`, `typing`). Any Python 3 in `PATH` works; the server probes `python3` → `python` → `py` in order.

`MONGODB_URI` is required — the server exits at startup if it's missing. For local dev, copy `.env.example` to `.env` (which sets `MONGODB_URI=mongodb://localhost:27017/AMGDB` and `PORT=8080`); `dotenv` loads it on `npm start`. In production (Cloud Run) `MONGODB_URI` is injected from Secret Manager and takes precedence over `.env` (which doesn't exist in the prod image anyway). `NODE_ENV=production` only affects the listener host (`0.0.0.0` instead of `localhost`).

**Config authoring model.** `configs/*.yaml` files are the authored source of truth (per-field reference: [CONFIG.md](./CONFIG.md)). `.env`'s `ACTIVE_CONFIG` selects which YAML compiles into `config.json`. `config.json` is a generated artifact — never hand-edit it; the pre-commit hook regenerates it and fails if drift remains. `deploy.sh` runs `npm run build-config` before `gcloud run deploy --source .`, so the deployed `config.json` always reflects the deploying machine's `.env`, not whatever happens to be committed.

## Architecture

Three loosely coupled tiers connected by HTTP and stdio:

1. **Phaser browser client** (`index.html` + `main.js`, ~190KB single file). On load it `GET /api/config` then `GET /api/timeline`, walks the returned timeline stage-by-stage, and `POST /api/log`s every user action.
2. **Express server** (`server.js`). Serves static files, exposes the timeline/log/health endpoints, and shells out to Python for each timeline.
3. **Python timeline generator** (`timeline_models/models.py`). Pure stdlib; reads `../config.json`, prints one JSON timeline to stdout, writes a backup to `timelines/timeline_{requestId}.json`.

### Per-user timeline generation (the core flow)

`GET /api/timeline` is **not cached**. Every user gets a freshly generated timeline:

```
client → /api/timeline → spawn(python3, ['models.py', requestId, JSON.stringify(demonstrator_config)])
                       → capture stdout → JSON.parse → respond
```

Concurrency is bounded by `MAX_CONCURRENT_GENERATIONS` (currently 4) in `server.js`. Excess requests sit in `GENERATION_QUEUE` (FIFO) and are processed in `finishGeneration()`. Each spawn has a 30s timeout. Backup files in `timelines/` older than 1 hour are swept on startup and hourly. **All Python `print()` debug output must go to `stderr`** — `stdout` is parsed as JSON by the server.

### Two demonstrator modes (set in the active YAML in `configs/`)

- **`source: "file"`** — load pre-computed Thompson trajectories from `timeline_models/bandits_data.json` (~6MB). Each watch stage gets a sliced trajectory; rewards are sampled randomly at runtime in JS.
- **`source: "inline"`** — only `bandit_payoffs` are passed; trajectories are generated **in JS at watch time** by `ThompsonSampler` in `main.js` (Beta-Bernoulli, α=β=1). Warmup iters (`expert_demonstrator_experience` / `novice_demonstrator_experience`) run invisibly, then the visible run continues from the warmed-up posterior, so observed rewards causally drive observed actions. Full action/reward arrays (warmup + shown) are logged on a synthesized `action: "trajectory_complete"` row.

When adding logged fields, update the schema in `models/gameLog.js` — Mongoose silently drops fields not in the schema.

### Stage dispatch (`stage_type` vs `game`)

The timeline mixes two stage shapes; the dispatcher in `loadStage()` (main.js ~1061) reads `stage.stage_type || stage.game`:

- **Meta stages** use `stage_type`: `prolific_id_form`, `introduction`, `instructions`, `feedback`, `demonstrator_presentation`. No `game_index`/`session_index`.
- **Game stages** use `game`: `practice`, `play`, `watch`, `choice`, `online-choice`, `blind`, `indicate`. Carry full `game_index`/`stage_index`/`session_index`/`round_index`.

Adding a new stage means: extend the `gameLog.js` enum, write a `setup<Type>(stage)` function, add a `case` to `loadStage()`, and add a button label in `makeNextButton()` (~main.js 4743).

### Demonstrator visual identity

Style+color is assigned **at timeline generation time in Python**, not at runtime, so the same `demonstrator_global_index` always renders identically across sessions. Constraints: within a session both demonstrators must differ in *both* style and color; globally each `(style, color)` pair is used at most once. There are 6×6 = 36 combinations and at most 20 demonstrator IDs, so the greedy assignment in `models.py` (~line 280) always succeeds. Files live at `assets/demonstrators/styles/style{1-6}/{red,orange,blue,green,yellow,purple}.png`.

### Online-choice logging quirk

The `online-choice` game type is one stage in the timeline but logs as **two** game types: the choice phase logs as `game: "choice"` and the watch phase as `game: "watch"`. Analyses don't need to special-case it.

### Config surface

The experimenter knob is the YAML named by `.env`'s `ACTIVE_CONFIG`, in `configs/`. Full per-field reference: [CONFIG.md](./CONFIG.md). The fields most likely to bite you:

- `bandit_assignment_mode`: `"session_fixed"` (one zone per session) vs `"round_changing"` (new zone each round).
- `session_demonstrators`: `"all"` generates 4 patterns (EE/EN/NE/NN) per round-set; `"different"` keeps only mixed pairs.
- `prop_of_sessions`: float in (0, 1] — fraction of generated sessions kept (≥1.0 = all).
- `present_demonstrators_apriori`: prepends a `demonstrator_presentation` meta stage to each session (changes the intro overlay text in `models.py`, see `is_first_game` branch).
- `verbose`: surfaced to client via `/api/config` and gates `verboseLog()` in main.js.

**Directory layout**: `configs/` holds authored YAMLs (one per experimental condition; pilot lives at `configs/pilot.yaml`). `timelines/` holds per-request generated timeline backups (gitignored except for the directory itself). `config.json` is the YAML→JSON build artifact — committed for fresh-clone usability and as a runtime safety net, never authored.

## Deployment

Production runs on **Google Cloud Run**, built from the `Dockerfile` (Node 20-slim + python3, `NODE_ENV=production`, `PORT=8080`). MongoDB is **Atlas**, with the connection string stored in Secret Manager as `MONGODB_URI` and bound to the service via `--set-secrets MONGODB_URI=MONGODB_URI:latest`.

Redeploy with `./deploy.sh`. The script first runs `npm run build-config` (regenerating `config.json` from the YAML named by the deployer's `.env` `ACTIVE_CONFIG`), then `gcloud run deploy --source . --region <REGION>`. Flags from the first-time deploy — memory, cpu, concurrency, timeout, min/max-instances, allow-unauthenticated, set-secrets — persist across revisions, so subsequent deploys only need `--source` and `--region`. Override at runtime by passing extra args, e.g. `./deploy.sh --memory 2Gi` or `./deploy.sh --no-traffic`. `deploy.example.sh` is a template documenting the one-off first-time setup (enabling APIs, creating the `MONGODB_URI` secret, the initial `gcloud run deploy` with all the persistent flags).
