# Paying Prolific bonuses after a study closes

The game never talks to Prolific. It shows participants `TOTAL REWARD × bonus_per_reward`
on the end screen and logs every shot to Mongo. The bonus itself is reconstructed from
those logs by `scripts/export-bonuses.js`, which produces the list you paste into
Prolific's bulk bonus dialog. Nothing is paid until you click Pay Bonuses on Prolific.

## 1. Finish reviewing submissions on Prolific first

Approve or reject every submission before paying bonuses. Prolific pays a bonus to any
submission status and cannot refund it, so a rejected participant still gets paid if
their line is in the list.

Participants who declined consent never reach a play game, so they are absent from the
export. They appear only in the `Consent` collection (`consented: false`) and were sent to
the study's "No consent" completion path: request a return on those submissions rather
than rejecting them (un-reviewed submissions auto-approve after 21 days).

## 2. Point the script at the production database

`.env` normally holds the localhost URI. Temporarily set it to the Atlas connection
string (the value of the `MONGODB_URI` secret in Secret Manager):

```bash
gcloud secrets versions access latest --secret=MONGODB_URI
```

Edit `.env`:

```
MONGODB_URI=mongodb+srv://...   # Atlas, from the command above
```

Switch it back to `mongodb://localhost:27017/AMGDB` when you are done.

## 3. Run the export

Copy the study ID from the study's page on Prolific (also in the study URL), then:

```bash
npm run export-bonuses -- --study <STUDY_ID>
```

Options:

- `--study` restricts to one Prolific study. Omit it to export every study in the
  database (useful if participants ran under a test study you also want to pay).
- `--experiment` restricts to one `experiment_id` (defaults to the active config's file
  name, e.g. `pilot_E.yaml`). Pass `--experiment ""` to ignore it.
- `--rate 0.02` overrides `bonus_per_reward` from `config.json`. Keep it equal to what
  participants were shown on the end screen.
- `--out path.csv` changes the output file (default `exports/bonuses_<date>.csv`;
  `exports/` is gitignored because it holds participant data).

## 4. Review the console table

One row per participant:

| column | meaning |
|---|---|
| `total_reward` | rewarded shots across all expeditions (what the end screen showed) |
| `play_shots` | shots taken in play games; a full pilot E run is 96 |
| `games` | finished / started play games; anything but `n/n` means a refresh or drop-out |
| `sessions` | expeditions with at least one play shot, e.g. `1,2,3` |
| `bonus` | `total_reward × rate`, two decimals |
| `last_played` | UTC timestamp of their last play row |

Below the table:

- **Skipped** participants have no Prolific `SESSION_ID` (they did not arrive via the
  study link, e.g. your own test runs). They are not written to the file.
- **WARNING** lines flag unfinished games or a mismatch between rewarded shots and the
  client's running total. Open the raw rows for that participant before paying.
- The **grand total** is what Prolific should show, before its service fee.

Open the CSV and delete the line of any submission you rejected. Each line is
`<submission_id>,<amount>`; the submission ID is Prolific's `SESSION_ID` URL parameter,
one per participant per study (not one of the game's three expeditions).

## 5. Paste into Prolific

1. Open the study on Prolific and go to its submissions list.
2. Bulk actions → Bulk bonus payment.
3. Paste the contents of the CSV.
4. Compare Prolific's total with the script's grand total (Prolific adds its fee on top).
5. Pay Bonuses.

Paste the list only once. Re-paste only if Prolific reports that the payment failed.
Prolific's help article: https://researcher-help.prolific.com/en/articles/445233-how-do-i-send-bonus-payments

## How the number is computed

`scripts/export-bonuses.js` aggregates log rows with `game: "play"` (practice and watch
never count). Each shoot row carries `reward_generated`, so the total is the count of
rewarded play shots per participant. That holds regardless of `total_reward_scope` and
whether the participant finished. As a cross-check the script also sums the client's
per-game `game_total_reward` (complete only on the `trajectory_complete` row, since
shoot rows are logged before the tally is incremented) and warns if the two differ.
