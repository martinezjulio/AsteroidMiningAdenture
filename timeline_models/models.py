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
    bandit_assignment_mode: str = "session_fixed",
    textbox_feedback: bool = False,
    session_demonstrators: str = "all",
    prop_of_sessions: float = 0.5,
    omit_explicit_experience_transfer_message: bool = False,
    name_demonstrators: bool = False,
    present_demonstrators_apriori: bool = False,
    demonstrator_config: Optional[Dict[str, Any]] = None
) -> List[Any]:
    # 0) load bandit data or use inline config
    if demonstrator_config and demonstrator_config.get('source') == 'inline':
        # Inline mode: use permuted bandit payoffs
        bandits_data = None
        payoff_keys = None
        bandit_payoffs = demonstrator_config.get('bandit_payoffs', [])
        if not bandit_payoffs:
            raise ValueError("bandit_payoffs must be provided in demonstrator_config for inline mode")
    else:
        # File mode: load from file
        with open(bandits_json_path, "r") as f:
            bandits_data = json.load(f)
        payoff_keys = sorted(k for k in bandits_data if k.startswith("payoffs"))
        bandit_payoffs = None
    
    if rounds < 1:
        raise ValueError("rounds must be >= 1")

    # 1) build raw bandit sessions
    repeat_block = ["watch", "play", "watch", "play"]
    choice_name = "choice"
    num_watch_slots = repeat_block.count("watch")
    patterns = list(product(["expert", "novice"], repeat=num_watch_slots))
    
    # Filter patterns based on session_demonstrators setting
    if session_demonstrators == "different":
        # Only keep patterns where demonstrators are different types
        # For 2 watch slots: keep (expert, novice) and (novice, expert)
        # Filter out (expert, expert) and (novice, novice)
        patterns = [pat for pat in patterns if pat[0] != pat[1]]
    elif session_demonstrators == "all":
        # Keep all patterns (default behavior)
        pass
    else:
        raise ValueError(f"Invalid session_demonstrators value: {session_demonstrators}. Must be 'all' or 'different'")
    
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
            
            # Build choice container - add feedback stage if enabled
            choice_container = [choice]
            if textbox_feedback:
                feedback_stage = {
                    "stage_type": "feedback",
                    "game_index": idx + 1,
                    "stage_index": 2,
                    "session_total_rounds": rounds,
                    "message": "Please fill the box below with your response to the following question:",
                    "demonstrator_1": pat[0],
                    "demonstrator_2": pat[1],
                    "transfer": xfer
                }
                choice_container.append(feedback_stage)
            
            raw_sessions.append([games, choice_container])

    # 2) shuffle & select proportion of sessions, then assign session_index, zone_index starting at 1
    random.shuffle(raw_sessions)
    
    # Select proportion of sessions based on config (1.0 = all, 0.5 = half, etc.)
    if prop_of_sessions < 1.0:
        num_sessions = max(1, int(len(raw_sessions) * prop_of_sessions))
        raw_sessions = raw_sessions[:num_sessions]
    # If prop_of_sessions >= 1.0, keep all sessions
    
    zone_idx = 1
    
    for sess_i, (games, choice_container) in enumerate(raw_sessions, start=1):
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
            
        # Get the choice (first item in choice_container)
        choice = choice_container[0]
        if choice["transfer"]:
            zone_idx += 1
        choice["session_index"] = sess_i
        choice["zone"] = {"zone_global_index": zone_idx}
        
        # Update session_index for all items in choice_container (including feedback if present)
        for item in choice_container:
            item["session_index"] = sess_i
            if "zone" not in item:  # Don't override zone for choice, but add for feedback
                item["zone"] = {"zone_global_index": zone_idx}
        
        zone_idx += 1

    # 3) collect all zone_indices (include 0 for practice)
    all_zones = {0}
    for sess in raw_sessions:
        for stage in sess:
            for e in stage:
                all_zones.add(e["zone"]["zone_global_index"])
    unique_zones = sorted(all_zones)

    # 4) sample payoff key per zone OR generate permuted bandits for inline mode
    if demonstrator_config and demonstrator_config.get('source') == 'inline':
        # Inline mode: generate permuted bandits
        zone_to_payoff = {}
        zone_permuted_payoffs: Dict[int, List[float]] = {}
        for z in unique_zones:
            # Create a unique permutation for this zone
            permuted = bandit_payoffs.copy()
            random.shuffle(permuted)
            zone_permuted_payoffs[z] = permuted
            # Create a pseudo payoff key for tracking
            zone_to_payoff[z] = f"inline_zone_{z}"
    else:
        # File mode: sample from payoff keys
        if len(unique_zones) > len(payoff_keys):
            raise RuntimeError("Not enough payoff keys")
        chosen = random.sample(payoff_keys, len(unique_zones))
        zone_to_payoff = dict(zip(unique_zones, chosen))
        zone_permuted_payoffs = None

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
        if demonstrator_config and demonstrator_config.get('source') == 'inline':
            # Inline mode: use permuted payoffs
            zone_meta[z] = {
                "zone_global_index": z,
                "zone_mode": "asteroid",
                "zone_bandit_arm_image_indexes": zone_bandit_arm_indexes[z],
                "zone_bandit": [zone_permuted_payoffs[z]],
                "bandit_id": pk
            }
        else:
            # File mode: use payoffs from file
            zone_meta[z] = {
                "zone_global_index": z,
                "zone_mode": "asteroid",
                "zone_bandit_arm_image_indexes": zone_bandit_arm_indexes[z],
                "zone_bandit": [bandits_data[pk]["payoffs"]],
                "bandit_id": pk
            }

    # 7) assign demonstrator_ids per session with style+color constraints
    available_ids = list(range(20))
    random.shuffle(available_ids)
    session_to_ids: Dict[int, List[int]] = {}
    for sess_i in range(1, len(raw_sessions) + 1):
        session_to_ids[sess_i] = [available_ids.pop(), available_ids.pop()]
    
    # Collect all unique demonstrator IDs used
    all_demo_ids = set()
    for ids in session_to_ids.values():
        all_demo_ids.update(ids)
    
    # 7a) Generate and assign demonstrator names if enabled
    # Create 36 unique starship names (space/mining/asteroid themed)
    STARSHIP_NAMES = [
        'Falcon', 'Phoenix', 'Orion', 'Vega', 'Titan', 'Nova',
        'Eclipse', 'Zenith', 'Comet', 'Asteroid', 'Nebula', 'Cosmos',
        'Voyager', 'Pioneer', 'Explorer', 'Seeker', 'Hunter', 'Ranger',
        'Mercury', 'Jupiter', 'Saturn', 'Neptune', 'Pluto', 'Mars',
        'Pulsar', 'Quasar', 'Galaxy', 'Meteor', 'Stellar', 'Lunar',
        'Solar', 'Celestial', 'Horizon', 'Odyssey', 'Venture', 'Frontier'
    ]
    
    # Shuffle names for random assignment
    available_names = STARSHIP_NAMES.copy()
    random.shuffle(available_names)
    
    # Map demonstrator_id -> name
    demo_names: Dict[int, str] = {}
    if name_demonstrators:
        # Assign names to all demonstrators used in this timeline
        for demo_id in sorted(all_demo_ids):
            if available_names:
                demo_names[demo_id] = available_names.pop()
            else:
                # Fallback (shouldn't happen with 36 names and max 20 demonstrators)
                demo_names[demo_id] = f"Starship_{demo_id}"
    
    # 7b) assign style+color to each demonstrator with session-level constraints
    AVAILABLE_STYLES = ['style1', 'style2', 'style3', 'style4', 'style5', 'style6']
    AVAILABLE_COLORS = ['red', 'orange', 'blue', 'green', 'yellow', 'purple']
    
    # Create all possible style+color combinations and shuffle them
    all_combinations = [(style, color) for style in AVAILABLE_STYLES for color in AVAILABLE_COLORS]
    random.shuffle(all_combinations)
    
    # Map demonstrator_id -> {style, color}
    demo_style_color: Dict[int, Dict[str, str]] = {}
    used_combos = set()
    
    # Process each session to ensure its two demonstrators have different styles AND colors
    for sess_i, demo_ids in session_to_ids.items():
        # For each demonstrator in the session
        for demo_id in demo_ids:
            if demo_id in demo_style_color:
                # Already assigned (shouldn't happen with current logic, but be safe)
                continue
            
            # Find a style+color that:
            # 1. Hasn't been used globally
            # 2. Doesn't conflict with other demonstrators in THIS session
            # We try combinations in random order (shuffled above)
            assigned = False
            for style, color in all_combinations:
                combo_key = f"{style}:{color}"
                
                # Check if combo is available globally
                if combo_key in used_combos:
                    continue
                
                # Check if this style or color conflicts with other demos in this session
                has_conflict = False
                for other_demo_id in demo_ids:
                    if other_demo_id == demo_id:
                        continue
                    if other_demo_id in demo_style_color:
                        other = demo_style_color[other_demo_id]
                        # Conflict if same style OR same color
                        if other['style'] == style or other['color'] == color:
                            has_conflict = True
                            break
                
                if not has_conflict:
                    # Found a valid assignment!
                    demo_style_color[demo_id] = {'style': style, 'color': color}
                    used_combos.add(combo_key)
                    assigned = True
                    break
            
            if not assigned:
                raise RuntimeError(
                    f"Could not assign style+color for demonstrator {demo_id} in session {sess_i}. "
                    f"Available combos: {len(AVAILABLE_STYLES) * len(AVAILABLE_COLORS) - len(used_combos)}"
                )

    # 8) inject zone_meta & demonstrator dicts & overlay-messages
    for games, choice_container in raw_sessions:
        sess_i = games[0]["session_index"]
        dem_ids = session_to_ids[sess_i]
        payoff_key = zone_to_payoff[games[0]["zone"]["zone_global_index"]]

        # Insert demonstrator presentation stage at beginning of session if enabled
        if present_demonstrators_apriori:
            # Get pattern for this session to determine demonstrator types
            # The pattern is stored in the first watch game
            first_watch_game = next((g for g in games if g["game"] == "watch"), None)
            if first_watch_game:
                # Build demonstrator data for both demonstrators
                demo1_data = {
                    "demonstrator_session_index": 0,
                    "demonstrator_global_index": dem_ids[0],
                    "demonstrator_style": demo_style_color[dem_ids[0]]['style'],
                    "demonstrator_color": demo_style_color[dem_ids[0]]['color']
                }
                demo2_data = {
                    "demonstrator_session_index": 1,
                    "demonstrator_global_index": dem_ids[1],
                    "demonstrator_style": demo_style_color[dem_ids[1]]['style'],
                    "demonstrator_color": demo_style_color[dem_ids[1]]['color']
                }
                # Add names if enabled
                if name_demonstrators:
                    if dem_ids[0] in demo_names:
                        demo1_data["demonstrator_name"] = demo_names[dem_ids[0]]
                    if dem_ids[1] in demo_names:
                        demo2_data["demonstrator_name"] = demo_names[dem_ids[1]]
                
                presentation_stage = {
                    "stage_type": "demonstrator_presentation",
                    "session_index": sess_i,
                    "session_total_rounds": rounds,
                    "demonstrator1": demo1_data,
                    "demonstrator2": demo2_data,
                    "message": "You will now start a new session with a starting TOTAL REWARD of 0. You will experience several watch and play games! You will observe two partners, shown below, during your watch games. Pay close attention to learn from them. You will also be asked to choose between them at the end of the session."
                }
                # Insert at the beginning of games array
                games.insert(0, presentation_stage)
                print(f"DEBUG: Inserted demonstrator_presentation stage for session {sess_i}", file=sys.stderr)

        # Track demonstrators seen in this session to determine if they're "new" or "previously seen"
        seen_demonstrators = set()

        # stage0 entries with corrected overlay logic
        prev_zone = None
        is_first_game = True
        for i, e in enumerate(games):
            # Skip non-game stages (like demonstrator_presentation)
            if "stage_type" in e:
                continue
            
            z = e["zone"]["zone_global_index"]
            e["zone"] = zone_meta[z]

            parts: List[str] = []
            if is_first_game:
                # Only show "This is a new session!" if we didn't already show presentation
                if not present_demonstrators_apriori:
                    parts.append("This is a new session!")
                parts.append("You are entering a new zone.")
                is_first_game = False
            else:
                if z != prev_zone:
                    parts.append("You are entering a new zone.")
                else:
                    parts.append("You will continue in the same zone.")

            if e["game"] == "watch":
                typ = e["demonstrator"]
                pos = e["game_index"] % len(repeat_block)
                dem_idx = 0 if pos < 2 else 1
                did = dem_ids[dem_idx]
                
                # Build demonstrator data
                demo_data = {
                    "demonstrator_type": typ,
                    "demonstrator_session_index": dem_idx,
                    "demonstrator_global_index": did,
                    "demonstrator_style": demo_style_color[did]['style'],
                    "demonstrator_color": demo_style_color[did]['color']
                }
                
                # Add trajectory only in file mode
                if demonstrator_config and demonstrator_config.get('source') == 'inline':
                    # Inline mode: no trajectory, will be generated in JavaScript
                    pass
                else:
                    # File mode: load trajectory from bandits_data
                    game_payoff_key = zone_to_payoff[z]
                    full = bandits_data[game_payoff_key]["policy"]["thompson"][typ][
                        f"{game_payoff_key}_{typ}_policy{did}"
                    ]
                    start = e["round_index"] * num_watch_arm_pulls
                    traj = full[start : start + num_watch_arm_pulls]
                    demo_data["demonstrator_trajectory"] = traj
                
                # Add name if enabled
                if name_demonstrators and did in demo_names:
                    demo_data["demonstrator_name"] = demo_names[did]
                e["demonstrator"] = demo_data
                
                # Check if this demonstrator has been seen before in this session
                if did in seen_demonstrators:
                    # Previously seen demonstrator
                    parts.append(
                        "You will watch the starship partner shown below play again. "
                        "Pay close attention to your partner's choices and outcomes."
                    )
                else:
                    # New demonstrator
                    parts.append(
                        "In this game you will watch the starship partner shown below play the game. "
                        "Pay close attention to your partner's choices and outcomes."
                    )
                    seen_demonstrators.add(did)
                
                # Add secondary overlay message for all watch games (only if not omitted)
                if not omit_explicit_experience_transfer_message:
                    e["secondary-overlay-message"] = (
                        "Remember: Some starship partners have experience in every zone while the other starships have no experience in any zone."
                    )
                
            elif e["game"] == "play":
                parts.append(
                    "In this game you will mine for rewards. "
                    "Try to get as much reward as possible. Every step counts! Keep an eye on your TOTAL REWARD to see how you're doing overall!"
                )

            e["overlay-message"] = " ".join(parts)
            prev_zone = z

        # Process choice and feedback entries
        choice = choice_container[0]  # Get the choice (first item)
        cz = choice["zone"]["zone_global_index"]
        choice["zone"] = zone_meta[cz]
        
        # Build demonstrator data for choice
        demonstrator_data = {}
        for i_key, key in enumerate(("demonstrator_1", "demonstrator_2")):
            typ = choice[key]
            did = dem_ids[i_key]
            demo_data = {
                "demonstrator_type": typ,
                "demonstrator_session_index": i_key,
                "demonstrator_global_index": did,
                "demonstrator_style": demo_style_color[did]['style'],
                "demonstrator_color": demo_style_color[did]['color']
            }
            # Add name if enabled
            if name_demonstrators and did in demo_names:
                demo_data["demonstrator_name"] = demo_names[did]
            demonstrator_data[f"demonstrator{i_key+1}"] = demo_data
            choice[f"demonstrator{i_key+1}"] = demonstrator_data[f"demonstrator{i_key+1}"]
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
        
        # Process feedback stage if present
        if len(choice_container) > 1:
            feedback = choice_container[1]
            feedback["zone"] = zone_meta[cz]  # Same zone as choice
            # Add demonstrator data to feedback stage for display
            feedback["demonstrator1"] = demonstrator_data["demonstrator1"]
            feedback["demonstrator2"] = demonstrator_data["demonstrator2"]

    # 9) fixed practice session
    practice_zone = zone_meta[0]
    
    # Build intro message conditionally based on omit_explicit_experience_transfer_message
    if omit_explicit_experience_transfer_message:
        intro_message = (
            "Welcome to \"Asteroid Fortune Frontier\" the asteroid mining adventure.\n\n"
            "[BOLD]PLEASE READ CAREFULLY:[/BOLD]\n\n"
            "As a player you will pilot a starship to mine ASTEROIDS by shooting them. "
            "Some asteroids yield rewards more often than others. These reward rates are unknown to you. \n\n"
            "YOUR GOAL IS FIND THE ASTEROID THAT YIELDS REWARD MOST OFTEN AND MINE FROM IT AS MUCH AS POSSIBLE!  \n\n "
            "You will encounter multiple asteroid ZONES each indicated by a zone number. "
            "Sometimes you will repeat the same zone with the same reward payoffs. "
            "Sometimes you will move into new zones with new asteroids and new unknown reward payoffs.\n\n "
            "You will also have starship PARTNERS to learn from. "
            "Pay close attention and try to learn from your observations from them. \n\n"
            "Welcome to \"Asteroid Fortune Frontier\" – where the universe is yours to mine.\n\n"
            "[RED_BOLD]DO NOT RELOAD PAGE AT ANY TIME DURING GAME![/RED_BOLD]"
        )
    else:
        intro_message = (
            "Welcome to \"Asteroid Fortune Frontier\" the asteroid mining adventure.\n\n"
            "[BOLD]PLEASE READ CAREFULLY:[/BOLD]\n\n"
            "As a player you will pilot a starship to mine ASTEROIDS by shooting them. "
            "Some asteroids yield rewards more often than others. These reward rates are unknown to you. \n\n"
            "YOUR GOAL IS FIND THE ASTEROID THAT YIELDS REWARD MOST OFTEN AND MINE FROM IT AS MUCH AS POSSIBLE!  \n\n "
            "You will encounter multiple asteroid ZONES each indicated by a zone number. "
            "Sometimes you will repeat the same zone with the same reward payoffs. "
            "Sometimes you will move into new zones with new asteroids and new unknown reward payoffs.\n\n "
            "You will also have starship PARTNERS to learn from. Some starship partners have experience in every zone while the others have none. "
            "You will not be told your partners experience level but pay close attention and try to learn from your observations from them. \n\n"
            "Welcome to \"Asteroid Fortune Frontier\" – where the universe is yours to mine.\n\n"
            "[RED_BOLD]DO NOT RELOAD PAGE AT ANY TIME DURING GAME![/RED_BOLD]"
        )
    
    practice_session = [
        {"stage_type": "prolific_id_form", "message": "Please enter your Prolific ID below:"},
        {
            "stage_type": "introduction",
            "message": intro_message,
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

    # Read config to determine bandit assignment mode and feedback settings
    try:
        with open('../config.json', 'r') as f:
            config = json.load(f)
        bandit_mode = config.get('bandit_assignment_mode', 'session_fixed')
        textbox_feedback = config.get('textbox_feedback', False)
        session_demonstrators = config.get('session_demonstrators', 'all')
        prop_of_sessions = config.get('prop_of_sessions', 0.5)
        omit_explicit_experience_transfer_message = config.get('omit_explicit_experience_transfer_message', False)
        name_demonstrators = config.get('name_demonstrators', False)
        present_demonstrators_apriori = config.get('present_demonstrators_apriori', False)
    except Exception as e:
        # Write to stderr so it doesn't interfere with stdout JSON
        print(f"Warning: Could not read config.json, using default settings: {e}", file=sys.stderr)
        bandit_mode = 'session_fixed'  # fallback
        textbox_feedback = False  # fallback
        session_demonstrators = 'all'  # fallback
        prop_of_sessions = 0.5  # fallback
        omit_explicit_experience_transfer_message = False  # fallback
        name_demonstrators = False  # fallback
        present_demonstrators_apriori = False  # fallback

    # Get request ID from command line arguments for unique file naming
    request_id = None
    demonstrator_config = None
    if len(sys.argv) > 1:
        request_id = sys.argv[1]
    else:
        # Fallback to timestamp if no request_id provided
        import time
        request_id = f"timeline_{int(time.time())}"
    
    # Get demonstrator_config from command line if provided (3rd argument)
    if len(sys.argv) > 2:
        try:
            demonstrator_config = json.loads(sys.argv[2])
            print(f"Using demonstrator_config from command line: {demonstrator_config}", file=sys.stderr)
        except json.JSONDecodeError as e:
            print(f"Warning: Could not parse demonstrator_config JSON: {e}", file=sys.stderr)
            demonstrator_config = None
    
    # Fallback to config file if not provided via command line
    if demonstrator_config is None and 'demonstrator_config' in config:
        demonstrator_config = config.get('demonstrator_config')
        print(f"Using demonstrator_config from config.json: {demonstrator_config}", file=sys.stderr)

    # e.g. 3 rounds, 6 pulls for play, 6 pulls for watch
    tl = generate_timeline(
        rounds=3, 
        num_play_arm_pulls=6, 
        num_watch_arm_pulls=6,
        bandit_assignment_mode=bandit_mode,
        textbox_feedback=textbox_feedback,
        session_demonstrators=session_demonstrators,
        prop_of_sessions=prop_of_sessions,
        omit_explicit_experience_transfer_message=omit_explicit_experience_transfer_message,
        name_demonstrators=name_demonstrators,
        present_demonstrators_apriori=present_demonstrators_apriori,
        demonstrator_config=demonstrator_config
    )
    
    # Output JSON to stdout for the Node.js server to capture
    print(json.dumps(tl))
    
    # Also save to file for backup/debugging with unique filename
    try:
        backup_filename = f'../timelines/timeline_{request_id}.json'
        with open(backup_filename, 'w') as f: 
            json.dump(tl, f, indent=4)
    except Exception as e:
        # Don't fail if we can't write to file, just continue
        # Write to stderr so it doesn't interfere with stdout JSON
        print(f"Warning: Could not write backup file: {e}", file=sys.stderr)
        pass