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
) -> List[List[List[Dict[str, Any]]]]:
    """
    rounds: how many times to repeat ["watch","play","watch","play"]  (>=1)
    num_play_arm_pulls: arms pulled in each "play"
    num_watch_arm_pulls: arms pulled in each "watch"
    bandits_json_path: path to your bandits_data.json

    Returns:
      sessions: List of sessions.  Each session is [ stage0_list, [choice_entry] ].
      Each entry in stage0 or choice has keys:
        - game, game_index, num_arm_pulls, transfer, stage_index,
          session_index, round_index
        - zone: {
            zone_index,
            background,
            color,
            mode,
            images,
            bandit   # [[p0,p1,…,p11]]
          }
      + for each "watch" entry, replaces "demonstrator":str with a dict:
        {
          type, demonstrator_index, demonstrator_id, image, trajectory
        }
    """
    # 0) load your bandit payoffs
    with open(bandits_json_path, "r") as f:
        bandits_data = json.load(f)
    payoff_keys = sorted(k for k in bandits_data.keys() if k.startswith("payoffs"))
    if rounds < 1:
        raise ValueError("rounds must be >= 1")

    # 1) build raw sessions (no session_index, no zones yet)
    repeat_block = ["watch", "play", "watch", "play"]
    choice_name = "choice"
    num_watch_slots = repeat_block.count("watch")
    patterns = list(product(["expert","novice"], repeat=num_watch_slots))
    transfer_options = [True, False]

    raw_sessions: List[List[List[Dict[str,Any]]]] = []
    for pat in patterns:
        for xfer in transfer_options:
            games = []
            idx = 0
            # stage0: watch/play
            for round_idx in range(rounds):
                watch_cursor = 0
                for g in repeat_block:
                    if g=="watch":
                        dem_type = pat[watch_cursor]
                        pulls = num_watch_arm_pulls
                        watch_idx = watch_cursor
                        watch_cursor += 1
                    else:
                        dem_type = None
                        pulls = num_play_arm_pulls
                        watch_idx = None

                    games.append({
                        "game": g,
                        "demonstrator": dem_type,
                        "game_index": idx,
                        "num_arm_pulls": pulls,
                        "transfer": None,
                        "stage_index": 0,
                        "round_index": round_idx,
                        # session_index, zone, demonstrator dict filled later
                    })
                    idx += 1

            # choice stage
            choice = {
                "game": choice_name,
                "demonstrator_1": pat[0],
                "demonstrator_2": pat[1],
                "game_index": idx,
                "num_arm_pulls": None,
                "transfer": xfer,
                "stage_index": 1,
                "round_index": None
            }
            raw_sessions.append([games, [choice]])

    # 2) shuffle
    random.shuffle(raw_sessions)

    # 3) assign session_index & preliminary zone_index
    zone_idx = 0
    for sess_i, (games, [choice]) in enumerate(raw_sessions):
        # stage0
        for e in games:
            e["session_index"] = sess_i
            e["zone"] = {"zone_index": zone_idx}
        # choice
        if choice["transfer"]:
            zone_idx += 1
        choice["session_index"] = sess_i
        choice["zone"] = {"zone_index": zone_idx}
        zone_idx += 1

    # 4) collect and map zones → unique payoff key
    all_zones = sorted({e["zone"]["zone_index"]
                        for sess in raw_sessions
                        for stage in sess
                        for e in stage})
    if len(all_zones) > len(payoff_keys):
        raise RuntimeError("Not enough payoffX keys for all zones!")
    sel_payoffs = random.sample(payoff_keys, k=len(all_zones))
    zone_to_payoff = dict(zip(all_zones, sel_payoffs))

    # 5) generate distinct colors & asteroid images as before
    # … (same code as before) …
    num_z = len(all_zones)
    colors = []
    for i in range(num_z):
        h = i/num_z
        r,g,b = colorsys.hsv_to_rgb(h,0.5,0.95)
        colors.append(f'#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}')
    used_sets = set()
    zone_imgs: Dict[int,List[str]] = {}
    for idx in all_zones:
        while True:
            picks = random.sample(range(80),12)
            t = tuple(picks)
            if t not in used_sets:
                used_sets.add(t)
                break
        zone_imgs[idx] = [f"asteroid_{p:02d}.png" for p in picks]

    zone_meta: Dict[int,Dict[str,Any]] = {}
    for i, idx in enumerate(all_zones):
        pk = zone_to_payoff[idx]
        zone_meta[idx] = {
            "zone_index": idx,
            "background": f"zone_{idx:02d}.png",
            "color": colors[i],
            "mode": "asteroid",
            "images": zone_imgs[idx],
            "bandit": [ bandits_data[pk]["payoffs"] ]
        }

    # 6) assign demonstrator_ids uniquely across sessions
    available_ids = set(range(20))
    session_to_ids: Dict[int, List[int]] = {}
    for sess_i in range(len(raw_sessions)):
        if len(available_ids) < 2:
            raise RuntimeError("ran out of demonstrator IDs!")
        d1, d2 = random.sample(available_ids, 2)
        available_ids.remove(d1)
        available_ids.remove(d2)
        session_to_ids[sess_i] = [d1, d2]

    # 7) now inject zone_meta and build the demonstrator dicts
    for games, [choice] in raw_sessions:
        sess_i = games[0]["session_index"]
        payoff_key = zone_to_payoff[ games[0]["zone"]["zone_index"] ]
        d_ids = session_to_ids[sess_i]

        # for each watch event, replace demonstrator str → dict
        for e in games:
            zi = e["zone"]["zone_index"]
            e["zone"] = zone_meta[zi]

            if e["game"] == "watch":
                typ = e["demonstrator"]
                idx_in_block = (e["round_index"]*num_watch_slots
                                + (0 if (e["round_index"]*len(repeat_block)+e["game_index"] % len(repeat_block)) < 2 else 1))
                # actually simpler: track watch_cursor above.  But we stored watch_idx:
                # we'll reuse the original watch order instead:
                # Since we didn't store watch_idx above, let's recompute:
                # count how many watches before this one in the current block:
                block_pos = e["game_index"] % len(repeat_block)
                dem_idx = 0 if block_pos in (0,1,2,3) and block_pos<2 else 1

                # pick the correct id for this slot:
                demon_id = session_to_ids[sess_i][dem_idx]
                full_traj = bandits_data[payoff_key]["policy"]["thompson"][typ]\
                            [f"{payoff_key}_{typ}_policy{demon_id}"]
                start = e["round_index"]*num_watch_arm_pulls
                traj = full_traj[start:start+num_watch_arm_pulls]

                e["demonstrator"] = {
                    "type": typ,
                    "demonstrator_index": dem_idx,
                    "demonstrator_id": demon_id,
                    "image": f"demonstrator_{demon_id:02d}.png",
                    "trajectory": traj
                }

        # finally inject zone_meta into the choice entry as well:
        ci = choice["zone"]["zone_index"]
        choice["zone"] = zone_meta[ci]

    return raw_sessions


if __name__ == "__main__":
    import json

    # e.g. 1 round, 24 pulls for play, 48 pulls for watch
    tl = generate_timeline(rounds=1, num_play_arm_pulls=6, num_watch_arm_pulls=4)
    print(json.dumps(tl, indent=4))