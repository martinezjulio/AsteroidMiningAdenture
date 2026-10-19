#!/usr/bin/env python3
"""Structural equivalence check: pilot_D_2026-01-20 timelines should reproduce
the OLD pilot's session shape under the new code.

Old pilot (configs/pilot.yaml) produced:
  - practice session at index 0
  - 2 game sessions, each with:
      - 1 demonstrator_presentation stage prepended (present_demonstrators_apriori=true)
      - 12 round-stages = 3 rounds × [watch, play, watch, play]
      - 2 end stages: choice, feedback
  - watch demo indices alternate (0,1,0,1,0,1) within session 1
                              and (1,0,1,0,1,0) within session 2 (or vice versa)
  - zones change per round (round_changing); choice transfers to a new zone
  - num_arm_pulls: 6 for both watch and play

This script regenerates the timeline N times and asserts every invariant.
Run from repo root: `python3 scripts/equivalence_check.py [N]`
"""
import json
import subprocess
import sys
import os


def gen_timeline(idx):
    """Spawn models.py and parse its stdout JSON."""
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    proc = subprocess.run(
        ["python3", "models.py", f"equivalence_check_{idx}"],
        cwd=os.path.join(repo_root, "timeline_models"),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"models.py failed: {proc.stderr}")
    return json.loads(proc.stdout)


def assert_pilot_d_shape(tl, run_idx):
    """Assert every structural invariant the old pilot satisfied."""
    errors = []

    def check(cond, msg):
        if not cond:
            errors.append(msg)

    # Top-level: practice + 2 sessions
    check(len(tl) == 3, f"expected 3 top-level entries, got {len(tl)}")
    practice = tl[0]
    sessions = tl[1:3] if len(tl) >= 3 else []

    # Practice
    check(isinstance(practice, list), "practice should be a flat list")
    practice_types = [s.get("stage_type") or s.get("game") for s in practice]
    check(
        practice_types == ["prolific_id_form", "introduction", "instructions", "practice", "watch", "practice", "practice_end"],
        f"practice shape mismatch: {practice_types}",
    )
    if len(practice) >= 6:
        check(practice[3]["num_arm_pulls"] == 6, "practice play should have 6 pulls")
        check(practice[5]["num_arm_pulls"] == 6, "final practice play should have 6 pulls")
        check(practice[4].get("demonstrator_index") == 1, "practice watch should be the novice (slot 1)")

    # Each session: [games, end_stages]
    seen_demo_orderings = set()
    for s_i, sess in enumerate(sessions, 1):
        check(len(sess) == 2, f"session {s_i}: expected [games, end_stages]")
        if len(sess) != 2:
            continue
        games, end_stages = sess

        # Games: 1 demo_presentation + 12 round games
        check(
            len(games) == 13,
            f"session {s_i}: expected 13 games, got {len(games)}",
        )
        check(
            games[0].get("stage_type") == "demonstrator_presentation",
            f"session {s_i}: first stage should be demonstrator_presentation",
        )
        round_stages = games[1:]
        types = [g.get("game") for g in round_stages]
        check(
            types == ["watch", "play", "watch", "play"] * 3,
            f"session {s_i}: round stages mismatch: {types}",
        )

        # Watch demo indices alternate within each round
        watches = [g for g in round_stages if g.get("game") == "watch"]
        watch_indices = tuple(g.get("demonstrator_index") for g in watches)
        check(
            watch_indices in {(0, 1, 0, 1, 0, 1), (1, 0, 1, 0, 1, 0)},
            f"session {s_i}: unexpected watch demo ordering: {watch_indices}",
        )
        seen_demo_orderings.add(watch_indices)

        # Round indices: 0,0,0,0, 1,1,1,1, 2,2,2,2
        round_indices = [g.get("round_index") for g in round_stages]
        check(
            round_indices == [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
            f"session {s_i}: round_index sequence mismatch: {round_indices}",
        )

        # Zone changes per round (round_changing)
        zones_per_stage = [g["zone"]["zone_global_index"] for g in round_stages]
        check(
            zones_per_stage[0] == zones_per_stage[1] == zones_per_stage[2] == zones_per_stage[3],
            f"session {s_i}: round 0 stages should share a zone",
        )
        check(
            zones_per_stage[0] != zones_per_stage[4],
            f"session {s_i}: round 0 and round 1 should have different zones",
        )
        check(
            zones_per_stage[4] != zones_per_stage[8],
            f"session {s_i}: round 1 and round 2 should have different zones",
        )

        # Pulls counts
        for g in round_stages:
            expected = 6
            actual = g.get("num_arm_pulls")
            check(
                actual == expected,
                f"session {s_i}: stage {g.get('game_index')} expected {expected} pulls, got {actual}",
            )

        # End stages: choice + feedback
        end_types = [s.get("game") or s.get("stage_type") for s in end_stages]
        check(
            end_types == ["choice", "feedback"],
            f"session {s_i}: end stages mismatch: {end_types}",
        )

        # Choice transfers to a new zone
        choice_zone = end_stages[0]["zone"]["zone_global_index"]
        last_round_zone = zones_per_stage[-1]
        check(
            choice_zone != last_round_zone,
            f"session {s_i}: choice should transfer (different zone from last round)",
        )

        # Choice has both demonstrators present
        check(
            "demonstrator1" in end_stages[0] and "demonstrator2" in end_stages[0],
            f"session {s_i}: choice should have demonstrator1 AND demonstrator2",
        )

    # Across sessions, both orderings (0,1,...) and (1,0,...) should appear
    # at least sometimes (since all_conditions_shuffled cycles both conditions).
    # We can't assert this on a single run, but it should be true across many.
    return errors, seen_demo_orderings


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    print(f"Running pilot_D_2026-01-20 equivalence check × {n}…")
    all_orderings = set()
    total_errors = 0
    for i in range(n):
        tl = gen_timeline(i)
        errors, orderings = assert_pilot_d_shape(tl, i)
        all_orderings |= orderings
        if errors:
            total_errors += len(errors)
            print(f"\n  RUN {i}: FAIL ({len(errors)} errors)")
            for e in errors:
                print(f"    - {e}")
        else:
            print(f"  run {i}: ok", end="\r")

    print()
    print(f"\nUnique watch demo orderings observed: {sorted(all_orderings)}")
    if total_errors:
        print(f"\nFAIL: {total_errors} structural errors across {n} runs")
        sys.exit(1)
    else:
        # We expect both (0,1,...) and (1,0,...) to appear over many runs
        # since the pilot has both [watch-d1, play, watch-d2, play] and the swap.
        if len(all_orderings) < 2 and n >= 5:
            print(f"WARN: only saw {len(all_orderings)} distinct orderings across "
                  f"{n} runs — the two conditions may not be balanced (run more iterations to confirm)")
        print(f"PASS: all {n} runs satisfied pilot_D structural invariants")


if __name__ == "__main__":
    main()
