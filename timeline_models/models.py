from itertools import product
from typing import List, Dict, Any, Optional

def generate_timeline(rounds: int) -> List[List[List[Dict[str, Any]]]]:
    """
    Generate all possible timelines for the fixed game sequence:
      repeat_block = ["watch", "play", "watch", "play"]
      choice_block = ["choice"]

    rounds: number of times to run the watch/play block (must be >= 1)

    Returns:
      [
        [   # one pattern
            [ {…}, {…}, … ],   # watch/play entries (repeated `rounds` times)
            [ {…} ]             # single choice entry
        ],
        …                     # one entry per expert/novice pattern
      ]
    """
    if rounds < 1:
        raise ValueError("rounds must be an integer >= 1")

    repeat_block = ["watch", "play", "watch", "play"]
    choice_block = ["choice"]

    # count how many watch slots per repeat
    num_watch = repeat_block.count("watch")
    # all 2^num_watch assignments of expert/novice
    patterns = list(product(["expert", "novice"], repeat=num_watch))

    timeline: List[List[List[Dict[str, Any]]]] = []

    for pat in patterns:
        games: List[Dict[str, Optional[Any]]] = []
        game_idx = 0

        # build the watch/play blocks `rounds` times
        for _ in range(rounds):
            watch_cursor = 0
            for g in repeat_block:
                demonstrator = pat[watch_cursor] if g == "watch" else None
                if g == "watch":
                    watch_cursor += 1

                games.append({
                    "game": g,
                    "demonstrator": demonstrator,
                    "game_index": game_idx
                })
                game_idx += 1

        # append the final choice entry
        choice_entry = {
            "game": choice_block[0],
            "demonstrator_1": pat[0],
            "demonstrator_2": pat[1],
            "game_index": game_idx
        }

        timeline.append([games, [choice_entry]])

    return timeline


# --- example usage ---
if __name__ == "__main__":
    import json
    # rounds = 1: one watch/play block, then the choice
    print(json.dumps(generate_timeline(rounds=3), indent=4))