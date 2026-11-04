# Fortune Frontier (Asteroid Mining Adventure)

A browser game for running multi-armed-bandit experiments on Prolific. Participants fly a starship over a row of asteroids, shoot the ones they think pay out, watch partner starships do the same, and say which partner they would take along next time. Every shot, watch and choice is logged to MongoDB.

<img width="848" alt="Fortune Frontier: a practice round, three shots in" src=".github/readme-screenshot.jpg" />

Built with Phaser (client), Express (server) and a small Python script that generates a fresh, randomized timeline for every participant. Internals are described in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Prerequisites

- **Node.js 20** (the production image is `node:20-slim`).
- **Python 3** on your `PATH` as `python3`, `python` or `py`. Standard library only, nothing to install.
- **MongoDB**: a local server for development, MongoDB Atlas in production.
- **ffmpeg**, only if you regenerate the How-to-Play media (`npm run capture-howto`).

## Quick start

```bash
npm install
cp .env.example .env        # ACTIVE_CONFIG, MONGODB_URI, PORT
npm run build-config        # compiles configs/<ACTIVE_CONFIG> → config.json
npm start                   # or: npm run dev  (nodemon, auto-restart)
```

Open `http://localhost:8080`. Without Prolific parameters in the URL the game runs in **demo mode** (see below), so you can play through without writing to the database.

`.env` is gitignored and holds three values:

| Variable | Read by | Meaning |
|---|---|---|
| `ACTIVE_CONFIG` | `npm run build-config`, `./deploy.sh` | Which YAML in `configs/` to compile into `config.json` |
| `MONGODB_URI` | `npm start` | Connection string. **Required**: the server exits without it. |
| `PORT` | `npm start` | Defaults to 8080. Cloud Run sets its own. |

Shell variables take precedence over `.env`, so `PORT=3000 npm start` works as expected.

Start MongoDB before `npm start` (macOS: `brew services start mongodb-community`). If MongoDB is down the server still serves the game, but `/api/log` answers 503 and the client keeps retrying until it comes back.

## Demo mode vs Prolific mode

The study URL on Prolific must be

```
https://<service-url>/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

The client reads the three parameters once at load. The Prolific ID is never typed.

| | Prolific mode (`PROLIFIC_PID` present) | Demo mode (no `PROLIFIC_PID`) |
|---|---|---|
| Consent page | Shown. Declining redirects to `prolific_no_consent_url`. | Skipped |
| Logging | Every action, the consent decision and every page unload | Nothing is sent |
| End screen | Waits for the log queue to drain, then shows "Return to Prolific" (`prolific_completion_url`) | "Thanks for playing!" |

Both URLs come from the active YAML (see [CONFIG.md](./CONFIG.md)).

## Configuration

The YAML files in `configs/` are the source of truth. `.env`'s `ACTIVE_CONFIG` picks one, and `npm run build-config` compiles it to `config.json`, which both the server and the Python generator read at runtime. **Never hand-edit `config.json`.** The current study is `configs/pilot_E.yaml`.

To run a new condition:

1. Copy `configs/pilot_E.yaml` to a new file and edit it. Set its `experiment_config` field to its own filename so logged rows carry the right `experiment_id`.
2. Point `.env` at it: `ACTIVE_CONFIG=<file>.yaml`.
3. Locally: `npm run build-config && npm start`. Production: `./deploy.sh`.

Every field, its accepted values and where it is read are documented in [CONFIG.md](./CONFIG.md).

Install the pre-commit hook once per clone so the committed `config.json` can never drift from the active YAML:

```bash
ln -sf ../../scripts/pre-commit .git/hooks/pre-commit
```

The hook rebuilds `config.json` and fails the commit if the result differs from what is staged.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server (`node server.js`). |
| `npm run dev` | Same, with auto-restart (nodemon). |
| `npm run build-config` | Compile `configs/<ACTIVE_CONFIG>` to `config.json`. |
| `npm run test-concurrency` | Fire 10 simultaneous `/api/timeline` requests at a running local server. |
| `npm run capture-howto` | Re-record the How-to-Play GIFs and screenshots from the live game. Needs the server running and ffmpeg. |
| `npm run export-bonuses -- --study <ID>` | Build the Prolific bulk-bonus list from MongoDB. See [After a study](#after-a-study). |
| `python3 scripts/equivalence_check.py [N]` | Regenerate the pilot D timeline N times and check its session structure is unchanged. |

## Deployment

Production runs on **Google Cloud Run** with **MongoDB Atlas**. The `Dockerfile` installs Node 20 and Python 3 and sets `NODE_ENV=production`, which makes the server bind to `0.0.0.0`.

Redeploy with:

```bash
./deploy.sh                      # extra flags pass through, e.g. ./deploy.sh --no-traffic
```

The script runs `npm run build-config` first, so the deployed `config.json` reflects **your** `.env`, not whatever is committed. It then runs `gcloud run deploy --source .`. Memory, CPU, concurrency, instance limits and the secret binding persist from the first deploy, so no flags are needed.

`deploy.sh` is committed with the real project id and region. First-time setup (enabling APIs, creating the `MONGODB_URI` secret, the initial deploy with all flags) is written up in the comments of [`deploy.example.sh`](./deploy.example.sh).

On the Atlas side, once: create an M0 cluster, add a database user with `readWrite` on `AMGDB`, allow network access from `0.0.0.0/0` (Cloud Run egresses from a dynamic IP pool), and store the SRV connection string in Secret Manager. To rotate the password later:

```bash
printf '%s' 'mongodb+srv://USER:NEW_PASSWORD@CLUSTER.mongodb.net/AMGDB?retryWrites=true&w=majority' \
  | gcloud secrets versions add MONGODB_URI --data-file=-
```

The service is bound to `MONGODB_URI:latest`, so new instances pick the new version up without a redeploy.

## After a study

The game never pays anyone. Bonuses are reconstructed from the logs:

```bash
npm run export-bonuses -- --study <PROLIFIC_STUDY_ID>
```

The full procedure, including pointing the script at the production database, is in [`.claude/docs/computing_bonus.md`](./.claude/docs/computing_bonus.md).

For local debugging, `GET /api/logs/:prolific_id` returns one participant's rows. It answers 404 in production.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `build-config` fails with "ACTIVE_CONFIG not set" or "not found" | Create `.env` from `.env.example` and make sure the named file exists in `configs/`. |
| Server exits at startup mentioning `config.json` | Run `npm run build-config`. |
| "No working Python installation found" | Install Python 3, then check `curl localhost:8080/api/test-python`. |
| "Failed to parse generated timeline" | A `print()` in `timeline_models/models.py` went to stdout. Debug output must go to `stderr`. |
| Actions not appearing in MongoDB | Confirm the URL had a `PROLIFIC_PID` (demo mode logs nothing), then check the Mongo state in `curl localhost:8080/api/health`. |
| Slow or queued timelines | `curl localhost:8080/api/timeline-status`. At most 4 Python processes run at once; the rest wait in a queue. |

To generate a timeline by hand and inspect it:

```bash
cd timeline_models && python3 models.py debug     # JSON on stdout, copy in timelines/timeline_debug.json
```

## Further reading

- [ARCHITECTURE.md](./ARCHITECTURE.md): the three tiers, the timeline JSON, how partner starships behave, the logging schema and the HTTP API.
- [CONFIG.md](./CONFIG.md): every config field.
- [CLAUDE.md](./CLAUDE.md): orientation for AI coding agents working in this repo.
