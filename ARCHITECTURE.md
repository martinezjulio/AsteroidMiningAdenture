# Architecture

How Fortune Frontier works under the hood: the three tiers, the timeline every participant receives, how partner starships behave, what gets logged, and the HTTP surface. Setup and deployment are in [README.md](./README.md). Config fields are in [CONFIG.md](./CONFIG.md).

## Overview

Three loosely coupled tiers, connected by HTTP and stdio:

| Tier | Where | Role |
|---|---|---|
| Phaser client | `index.html`, `main.js` (one ~190 KB file), `vendor/phaser.min.js` | Renders stages, simulates the partner starships, logs every action |
| Express server | `server.js`, `models/` | Serves the client, generates timelines on demand, writes to MongoDB |
| Timeline generator | `timeline_models/models.py` | Pure-stdlib Python. Reads `config.json`, prints one randomized timeline as JSON |

One participant's run:

```
browser loads index.html
  → waits for web fonts
  → GET /api/config          experiment id, display flags, Prolific URLs, demonstrator priors
  → GET /api/asset-manifest  asteroid and background filenames
  → GET /api/timeline        server spawns models.py and returns its stdout
  → walks the timeline stage by stage (loadStage)
      every action → POST /api/log through an in-order retry queue
  → end screen drains the queue, then "Return to Prolific"
```

## Per-user timeline generation

`GET /api/timeline` is never cached. Each request spawns

```
python3 models.py <requestId>        # cwd: timeline_models/
```

and parses the child's stdout as JSON.

- **Concurrency.** At most `MAX_CONCURRENT_GENERATIONS` (4) children run at once. Further requests wait in a FIFO queue and are started from `finishGeneration()`.
- **Timeout.** 30 s per child. On failure the client shows an error page asking the participant to refresh. Nothing is logged for that attempt.
- **Python lookup.** The server tries `python3`, `python`, `py` in that order.
- **stdout is the API.** Everything `models.py` writes to stdout must be the JSON timeline and nothing else. Debug output goes to `stderr`.
- **Backups.** Each timeline is also written to `timelines/timeline_<requestId>.json`. Files older than one hour are deleted at startup and hourly. The directory is created if missing. The files are gitignored.
- **Config.** `models.py` reads `../config.json` and exits 1 if it is missing or lacks a required field. `server.js` also requires `config.json` at startup, so a missing file stops the server before it listens.

## Timeline JSON

### Shape

The timeline is a list of sessions. Session 0 is the practice session and is a flat list of stages. Every later session is a two-element list `[games, end_stages]`:

```
[
  [consent, welcome, introduction, instructions, practice, watch, practice, practice_end],   # session 0
  [ [game, game, ...], [choice, feedback] ],                                                  # session 1
  [ [game, game, ...], [choice, feedback] ],                                                  # session 2
  ...
]
```

`games` is one entry of `round_game_sequence_conditions` repeated for `num_rounds` rounds, with an optional `demonstrator_presentation` stage prepended and an optional `round_recap` after each round that had a play. `end_stages` comes from `session_end_stages`. A session whose round sequence has no `watch-demo-*` token drops every demonstrator-dependent end stage (`choice`, `online-choice`, `blind`, `indicate`, `feedback`).

Every stage of a session carries `condition` (that session's token list joined with `-`) and `condition_order` (all sessions' labels in played order, `|`-separated).

### Two kinds of stage

The client dispatcher reads `stage.stage_type || stage.game`.

- **Meta stages** have `stage_type` and no game indices: screens of text, forms, recaps.
- **Game stages** have `game` plus `game_index`, `stage_index`, `session_index`, `round_index`, `session_total_rounds`, `num_arm_pulls`, `transfer`, `demonstrator`, `zone`, `overlay-title`, `overlay-message`. Watch stages add `secondary-overlay-message` when `experience_message_text` is set.

### Stage catalogue

| Key | Kind | Emitted when | Notable fields | Client |
|---|---|---|---|---|
| `consent` | meta | always, session 0 | `paragraphs`, `contact_email`, decline texts | `setupConsent`; skipped in demo mode |
| `welcome` | meta | always | `message` | `setupWelcome` (Start button, requests fullscreen) |
| `introduction` | meta | always | `message` with `[BOLD]`, `[BLUE]`, `[ORANGE]`, `[RED_BOLD]` markup | `setupIntroduction` |
| `instructions` | meta | always | `instructions.panels[]` (`title`, `image`, `caption` with `[KEY]` markup), `note` | `setupInstructions`; media in `assets/introduction/` |
| `practice` | game | session 0, before and after the practice watch | zone 0, `num_arm_pulls` | `setupPlayOrPractice(stage, true)` |
| `practice_end` | meta | always, end of session 0 | `title`, `message` | `setupPracticeEnd` |
| `demonstrator_presentation` | meta | `present_demonstrators_apriori` and the session has a watch | `demonstrator1`, `demonstrator2`, `display_order`, `title`, `message` | `setupDemonstratorPresentation` |
| `play` | game | `play` token | `demonstrator: null` | `setupPlayOrPractice(stage, false)` |
| `watch` | game | `watch-demo-1` / `watch-demo-2` | `demonstrator`, top-level `demonstrator_index` (0 or 1) | `setupWatch` |
| `round_recap` | meta | `report_play_rewards_between_rounds` and the round had a play | `round_index`, `session_total_rounds` | `setupRoundRecap` |
| `choice` | game | `choice` token | `demonstrator1`, `demonstrator2`, `display_order`, `transfer: true`, `num_arm_pulls: null` | `setupChoice` |
| `online-choice` | game | `online-choice` token | same as `choice` | `setupOnlineChoice` (choice phase, then a watch of the chosen partner) |
| `indicate` | game | `indicate` token | same as `choice` | `setupIndicate` (plays like a watch) |
| `blind` | game | `blind` token | same as `choice` | **not implemented**, see [Known gaps](#known-gaps) |
| `feedback` | meta | `feedback` token | `message`, `demonstrator1`, `demonstrator2`, `transfer: true` | `setupFeedback` (free-text form) |

Transition copy (`overlay-title`, `overlay-message`) is written in `models.py`, not in the client. It talks about expeditions and zones, never sessions and rounds.

### Zone object

```json
{
  "zone_global_index": 3,
  "zone_mode": "asteroid",
  "zone_bandit_arm_image_indexes": [12, 49, 7, 61, 3, 78, 25, 40, 9, 56, 33, 18],
  "zone_bandit": [[0.35, 0.4, 0.55, 0.6, 0.75, 0.1, 0.5, 0.0, 0.8, 0.3, 0.2, 0.45]],
  "bandit_id": "inline_zone_3"
}
```

- `zone_bandit` is a one-row grid of reward probabilities: `bandit_payoffs` from the config, permuted per zone.
- `zone_bandit_arm_image_indexes` are 12 distinct picks from the 80 asteroid images, and no two zones get the same set.
- Zone 0 is the practice zone. End-of-session stages use a virtual zone `1000 + session_index`, so played zones stay consecutively numbered on screen.
- With `bandit_assignment_mode: session_fixed` all rounds of a session share one zone. With `round_changing` every round gets a new one.
- Zone colour and background are not in the timeline. The client derives them at runtime (`generateZoneColor`, `mapZoneBackground` over the asset manifest) and logs the result as `zone_color` and `zone_background`.

### Demonstrator object

```json
{
  "demonstrator_index": 0,
  "demonstrator_session_index": 2,
  "demonstrator_global_index": 13,
  "demonstrator_style": "style4",
  "demonstrator_color": "blue",
  "demonstrator_name": "(a starship name)"
}
```

- `demonstrator_index` is the slot within the session: 0 = demo-1, 1 = demo-2. `demonstrator_global_index` is one of 20 IDs, unique across the whole timeline.
- `demonstrator_name` is present only when `name_demonstrators` is set.
- There is no trajectory in the timeline. Behaviour is generated in the browser (see [Demonstrators](#demonstrators)).

## Client stage dispatch

`loadStage()` in `main.js` is the only entry point for rendering a stage. It calls `clearScene()`, which destroys every display object and kills timers, tweens and loader callbacks. Never replace that with `children.removeAll()`: it leaves hit areas and timers alive across stages.

Adding a stage type:

1. Write `setup<Type>(stage)`.
2. Add a `case` to the switch in `loadStage()`.
3. If it logs, add its `game` value to the enum in `models/gameLog.js`.
4. If it is gameplay, add a label in `showTransitionOverlay()` and include it in `maybeAddSummaryIcon()`.
5. Emit it from `models.py` and document the token in `CONFIG.md`.

The canvas is 1000×600 game units scaled with `Phaser.Scale.FIT`. Colours and fonts for canvas text live in the `THEME` object and mirror the CSS variables in `index.html`. Font family names must be single tokens (`Inter`, `Orbitron`) because Phaser splits the `font` shorthand on spaces. DOM elements placed over the canvas convert coordinates through the canvas bounding rect.

## Demonstrators

### Behaviour: inline Thompson sampling

Partner starships are simulated live in the browser by `ThompsonSampler` (Beta-Bernoulli, α=β=1 priors) over the zone's true payoffs.

- **Warmup.** Before the visible run, the sampler takes `demo_1_prior_experience` or `demo_2_prior_experience` invisible shots. The visible run continues from the warmed-up posterior, so the rewards the participant sees causally drive the actions they see.
- **Pairs are drawn together.** `getZoneDemoTrajectory` draws both partners' runs for a zone the first time either is watched and caches them by session and zone. That lets `demonstrator_filter` (`none`, `expert_gt_novice`, `expert_policy_gt_novice`) reject and redraw the pair, up to `demonstrator_filter_max_attempts` (default 200). The filter is forced to `none` in the practice session.
- **Logging.** When a watch ends, a synthesized `trajectory_complete` row carries the full action and reward arrays (warmup + shown), the payoffs used, the strategy, the filter and how many pairs were drawn.
- `indicate` stages draw their own run with the same sampler and do not use the pair cache.

### Appearance: style + colour

Each demonstrator ID gets a `(style, colour)` pair when the timeline is generated, so the same `demonstrator_global_index` looks identical everywhere it appears. `models.py` enforces two constraints:

- The two demonstrators of a session differ in both style and colour.
- Each `(style, colour)` pair is used at most once per timeline.

Six styles × six colours gives 36 pairs for at most 20 IDs, so the greedy assignment always succeeds. The client only reads the values: `mapDemonstratorImage()` resolves `assets/demonstrators/styles/style{1-6}/{red,orange,blue,green,yellow,purple}.png`. The `demonstrator_XX.png` files next to `styles/` are legacy and unused.

## Participant-facing naming

Code, config, timeline and logs say *session* and *round*. The screen never does:

| In code | On screen |
|---|---|
| session | **expedition** (`EXPEDITION n` top-left, recap slides, end screen) |
| zone | **zone** (`ZONE n` top-right). Rounds are never named. |
| arm pull | **shoot**, shots |
| reward meter | **Reward Tank** |
| per-game totals | the **reward ledger** row under the canvas (`reward_breakdown_display: per_game`) |

The ledger's height is reserved from the timeline before the first stage renders so the canvas never moves. Practice rows read PRACTICE and are dropped when Expedition 1 starts.

## Logging

### Collections

Database `AMGDB`, three Mongoose models:

| Model | File | One row per |
|---|---|---|
| `GameLog` | `models/gameLog.js` | participant action: move, shoot, trajectory end, feedback |
| `Consent` | `models/consent.js` | consent decision (`consented: true` or `false`) |
| `PageUnload` | `models/pageUnload.js` | `beforeunload` event (reload, tab close), with the stage it happened on |

`logToMongoDB(action, extra)` in `main.js` builds every `GameLog` row and hands it to the queue. **Mongoose silently drops any field not declared in the schema**, so when you log something new, add it to `gameLog.js` first. The comments in that file are the authoritative field reference. The table below is for orientation.

### GameLog fields

| Group | Fields |
|---|---|
| Identity | `prolific_id`, `prolific_study_id`, `prolific_session_id`, `uid` (new on every page load), `session_id`, `experiment_id` (basename of `experiment_config`) |
| Progression | `session_index`, `step`, `position`, `action`, `timestamp`, `created_at` |
| Game state | `shots_remaining`, `game`, `game_total_reward`, `user_total_reward`, `reward_generated`, `shot` (true when `action` is `shoot`) |
| Session config | `transfer`, `game_sequence`, `session_condition`, `condition_order` |
| Stage ids | `game_index`, `stage_index`, `round_index` |
| Demonstrator | `demonstrator_session_index`, `demonstrator_index` (0 = demo-1, 1 = demo-2), `demonstrator_global_index`, `demonstrator_id` (image filename), `demonstrator_actions` and `demonstrator_rewards` (JSON strings, warmup + shown), `demonstrator_experience`, `demonstrator_strategy`, `demonstrator_bandit_payoffs` |
| Pair filter | `demonstrator_filter`, `demonstrator_filter_attempts`, `demonstrator_filter_satisfied` |
| Own play | `play_actions`, `play_rewards` (JSON strings, on the `trajectory_complete` row of play games) |
| Zone | `zone_global_index`, `zone_color`, `zone_background`, `zone_bandit` (JSON string), `zone_bandit_id`, `zone_bandit_arm_image_ids` |
| Choice | `choice_demonstrator_id`, `choice_demonstrator_index` (slot chosen), `choice_display_order` (JSON `[slot in left cell, slot in right cell]`) |
| Feedback | `feedback_text` |
| Tracking | `refresh_count` |
| Legacy, null on new rows | `demonstrator_type`, `demonstrator_source`, `choice_demonstrator_type` |

Enums:

- `action`: `left`, `right`, `up`, `down`, `shoot`, `feedback`, `trajectory_complete`
- `game`: `practice-play`, `practice-watch`, `play`, `watch`, `choice`, `indicate`, `blind`, `feedback`, plus the pre-2026-10-19 practice value `practice`

### Things to know when analysing

- **`online-choice` logs as two games.** Its choice phase logs `game: "choice"`, its watch phase `game: "watch"`. No special-casing needed.
- **Practice is prefixed.** Session 0 logs `practice-play` and `practice-watch`. Filter on the prefix or on `session_index == 0`.
- **A choice is moves plus a shoot.** A choice stage logs `left` and `right` rows while the cursor moves and one `shoot` row carrying `choice_demonstrator_id` and `choice_demonstrator_index`.
- **`refresh_count`** is the number of unload events in this Prolific session *before the row was written*. It is stamped at log time and never updated. A reload restarts the study with a new `uid`, so a participant with more than one `uid` reloaded even if every row shows `refresh_count: 0`. The end-of-study redirect is not counted. Each unload is also its own `PageUnload` row.
- **`trajectory_complete`** is one synthesized row per watch or play game with the full arrays. Per-shot rows exist as well.
- **`session_condition` and `condition_order`** are identical on every row of a session and give each participant's shuffled condition order.
- Consent decisions, including declines, live only in `Consent`, keyed by `prolific_id`.

### Delivery guarantees

`enqueueLog` and `flushLogQueue` keep an in-order queue in the browser. Rows are POSTed one at a time with `keepalive`. Network errors and 5xx responses (including the 503 the server returns while MongoDB is disconnected) are retried up to 5 times, with backoff from 500 ms doubling to 4 s. A 4xx (schema rejection) is not retried: the row is dropped and counted. The end screen calls `drainLogQueue(20000)` before showing the Prolific button and warns the participant if anything could not be saved. Consent rows and unload beacons bypass the queue. In demo mode nothing is sent at all.

## HTTP API

| Route | Purpose | Notes |
|---|---|---|
| `GET /` | `index.html` | |
| `GET /main.js` | client bundle | |
| `GET /assets/*`, `GET /vendor/*` | static files | The only static directories. The repo root is deliberately not served because it holds the payoff table. |
| `GET /api/config` | experiment id, display and bonus flags, Prolific URLs, `demonstrator_config` (priors, payoffs, strategy, filter) | built from `config.json` |
| `GET /api/asset-manifest` | PNG listings of `assets/landscapes`, `zone_backgrounds`, `asteroids` | built once at startup |
| `GET /api/timeline` | a fresh timeline | queued when at capacity, 30 s timeout |
| `GET /api/timeline-status` | active, max and queued generations, uptime | |
| `GET /api/health` | status, MongoDB connection state, memory, uptime | |
| `GET /api/test-python` | which Python command works | |
| `POST /api/log` | one `GameLog` row | 503 while MongoDB is disconnected, 400 on schema violation |
| `POST /api/log-refresh` | one `PageUnload` row | sent with `sendBeacon`; same error codes |
| `POST /api/log-consent` | one `Consent` row | same error codes |
| `GET /api/logs/:prolific_id` | all `GameLog` rows for one participant | **404 in production.** Local debugging only. |

## Assets

```
assets/
  asteroids/          80 asteroid PNGs; 12 are picked per zone
  zone_backgrounds/   12 backgrounds, mapped to zones at runtime
  landscapes/          4 PNGs for the landscape zone mode, which the generator no longer emits
  demonstrators/
    styles/style{1-6}/{red,orange,blue,green,yellow,purple}.png
    demonstrator_XX.png   legacy, unused
  introduction/       move.gif, shoot.gif, reward.png, no_reward.png  (npm run capture-howto)
  user.png            the participant's ship
vendor/phaser.min.js
```

## Known gaps

- **`blind` is not implemented in the client.** `models.py` accepts the token and `loadStage()` dispatches it to `setupBlind`, but no function of that name exists in `main.js`. A config that uses `blind` throws at that stage.
