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
    patterns = list(product(["expert","novice"], repeat=num_watch_slots))
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
    zone_images: Dict[int,List[str]] = {}
    for idx in unique_zones:
        while True:
            picks = random.sample(range(80), 12)
            if tuple(picks) not in used_sets:
                used_sets.add(tuple(picks))
                break
        zone_images[idx] = [f"asteroid_{p:02d}.png" for p in picks]

    # 6) build full zone metadata
    zone_meta: Dict[int,Dict[str,Any]] = {}
    for i, z in enumerate(unique_zones):
        pk = zone_to_payoff[z]
        zone_meta[z] = {
            "zone_index": z,
            "zone_background": f"zone_{z:02d}.png",
            "zone_color": colors[i],
            "zone_mode": "asteroid",
            "zone_images": zone_images[z],
            "zone_bandit": [ bandits_data[pk]["payoffs"] ],
            "bandit_id": pk
        }

    # 7) assign demonstrator_ids per session
    available_ids = list(range(20))
    random.shuffle(available_ids)
    session_to_ids: Dict[int,List[int]] = {}
    for sess_i in range(1, len(raw_sessions)+1):
        session_to_ids[sess_i] = [ available_ids.pop(), available_ids.pop() ]

    # 8) inject zone_meta, build watch demonstrators, and now also choice demonstrator objects
    for games, [choice] in raw_sessions:
        sess_i = games[0]["session_index"]
        dem_ids = session_to_ids[sess_i]
        payoff_key = zone_to_payoff[ games[0]["zone"]["zone_index"] ]

        # stage0 entries
        for e in games:
            z = e["zone"]["zone_index"]
            e["zone"] = zone_meta[z]
            if e["game"] == "watch":
                typ = e["demonstrator"]
                pos = e["game_index"] % len(repeat_block)
                dem_idx = 0 if pos < 2 else 1
                did = dem_ids[dem_idx]
                full = bandits_data[payoff_key]["policy"]["thompson"][typ]\
                       [f"{payoff_key}_{typ}_policy{did}"]
                start = e["round_index"] * num_watch_arm_pulls
                traj = full[start:start+num_watch_arm_pulls]
                e["demonstrator"] = {
                    "demonstrator_type": typ,
                    "demonstrator_index": dem_idx,
                    "demonstrator_id": did,
                    "demonstrator_image": f"demonstrator_{did:02d}.png",
                    "demonstrator_trajectory": traj
                }

        # choice entry: replace demonstrator_1/2 with nested objects
        for i_key, key in enumerate(("demonstrator_1","demonstrator_2")):
            typ = choice[key]
            did = dem_ids[i_key]
            choice[f"demonstrator{i_key+1}"] = {
                "demonstrator_type": typ,
                "demonstrator_index": i_key,
                "demonstrator_id": did,
                "demonstrator_image": f"demonstrator_{did:02d}.png"
            }
            del choice[key]

        # inject full zone for choice
        cz = choice["zone"]["zone_index"]
        choice["zone"] = zone_meta[cz]

    # 9) build fixed practice session at index 0
    practice_zone = zone_meta[0]
    practice_session = [
        {"stage_type":"prolific_id_form","message":"Please enter your Prolific ID below:"},
        {"stage_type":"introduction","message":"Welcome to the mining expedition! Here's the backstory..."},
        {
            "game":"practice","demonstrator":None,"game_index":0,
            "num_arm_pulls":num_play_arm_pulls,"transfer":None,
            "stage_index":0,"round_index":0,"session_index":0,
            "zone": practice_zone
        }
    ]

    return [practice_session] + raw_sessions


if __name__ == "__main__":
    import json

    # e.g. 1 round, 24 pulls for play, 48 pulls for watch
    tl = generate_timeline(rounds=1, num_play_arm_pulls=6, num_watch_arm_pulls=4)
    print(json.dumps(tl, indent=4))
    with open('timeline.json', 'w') as f: json.dump(tl, f, indent=4)