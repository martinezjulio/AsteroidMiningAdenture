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

    rounds: number of times to run the watch/play block (must be >= 1)
    num_play_arm_pulls: number to assign to each "play" game
    num_watch_arm_pulls: number to assign to each "watch" game

    Returns:
      [
        [   # session 0
            [ {…}, {…}, … ],   # stage_index = 0: repeated watch/play entries
            [ {…} ]             # stage_index = 1: single choice entry
        ],
        [   # session 1
            … 
        ],
        …
      ]

    Each dict in the timeline has keys:
      - game
      - demonstrator (or demonstrator_1, demonstrator_2 for choice)
      - game_index
      - num_arm_pulls
      - transfer
      - session_index
      - stage_index
    """
    if rounds < 1:
        raise ValueError("rounds must be an integer >= 1")

    repeat_block = ["watch", "play", "watch", "play"]
    choice_name = "choice"

    num_watch = repeat_block.count("watch")
    patterns = list(product(["expert", "novice"], repeat=num_watch))
    transfer_options = [True, False]

    timeline: List[List[List[Dict[str, Any]]]] = []
    session_index = 0

    for pat in patterns:
        for transfer_flag in transfer_options:
            games: List[Dict[str, Any]] = []
            game_idx = 0

            # build the repeated watch/play stages (stage_index = 0)
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
                        "session_index": session_index,
                        "stage_index": 0
                    })
                    game_idx += 1

            # build the choice stage (stage_index = 1)
            choice_entry: Dict[str, Any] = {
                "game": choice_name,
                "demonstrator_1": pat[0],
                "demonstrator_2": pat[1],
                "game_index": game_idx,
                "num_arm_pulls": None,
                "transfer": transfer_flag,
                "session_index": session_index,
                "stage_index": 1
            }

            timeline.append([games, [choice_entry]])
            session_index += 1

    return timeline

if __name__ == "__main__":
    import json

    # e.g. 1 round, 24 pulls for play, 48 pulls for watch
    tl = generate_timeline(rounds=1, num_play_arm_pulls=6, num_watch_arm_pulls=4)
    print(json.dumps(tl, indent=4))