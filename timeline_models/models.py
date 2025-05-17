import random
import colorsys
from itertools import product
from typing import List, Dict, Any, Optional

def generate_timeline(
    rounds: int,
    num_play_arm_pulls: int,
    num_watch_arm_pulls: int
) -> List[List[List[Dict[str, Any]]]]:
    """
    Generate all possible timelines for the fixed game sequence:
      repeat_block = ["watch", "play", "watch", "play"]
      choice = "choice"

    rounds: number of times to run the watch/play block (>= 1)
    num_play_arm_pulls: number to assign to each "play" game
    num_watch_arm_pulls: number to assign to each "watch" game

    Returns:
      [
        [   # one session
            [ {...}, {...}, … ],   # stage_index = 0 (watch/play)
            [ {...} ]              # stage_index = 1 (choice)
        ],
        …
      ]

    Each dict has:
      - game
      - demonstrator (or demonstrator_1, demonstrator_2)
      - game_index
      - num_arm_pulls
      - transfer (None for stage 0, True/False for stage 1)
      - stage_index (0 or 1)
      - session_index (assigned after shuffle)
      - zone: {
          zone_index,
          background,
          color,
          mode,
          images
        }
    """
    if rounds < 1:
        raise ValueError("rounds must be >= 1")

    # 1) Build all raw sessions (no session_index, no final zone metadata)
    repeat_block = ["watch", "play", "watch", "play"]
    choice_name = "choice"
    num_watch = repeat_block.count("watch")
    patterns = list(product(["expert", "novice"], repeat=num_watch))
    transfer_options = [True, False]

    sessions: List[List[List[Dict[str, Any]]]] = []
    for pat in patterns:
        for transfer_flag in transfer_options:
            games: List[Dict[str, Any]] = []
            game_idx = 0
            # stage 0: watch/play
            for _ in range(rounds):
                watch_cursor = 0
                for g in repeat_block:
                    if g == "watch":
                        demonstrator = pat[watch_cursor]
                        num_arm_pulls = num_watch_arm_pulls
                        watch_cursor += 1
                    else:  # "play"
                        demonstrator = None
                        num_arm_pulls = num_play_arm_pulls

                    games.append({
                        "game": g,
                        "demonstrator": demonstrator,
                        "game_index": game_idx,
                        "num_arm_pulls": num_arm_pulls,
                        "transfer": None,
                        "stage_index": 0
                    })
                    game_idx += 1

            # stage 1: choice
            choice_entry = {
                "game": choice_name,
                "demonstrator_1": pat[0],
                "demonstrator_2": pat[1],
                "game_index": game_idx,
                "num_arm_pulls": None,
                "transfer": transfer_flag,
                "stage_index": 1
            }

            sessions.append([games, [choice_entry]])

    # 2) Shuffle sessions
    random.shuffle(sessions)

    # 3) Assign session_index and preliminary zone_index
    zone_idx = 0
    for sess_idx, (games, choice_list) in enumerate(sessions):
        # stage 0: assign session and zone_index
        for entry in games:
            entry["session_index"] = sess_idx
            entry["zone"] = {"zone_index": zone_idx}
        # stage 1: increment zone if transfer True, then assign
        if choice_list[0]["transfer"]:
            zone_idx += 1
        for entry in choice_list:
            entry["session_index"] = sess_idx
            entry["zone"] = {"zone_index": zone_idx}
        # after full session, bump for next
        zone_idx += 1

    # 4) Collect all unique zone_indices
    unique_zones = sorted({
        entry["zone"]["zone_index"]
        for sess in sessions
        for stage in sess
        for entry in stage
    })
    num_zones = len(unique_zones)

    # 5) Generate a distinct color for each zone (as hex)
    colors: List[str] = []
    for i in range(num_zones):
        hue = i / num_zones
        r, g, b = colorsys.hsv_to_rgb(hue, 0.5, 0.95)
        colors.append('#{:02x}{:02x}{:02x}'.format(int(r*255), int(g*255), int(b*255)))

    # 6) Sample 12 unique asteroid images per zone, ensuring no two zones have identical lists
    used_sets = set()
    zone_images: Dict[int, List[str]] = {}
    for idx in unique_zones:
        while True:
            picks = random.sample(range(80), 12)
            tpl = tuple(picks)
            if tpl not in used_sets:
                used_sets.add(tpl)
                break
        zone_images[idx] = [f"asteroid_{i:02d}.png" for i in picks]

    # 7) Build full zone metadata and inject into each entry
    zone_meta: Dict[int, Dict[str, Any]] = {}
    for i, idx in enumerate(unique_zones):
        zone_meta[idx] = {
            "zone_index": idx,
            "background": f"zone_{idx:02d}.png",
            "color": colors[i],
            "mode": "asteroid",
            "images": zone_images[idx]
        }

    for sess in sessions:
        for stage in sess:
            for entry in stage:
                zi = entry["zone"]["zone_index"]
                entry["zone"] = zone_meta[zi]

    return sessions


# Example usage
if __name__ == "__main__":
    import json
    tl = generate_timeline(rounds=1, num_play_arm_pulls=24, num_watch_arm_pulls=48)
    print(json.dumps(tl, indent=4))


if __name__ == "__main__":
    import json

    # e.g. 1 round, 24 pulls for play, 48 pulls for watch
    tl = generate_timeline(rounds=1, num_play_arm_pulls=6, num_watch_arm_pulls=4)
    print(json.dumps(tl, indent=4))