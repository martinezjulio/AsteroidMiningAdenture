import json
import random
import colorsys
from itertools import product
from typing import List, Dict, Any, Optional

def generate_timeline(
    rounds: int,
    num_play_arm_pulls: int,
    num_watch_arm_pulls: int,
    bandits_json_path: str = "bandits_data.json",
    bandit_assignment_mode: str = "session_fixed"
) -> List[Any]:
    # 0) load bandit data
    with open(bandits_json_path, "r") as f:
        bandits_data = json.load(f)
    payoff_keys = sorted(k for k in bandits_data if k.startswith("payoffs"))
    if rounds < 1:
        raise ValueError("rounds must be >= 1")

    # 1) build raw bandit sessions
    repeat_block = ["watch", "play", "watch", "play"]
    choice_name = "choice"
    num_watch_slots = repeat_block.count("watch")
    patterns = list(product(["expert", "novice"], repeat=num_watch_slots))
    transfer_options = [True]  # , False]  # Commented out "same zone" option

    raw_sessions: List[List[List[Dict[str, Any]]]] = []
    for pat in patterns:
        for xfer in transfer_options:
            games: List[Dict[str, Any]] = []
            idx = 0
            for round_idx in range(rounds):
                watch_cursor = 0
                for g in repeat_block:
                    if g == "watch":
                        dem_type = pat[watch_cursor]
                        pulls = num_watch_arm_pulls
                        watch_cursor += 1
                    else:
                        dem_type = None
                        pulls = num_play_arm_pulls

                    games.append({
                        "game": g,
                        "demonstrator": dem_type,
                        "game_index": idx,
                        "num_arm_pulls": pulls,
                        "transfer": None,
                        "stage_index": 0,
                        "round_index": round_idx,
                        "session_total_rounds": rounds,
                    })
                    idx += 1

            choice = {
                "game": choice_name,
                "demonstrator_1": pat[0],
                "demonstrator_2": pat[1],
                "game_index": idx,
                "num_arm_pulls": None,
                "transfer": xfer,
                "stage_index": 1,
                "round_index": None,
                "session_total_rounds": rounds,
            }
            raw_sessions.append([games, [choice]])

    # 2) shuffle & select half of sessions, then assign session_index, zone_index starting at 1
    random.shuffle(raw_sessions)
    # Select only half the sessions for each player
    half_count = len(raw_sessions) // 2
    raw_sessions = raw_sessions[:half_count]
    zone_idx = 1
    
    for sess_i, (games, [choice]) in enumerate(raw_sessions, start=1):
        if bandit_assignment_mode == "session_fixed":
            # Current behavior: same zone for entire session
            for e in games:
                e["session_index"] = sess_i
                e["zone"] = {"zone_global_index": zone_idx}
        elif bandit_assignment_mode == "round_changing":
            # New behavior: different zone for each round
            current_round = -1
            round_zone_idx = zone_idx
            for e in games:
                e["session_index"] = sess_i
                if e["round_index"] != current_round:
                    current_round = e["round_index"]
                    # Each new round gets a new zone
                    e["zone"] = {"zone_global_index": round_zone_idx}
                    round_zone_idx += 1
                else:
                    # Same round, same zone
                    e["zone"] = {"zone_global_index": round_zone_idx - 1}
            # Update zone_idx to account for all rounds used
            zone_idx = round_zone_idx
        else:
            raise ValueError(f"Invalid bandit_assignment_mode: {bandit_assignment_mode}")
            
        if choice["transfer"]:
            zone_idx += 1
        choice["session_index"] = sess_i
        choice["zone"] = {"zone_global_index": zone_idx}
        zone_idx += 1

    # 3) collect all zone_indices (include 0 for practice)
    all_zones = {0}
    for sess in raw_sessions:
        for stage in sess:
            for e in stage:
                all_zones.add(e["zone"]["zone_global_index"])
    unique_zones = sorted(all_zones)

    # 4) sample payoff key per zone
    if len(unique_zones) > len(payoff_keys):
        raise RuntimeError("Not enough payoff keys")
    chosen = random.sample(payoff_keys, len(unique_zones))
    zone_to_payoff = dict(zip(unique_zones, chosen))

    # 5) generate asteroid image indexes (no colors or backgrounds here)
    used_sets = set()
    zone_bandit_arm_indexes: Dict[int, List[int]] = {}
    for idx in unique_zones:
        while True:
            picks = random.sample(range(80), 12)
            if tuple(picks) not in used_sets:
                used_sets.add(tuple(picks))
                break
        zone_bandit_arm_indexes[idx] = picks

    # 6) build full zone metadata
    zone_meta: Dict[int, Dict[str, Any]] = {}
    for i, z in enumerate(unique_zones):
        pk = zone_to_payoff[z]
        zone_meta[z] = {
            "zone_global_index": z,
            "zone_mode": "asteroid",
            "zone_bandit_arm_image_indexes": zone_bandit_arm_indexes[z],
            "zone_bandit": [bandits_data[pk]["payoffs"]],
            "bandit_id": pk
        }

    # 7) assign demonstrator_ids per session
    available_ids = list(range(20))
    random.shuffle(available_ids)
    session_to_ids: Dict[int, List[int]] = {}
    for sess_i in range(1, len(raw_sessions) + 1):
        session_to_ids[sess_i] = [available_ids.pop(), available_ids.pop()]

    # 8) inject zone_meta & demonstrator dicts & overlay-messages
    for games, [choice] in raw_sessions:
        sess_i = games[0]["session_index"]
        dem_ids = session_to_ids[sess_i]
        payoff_key = zone_to_payoff[games[0]["zone"]["zone_global_index"]]

        # Track demonstrators seen in this session to determine if they're "new" or "previously seen"
        seen_demonstrators = set()

        # stage0 entries with corrected overlay logic
        prev_zone = None
        for i, e in enumerate(games):
            z = e["zone"]["zone_global_index"]
            e["zone"] = zone_meta[z]

            parts: List[str] = []
            if i == 0:
                parts.append("This is a new session!")
                parts.append("You will now enter a new zone.")
            else:
                if z != prev_zone:
                    parts.append("You will now enter a new zone.")
                else:
                    parts.append("You will continue in the same zone.")

            if e["game"] == "watch":
                typ = e["demonstrator"]
                pos = e["game_index"] % len(repeat_block)
                dem_idx = 0 if pos < 2 else 1
                did = dem_ids[dem_idx]
                full = bandits_data[payoff_key]["policy"]["thompson"][typ][
                    f"{payoff_key}_{typ}_policy{did}"
                ]
                start = e["round_index"] * num_watch_arm_pulls
                traj = full[start : start + num_watch_arm_pulls]
                e["demonstrator"] = {
                    "demonstrator_type": typ,
                    "demonstrator_session_index": dem_idx,
                    "demonstrator_global_index": did,
                    "demonstrator_trajectory": traj
                }
                
                # Check if this demonstrator has been seen before in this session
                if did in seen_demonstrators:
                    # Previously seen demonstrator
                    parts.append(
                        "You will watch the starship partner shown below play again. "
                        "Pay close attention to your partner's choices."
                    )
                else:
                    # New demonstrator
                    parts.append(
                        "In this game you will watch a new starship partner (shown below) play the game. "
                        "Pay close attention to your partner's choices."
                    )
                    seen_demonstrators.add(did)
                
                # Add secondary overlay message for all watch games
                e["secondary-overlay-message"] = (
                    "Remember: Some starship partners have experience in every zone while the other starships have no experience in any zone."
                )
                
            elif e["game"] == "play":
                parts.append(
                    "In this game you will get to play and mine for rewards. "
                    "Try to get as much reward as possible by discovering the best asteroid to mine from."
                )

            e["overlay-message"] = " ".join(parts)
            prev_zone = z

        # choice entry: nested demonstrators without trajectories
        cz = choice["zone"]["zone_global_index"]
        choice["zone"] = zone_meta[cz]
        for i_key, key in enumerate(("demonstrator_1", "demonstrator_2")):
            typ = choice[key]
            did = dem_ids[i_key]
            choice[f"demonstrator{i_key+1}"] = {
                "demonstrator_type": typ,
                "demonstrator_session_index": i_key,
                "demonstrator_global_index": did
            }
            del choice[key]

        # choice overlay-message with updated format
        parts = [
            "You will now choose between one of the starships you watched during this session."
        ]
        last_zone = games[-1]["zone"]["zone_global_index"]
        if cz == last_zone:
            transfer_text = "in the same zone"
        else:
            transfer_text = "in a new zone you've never been to before"
        
        parts.append(
            f"Choose the starship you would watch before playing again to achieve higher rewards {transfer_text}."
        )
        choice["overlay-message"] = " ".join(parts)

    # 9) fixed practice session
    practice_zone = zone_meta[0]
    practice_session = [
        {"stage_type": "prolific_id_form", "message": "Please enter your Prolific ID below:"},
        {
            "stage_type": "introduction",
            "message": (
                "Welcome to \"Asteroid Fortune Frontier\" the asteroid mining adventure.\n\n"
                "[BOLD]PLEASE READ CAREFULLY:[/BOLD]\n\n"
                "As a player you will pilot a starship to mine ASTEROIDS by shooting them. "
                "Some asteroids yield rewards more often than others. These reward rates are unknown to you. \n\n"
                "YOUR GOAL IS FIND THE ASTEROID THAT YIELDS REWARD MOST OFTEN AND MINE FROM IT AS MUCH AS POSSIBLE!  \n\n "
                "You will encounter multiple asteroid ZONES each indicated by a zone number. "
                "Sometimes you will repeat the same zone with the same reward payoffs. "
                "Sometimes you will move into new zones with new asteroids and new unknown reward payoffs.\n\n "
                "You will also have starship PARTNERS to learn from. Some starship partners have experience in every zone while the others have none. "
                "You will not be told your partners experience level but pay close attention and try to learn from their choices. \n\n"
                "Welcome to \"Asteroid Fortune Frontier\" – where the universe is yours to mine.\n\n"
                "[RED_BOLD]DO NOT RELOAD PAGE AT ANY TIME DURING GAME![/RED_BOLD]"
            ),
            "instructions": {
                "instruction1": "move left with left arrow",
                "instruction1_image": "move_left.gif",
                "instruction2": "move right with right arrow",
                "instruction2_image": "move_right.gif",
                "instruction3": "mine rewards by shooting with spacebar",
                "instruction3_image": "mine.gif",
                "instruction4": "green indicates successful mining\n(increases reward)",
                "instruction4_image": "successful_mine.png",
                "instruction5": "red indicates unsuccessful mining\n(no reward)",
                "instruction5_image": "unsuccessful_mine.png",
                "instruction6": (
                    "You mine rewards from asteroids by shooting them. "
                    "Some asteroids yield reward more often than others. "
                    "Get optimal rewards by finding the asteroids that yield reward often!"
                )
            }
        },
        {
            "stage_type": "instructions",
            "message": "Game Instructions",
            "instructions": {
                "instruction1": "← move left key",
                "instruction1_image": "move_left.gif",
                "instruction2": "→ move right key",
                "instruction2_image": "move_right.gif",
                "instruction3": "shoot asteroids with spacebar",
                "instruction3_image": "mine.gif",
                "instruction4": "green\nindicates reward",
                "instruction4_image": "successful_mine.png",
                "instruction5": "red\nindicates no reward",
                "instruction5_image": "unsuccessful_mine.png",
                "instruction6": (
                    "You mine rewards from asteroids by shooting them. "
                    "To get optimal rewards find the asteroid in each zone that yields rewards most often and mine from it as much as you can!"
                )
            }
        },
        {
            "game": "practice",
            "demonstrator": None,
            "game_index": 0,
            "num_arm_pulls": num_play_arm_pulls,
            "transfer": None,
            "stage_index": 0,
            "round_index": 0,
            "session_index": 0,
            "session_total_rounds": 0,
            "zone": practice_zone
        }
    ]

    # 10) return full timeline
    return [practice_session] + raw_sessions


if __name__ == "__main__":
    import json
    import sys

    # Read config to determine bandit assignment mode
    try:
        with open('../config.json', 'r') as f:
            config = json.load(f)
        bandit_mode = config.get('bandit_assignment_mode', 'session_fixed')
    except Exception as e:
        # Write to stderr so it doesn't interfere with stdout JSON
        print(f"Warning: Could not read config.json, using default mode: {e}", file=sys.stderr)
        bandit_mode = 'session_fixed'  # fallback

    # Get request ID from command line arguments for unique file naming
    request_id = None
    if len(sys.argv) > 1:
        request_id = sys.argv[1]
    else:
        # Fallback to timestamp if no request_id provided
        import time
        request_id = f"timeline_{int(time.time())}"

    # e.g. 3 rounds, 6 pulls for play, 6 pulls for watch
    tl = generate_timeline(
        rounds=3, 
        num_play_arm_pulls=6, 
        num_watch_arm_pulls=6,
        bandit_assignment_mode=bandit_mode
    )
    
    # Output JSON to stdout for the Node.js server to capture
    print(json.dumps(tl))
    
    # Also save to file for backup/debugging with unique filename
    try:
        backup_filename = f'../configs/timeline_{request_id}.json'
        with open(backup_filename, 'w') as f: 
            json.dump(tl, f, indent=4)
    except Exception as e:
        # Don't fail if we can't write to file, just continue
        # Write to stderr so it doesn't interfere with stdout JSON
        print(f"Warning: Could not write backup file: {e}", file=sys.stderr)
        pass