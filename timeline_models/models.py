import random
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
      - zone: {"zone_index": …} (assigned after shuffle)
    """
    if rounds < 1:
        raise ValueError("rounds must be >= 1")

    repeat_block = ["watch", "play", "watch", "play"]
    choice_name = "choice"
    num_watch = repeat_block.count("watch")
    patterns = list(product(["expert", "novice"], repeat=num_watch))
    transfer_options = [True, False]

    # 1) Build all sessions (without session_index or zone)
    sessions: List[List[List[Dict[str, Any]]]] = []
    for pat in patterns:
        for transfer_flag in transfer_options:
            games: List[Dict[str, Any]] = []
            game_idx = 0

            # stage 0: repeated watch/play
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

    # 3) Assign session_index and zone_index according to rules
    zone_index = 0
    for session_index, (games, choice_list) in enumerate(sessions):
        # stage 0 entries get current zone_index
        for entry in games:
            entry["session_index"] = session_index
            entry["zone"] = {"zone_index": zone_index}

        # stage 1: if transfer==True, bump zone before assigning
        if choice_list[0]["transfer"]:
            zone_index += 1

        for entry in choice_list:
            entry["session_index"] = session_index
            entry["zone"] = {"zone_index": zone_index}

        # after finishing this session, always bump zone for next session
        zone_index += 1

    return sessions


if __name__ == "__main__":
    import json

    # e.g. 1 round, 24 pulls for play, 48 pulls for watch
    tl = generate_timeline(rounds=1, num_play_arm_pulls=6, num_watch_arm_pulls=4)
    print(json.dumps(tl, indent=4))