import json
import random
import colorsys
from itertools import product
from typing import List, Dict, Any, Optional

def generate_timeline(
    rounds: int,
    num_play_arm_pulls: int,
    num_watch_arm_pulls: int,
    bandits_json_path: str = "bandits_data.json"
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
    transfer_options = [True, False]

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
            }
            raw_sessions.append([games, [choice]])

    # 2) shuffle & assign session_index, zone_index starting at 1
    random.shuffle(raw_sessions)
    zone_idx = 1
    for sess_i, (games, [choice]) in enumerate(raw_sessions, start=1):
        for e in games:
            e["session_index"] = sess_i
            e["zone"] = {"zone_index": zone_idx}
        if choice["transfer"]:
            zone_idx += 1
        choice["session_index"] = sess_i
        choice["zone"] = {"zone_index": zone_idx}
        zone_idx += 1

    # 3) collect all zone_indices (include 0 for practice)
    all_zones = {0}
    for sess in raw_sessions:
        for stage in sess:
            for e in stage:
                all_zones.add(e["zone"]["zone_index"])
    unique_zones = sorted(all_zones)

    # 4) sample payoff key per zone
    if len(unique_zones) > len(payoff_keys):
        raise RuntimeError("Not enough payoff keys")
    chosen = random.sample(payoff_keys, len(unique_zones))
    zone_to_payoff = dict(zip(unique_zones, chosen))

    # 5) generate colors & asteroid images
    num_z = len(unique_zones)
    colors = []
    for i in range(num_z):
        h = i / num_z
        r, g, b = colorsys.hsv_to_rgb(h, 0.5, 0.95)
        colors.append(f'#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}')
    used_sets = set()
    zone_images: Dict[int, List[str]] = {}
    for idx in unique_zones:
        while True:
            picks = random.sample(range(80), 12)
            if tuple(picks) not in used_sets:
                used_sets.add(tuple(picks))
                break
        zone_images[idx] = [f"asteroid_{p:02d}.png" for p in picks]

    # 6) build full zone metadata
    zone_meta: Dict[int, Dict[str, Any]] = {}
    for i, z in enumerate(unique_zones):
        pk = zone_to_payoff[z]
        zone_meta[z] = {
            "zone_index": z,
            "zone_background": f"zone_{z:02d}.png",
            "zone_color": colors[i],
            "zone_mode": "asteroid",
            "zone_images": zone_images[z],
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
        payoff_key = zone_to_payoff[games[0]["zone"]["zone_index"]]

        # Track demonstrators seen in this session to determine if they're "new" or "previously seen"
        seen_demonstrators = set()

        # stage0 entries with corrected overlay logic
        prev_zone = None
        for i, e in enumerate(games):
            z = e["zone"]["zone_index"]
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
                    "demonstrator_index": dem_idx,
                    "demonstrator_id": did,
                    "demonstrator_image": f"demonstrator_{did:02d}.png",
                    "demonstrator_trajectory": traj
                }
                
                # Check if this demonstrator has been seen before in this session
                if did in seen_demonstrators:
                    # Previously seen demonstrator
                    parts.append(
                        "You will watch one of the starship partners you have seen before play again. "
                        "Pay close attention to your partner's choices."
                    )
                else:
                    # New demonstrator
                    parts.append(
                        "In this game you will watch a new starship partner play the game. "
                        "Pay close attention to your partner's choices."
                    )
                    seen_demonstrators.add(did)
                
            elif e["game"] == "play":
                parts.append(
                    "In this game you will get to play and mine for rewards. "
                    "Try to get as much reward as possible by discovering the best asteroid to mine from."
                )

            e["overlay-message"] = " ".join(parts)
            prev_zone = z

        # choice entry: nested demonstrators without trajectories
        cz = choice["zone"]["zone_index"]
        choice["zone"] = zone_meta[cz]
        for i_key, key in enumerate(("demonstrator_1", "demonstrator_2")):
            typ = choice[key]
            did = dem_ids[i_key]
            choice[f"demonstrator{i_key+1}"] = {
                "demonstrator_type": typ,
                "demonstrator_index": i_key,
                "demonstrator_id": did,
                "demonstrator_image": f"demonstrator_{did:02d}.png"
            }
            del choice[key]

        # choice overlay-message with updated format
        parts = ["You will now choose between one of the starships you watched during this session."]
        last_zone = games[-1]["zone"]["zone_index"]
        if cz == last_zone:
            transfer_text = "in the same zone"
        else:
            transfer_text = "in a new zone you've never been to before"
        
        parts.append(f"Choose the starship you would watch before playing again to achieve higher rewards {transfer_text}.")
        choice["overlay-message"] = " ".join(parts)

    # 9) fixed practice session
    practice_zone = zone_meta[0]
    practice_session = [
        {"stage_type": "prolific_id_form", "message": "Please enter your Prolific ID below:"},
        {
            "stage_type": "introduction",
            "message": "Welcome to fortune frontier the asteroid mining adventure.\n\nPlayers navigate the Asteroid Belt of Fortune, piloting the ship *Prospector One* to mine asteroids, each with unknown rewards. The game combines strategy and luck, as players decide which asteroids to mine. Players guide their starship through the different zones of the asteroid belt, making strategic choices to strike asteroids with potential for high payoffs. Each zone introduces your starship to new asteroids with different payoffs than the zones before it. Success fills the mining tank with celestial wealth. Throughout the game you will observe and learn from other starships to improve your chances of becoming the galaxy's greatest miner.\n\nWelcome to \"Asteroid Fortune Frontier\" – where the universe is yours to mine.\n\n[RED_BOLD]Note: please refrain from refreshing/reloading your web browser for the remainder of this game! Also please do not go back to previous pages. This will corrupt results. Thank you![/RED_BOLD]",
            "instructions": {
                "instruction1": "move left with left arrow",
                "instruction1_image": "move_left.gif",
                "instruction2": "move right with right arrow",
                "instruction2_image": "move_right.gif",
                "instruction3": "mine rewards with spacebar",
                "instruction3_image": "mine.gif",
                "instruction4": "green indicates successful mining\n(increases reward)",
                "instruction4_image": "successful_mine.png",
                "instruction5": "red indicates unsuccessful mining\n(no reward)",
                "instruction5_image": "unsuccessful_mine.png",
                "instruction6": "Rewards are probabilistic meaning that mining from any asteroid will sometimes yield reward and sometimes yield no reward. Your goal is to find and mine from the asteroids that yield reward most often as much as you can!"
            }
        },
        {
            "stage_type": "instructions",
            "message": "Game Instructions",
            "instructions": {
                "instruction1": "move left with left arrow",
                "instruction1_image": "move_left.gif",
                "instruction2": "move right with right arrow",
                "instruction2_image": "move_right.gif",
                "instruction3": "mine rewards with spacebar",
                "instruction3_image": "mine.gif",
                "instruction4": "green indicates successful mining\n(increases reward)",
                "instruction4_image": "successful_mine.png",
                "instruction5": "red indicates unsuccessful mining\n(no reward)",
                "instruction5_image": "unsuccessful_mine.png",
                "instruction6": "Rewards are probabilistic meaning that mining from any asteroid will sometimes yield reward and sometimes yield no reward. Your goal is to find and mine from the asteroids that yield reward most often as much as you can!"
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
            "zone": practice_zone
        }
    ]

    # 10) return full timeline
    return [practice_session] + raw_sessions


if __name__ == "__main__":
    import json

    # e.g. 1 round, 24 pulls for play, 48 pulls for watch
    tl = generate_timeline(rounds=2, num_play_arm_pulls=6, num_watch_arm_pulls=6)
    print(json.dumps(tl, indent=4))
    with open('../data/timeline.json', 'w') as f: json.dump(tl, f, indent=4)