import json
import random
import sys
from typing import List, Dict, Any, Optional


# Stage tokens recognized in `round_game_sequence_conditions` and
# `session_end_stages`. Watch tokens carry an explicit demo index.
WATCH_TOKENS = {"watch-demo-1": 0, "watch-demo-2": 1}
PLAY_TOKENS = {"play"}
CHOICE_LIKE_TOKENS = {"choice", "online-choice", "blind", "indicate"}
META_TOKENS = {"feedback"}

# End-of-session stages (choice/feedback) never show asteroids. They get a virtual
# zone id (CHOICE_ZONE_BASE + session) so played zones stay consecutively numbered.
CHOICE_ZONE_BASE = 1000
ALL_TOKENS = set(WATCH_TOKENS.keys()) | PLAY_TOKENS | CHOICE_LIKE_TOKENS | META_TOKENS

# Tokens that imply demonstrators are visible to the participant.
DEMO_TOKENS = set(WATCH_TOKENS.keys())
# Session-end tokens that only make sense if the session showed demonstrators.
DEMO_DEPENDENT_END_TOKENS = CHOICE_LIKE_TOKENS | {"feedback"}


def _session_uses_demonstrators(condition: List[str]) -> bool:
    return any(tok in DEMO_TOKENS for tok in condition)


def _validate_tokens(tokens: List[str], where: str) -> None:
    for tok in tokens:
        if tok not in ALL_TOKENS:
            raise ValueError(f"Unknown stage token {tok!r} in {where} (allowed: {sorted(ALL_TOKENS)})")


def _build_stage_for_token(
    token: str,
    *,
    game_index: int,
    round_idx: Optional[int],
    num_rounds: int,
    num_pulls_per_play_game: int,
    num_pulls_per_watch_game: int,
) -> Dict[str, Any]:
    """Build the stage dict for a single token. demonstrator/zone/session_index
    fields are filled in later phases."""
    base = {
        "game_index": game_index,
        "stage_index": 0,
        "round_index": round_idx,
        "session_total_rounds": num_rounds,
        "transfer": None,
    }
    if token in WATCH_TOKENS:
        return {
            **base,
            "game": "watch",
            "demonstrator": None,
            "demonstrator_index": WATCH_TOKENS[token],
            "num_arm_pulls": num_pulls_per_watch_game,
        }
    if token == "play":
        return {
            **base,
            "game": "play",
            "demonstrator": None,
            "num_arm_pulls": num_pulls_per_play_game,
        }
    if token in CHOICE_LIKE_TOKENS:
        return {
            **base,
            "game": token,
            "demonstrator": None,
            "num_arm_pulls": None,
            # transfer=True for end-of-session choice (advances zone). Inside-round
            # choices are rare; leave None and zone is inherited.
            "transfer": True if round_idx is None else None,
            "stage_index": 1 if round_idx is None else 0,
        }
    if token == "feedback":
        return {
            **base,
            "stage_type": "feedback",
            "stage_index": 2 if round_idx is None else 0,
            "message": "Please fill the box below with your response to the following question:",
            "transfer": True if round_idx is None else None,
        }
    raise ValueError(f"Unhandled token {token!r}")


def _join_names(names):
    """'X' / 'both X and Y' / 'X, Y and Z' for participant-facing copy."""
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"both {names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + f" and {names[-1]}"


def _build_demo_data(
    dem_idx: int,
    dem_ids: List[int],
    demo_style_color: Dict[int, Dict[str, str]],
    demo_names: Dict[int, str],
    name_demonstrators: bool,
) -> Dict[str, Any]:
    did = dem_ids[dem_idx]
    out = {
        "demonstrator_index": dem_idx,
        "demonstrator_session_index": dem_idx,
        "demonstrator_global_index": did,
        "demonstrator_style": demo_style_color[did]["style"],
        "demonstrator_color": demo_style_color[did]["color"],
    }
    if name_demonstrators and did in demo_names:
        out["demonstrator_name"] = demo_names[did]
    return out


def generate_timeline(
    *,
    round_game_sequence_conditions: List[List[str]],
    session_end_stages: List[str],
    num_rounds: int,
    num_pulls_per_play_game: int,
    num_pulls_per_watch_game: int,
    demo_1_prior_experience: int,
    demo_2_prior_experience: int,
    bandit_payoffs: List[float],
    sampling_method: str,
    num_sessions: Optional[int],
    num_times_conditions_repeat: int,
    prop_of_sessions: float,
    bandit_assignment_mode: str,
    experience_message_text: Optional[str],
    name_demonstrators: bool,
    present_demonstrators_apriori: bool,
    demonstrator_sampling_strategy: str,
    total_reward_scope: str = 'per_session',
    report_play_rewards_between_rounds: bool = False,
    bonus_per_reward: Optional[float] = None,
    bonus_currency: str = "$",
) -> List[Any]:

    # --- 0) Validation ---
    if num_rounds < 1:
        raise ValueError("num_rounds must be >= 1")
    if num_times_conditions_repeat < 1:
        raise ValueError("num_times_conditions_repeat must be >= 1")
    if not bandit_payoffs:
        raise ValueError("bandit_payoffs must be a non-empty list")
    if not round_game_sequence_conditions:
        raise ValueError("round_game_sequence_conditions must be non-empty")
    for ci, cond in enumerate(round_game_sequence_conditions):
        _validate_tokens(cond, f"round_game_sequence_conditions[{ci}]")
    _validate_tokens(session_end_stages, "session_end_stages")
    if total_reward_scope not in ('per_session', 'across_sessions'):
        raise ValueError(
            f"total_reward_scope must be 'per_session' or 'across_sessions', got {total_reward_scope!r}"
        )

    # --- 1) Sample sessions from conditions ---
    if sampling_method == "all_conditions_shuffled":
        sessions: List[List[str]] = []
        for _ in range(num_times_conditions_repeat):
            shuffled = list(round_game_sequence_conditions)
            random.shuffle(shuffled)
            sessions.extend(shuffled)
    elif sampling_method == "conditions_sampled_uniformly":
        if num_sessions is None:
            raise ValueError("num_sessions is required when sampling_method == 'conditions_sampled_uniformly'")
        total = num_sessions * num_times_conditions_repeat
        sessions = [random.choice(round_game_sequence_conditions) for _ in range(total)]
    else:
        raise ValueError(f"Unknown sampling_method: {sampling_method!r}")

    # --- 1a) Subsample sessions ---
    if prop_of_sessions < 1.0:
        keep = max(1, int(len(sessions) * prop_of_sessions))
        sessions = random.sample(sessions, keep)

    # --- 2) Build per-session [games, end_stages] structures ---
    raw_sessions: List[List[List[Dict[str, Any]]]] = []
    for condition in sessions:
        games: List[Dict[str, Any]] = []
        idx = 0
        for round_idx in range(num_rounds):
            round_stages: List[Dict[str, Any]] = []
            for token in condition:
                round_stages.append(_build_stage_for_token(
                    token,
                    game_index=idx,
                    round_idx=round_idx,
                    num_rounds=num_rounds,
                    num_pulls_per_play_game=num_pulls_per_play_game,
                    num_pulls_per_watch_game=num_pulls_per_watch_game,
                ))
                idx += 1
            games.extend(round_stages)

            has_play = any(s.get("game") == "play" for s in round_stages)
            if (report_play_rewards_between_rounds
                    and round_idx < num_rounds - 1
                    and has_play):
                games.append({
                    "stage_type": "round_recap",
                    "game_index": idx,
                    "stage_index": 0,
                    "round_index": round_idx,
                    "session_total_rounds": num_rounds,
                    "transfer": None,
                })
                idx += 1

        # Demo-less sessions (round-sequence has no watch-demo-*) drop demo-dependent
        # end stages (choice/online-choice/feedback/blind/indicate); keeping them would
        # ask the participant to choose between, or react to, partners they never saw.
        if _session_uses_demonstrators(condition):
            effective_end_tokens = list(session_end_stages)
        else:
            effective_end_tokens = [
                t for t in session_end_stages if t not in DEMO_DEPENDENT_END_TOKENS
            ]

        end_stages: List[Dict[str, Any]] = []
        for token in effective_end_tokens:
            end_stages.append(_build_stage_for_token(
                token,
                game_index=idx,
                round_idx=None,
                num_rounds=num_rounds,
                num_pulls_per_play_game=num_pulls_per_play_game,
                num_pulls_per_watch_game=num_pulls_per_watch_game,
            ))
            idx += 1

        raw_sessions.append([games, end_stages])

    # --- 3) Assign session_index + zone numbering ---
    # Played zones are numbered consecutively in play order across sessions.
    zone_idx = 1
    for sess_i, (games, end_stages) in enumerate(raw_sessions, start=1):
        if bandit_assignment_mode == "session_fixed":
            for e in games:
                e["session_index"] = sess_i
                e["zone"] = {"zone_global_index": zone_idx}
            zone_idx += 1
        elif bandit_assignment_mode == "round_changing":
            current_round = -1
            round_zone_idx = zone_idx
            for e in games:
                e["session_index"] = sess_i
                if e.get("round_index") is not None and e["round_index"] != current_round:
                    current_round = e["round_index"]
                    e["zone"] = {"zone_global_index": round_zone_idx}
                    round_zone_idx += 1
                else:
                    e["zone"] = {"zone_global_index": round_zone_idx - 1}
            zone_idx = round_zone_idx
        else:
            raise ValueError(f"Invalid bandit_assignment_mode: {bandit_assignment_mode!r}")

        # End-of-session stages (choice + feedback) share a virtual zone: it has its
        # own color and payoff entry but is never played and doesn't consume a number.
        choice_zone = CHOICE_ZONE_BASE + sess_i
        for stage in end_stages:
            stage["session_index"] = sess_i
            stage["zone"] = {"zone_global_index": choice_zone}

    # --- 4) Collect zones (incl. 0 for practice) ---
    all_zones = {0}
    for games, end_stages in raw_sessions:
        for e in games + end_stages:
            if "zone" in e:
                all_zones.add(e["zone"]["zone_global_index"])
    unique_zones = sorted(all_zones)

    # --- 5) Per-zone payoff permutations (always inline) ---
    zone_to_payoff: Dict[int, str] = {}
    zone_permuted_payoffs: Dict[int, List[float]] = {}
    for z in unique_zones:
        permuted = list(bandit_payoffs)
        random.shuffle(permuted)
        zone_permuted_payoffs[z] = permuted
        zone_to_payoff[z] = f"inline_zone_{z}"

    # --- 6) Asteroid image picks per zone ---
    used_sets = set()
    zone_bandit_arm_indexes: Dict[int, List[int]] = {}
    for z in unique_zones:
        while True:
            picks = random.sample(range(80), 12)
            if tuple(picks) not in used_sets:
                used_sets.add(tuple(picks))
                break
        zone_bandit_arm_indexes[z] = picks

    # --- 7) Zone metadata ---
    zone_meta: Dict[int, Dict[str, Any]] = {}
    for z in unique_zones:
        zone_meta[z] = {
            "zone_global_index": z,
            "zone_mode": "asteroid",
            "zone_bandit_arm_image_indexes": zone_bandit_arm_indexes[z],
            "zone_bandit": [zone_permuted_payoffs[z]],
            "bandit_id": zone_to_payoff[z],
        }

    # --- 8) Demonstrator IDs per session ---
    available_ids = list(range(20))
    random.shuffle(available_ids)
    session_to_ids: Dict[int, List[int]] = {}
    for sess_i in range(1, len(raw_sessions) + 1):
        session_to_ids[sess_i] = [available_ids.pop(), available_ids.pop()]

    all_demo_ids = set()
    for ids in session_to_ids.values():
        all_demo_ids.update(ids)

    # --- 8a) Demonstrator names ---
    STARSHIP_NAMES = [
        'Falcon', 'Phoenix', 'Orion', 'Vega', 'Titan', 'Nova',
        'Eclipse', 'Zenith', 'Comet', 'Nebula', 'Cosmos',
        'Voyager', 'Pioneer', 'Explorer', 'Seeker', 'Hunter', 'Ranger',
        'Mercury', 'Jupiter', 'Saturn', 'Neptune', 'Pluto', 'Mars',
        'Pulsar', 'Quasar', 'Galaxy', 'Meteor', 'Stellar', 'Lunar',
        'Solar', 'Celestial', 'Horizon', 'Odyssey', 'Venture', 'Zapper'
    ]
    available_names = STARSHIP_NAMES.copy()
    random.shuffle(available_names)
    demo_names: Dict[int, str] = {}
    if name_demonstrators:
        for demo_id in sorted(all_demo_ids):
            if available_names:
                demo_names[demo_id] = available_names.pop()
            else:
                demo_names[demo_id] = f"Starship_{demo_id}"

    # --- 8b) Style+color assignment (within-session distinct + globally unique) ---
    AVAILABLE_STYLES = ['style1', 'style2', 'style3', 'style4', 'style5', 'style6']
    AVAILABLE_COLORS = ['red', 'orange', 'blue', 'green', 'yellow', 'purple']
    all_combinations = [(style, color) for style in AVAILABLE_STYLES for color in AVAILABLE_COLORS]
    random.shuffle(all_combinations)

    demo_style_color: Dict[int, Dict[str, str]] = {}
    used_combos = set()
    for sess_i, demo_ids in session_to_ids.items():
        for demo_id in demo_ids:
            if demo_id in demo_style_color:
                continue
            assigned = False
            for style, color in all_combinations:
                combo_key = f"{style}:{color}"
                if combo_key in used_combos:
                    continue
                has_conflict = False
                for other_demo_id in demo_ids:
                    if other_demo_id == demo_id:
                        continue
                    if other_demo_id in demo_style_color:
                        other = demo_style_color[other_demo_id]
                        if other['style'] == style or other['color'] == color:
                            has_conflict = True
                            break
                if not has_conflict:
                    demo_style_color[demo_id] = {'style': style, 'color': color}
                    used_combos.add(combo_key)
                    assigned = True
                    break
            if not assigned:
                raise RuntimeError(
                    f"Could not assign style+color for demonstrator {demo_id} in session {sess_i}. "
                    f"Available combos: {len(AVAILABLE_STYLES) * len(AVAILABLE_COLORS) - len(used_combos)}"
                )

    # --- 9) Inject zone_meta + demonstrator dicts + overlay copy ---
    # Participant-facing copy calls a session an "expedition"; config, logs and the
    # timeline JSON keep "session". Every gameplay stage gets "overlay-title" +
    # "overlay-message" (title + body on the transition slide).
    if bandit_assignment_mode == "round_changing":
        zones_title = "NEW ZONES"
        zones_into = "into new asteroid zones"
        zones_across = "across new asteroid zones"
        same_zones = "the same zones"
    else:
        zones_title = "NEW ZONE"
        zones_into = "into a new asteroid zone"
        zones_across = "in a new asteroid zone"
        same_zones = "the same zone"

    def _reward_line(sess_i: int) -> str:
        if total_reward_scope == 'across_sessions':
            return "Your TOTAL REWARD carries over." if sess_i > 1 else "Your TOTAL REWARD starts at 0."
        return "Your TOTAL REWARD for this expedition starts at 0."

    for games, end_stages in raw_sessions:
        sess_i = (games[0]["session_index"] if games else end_stages[0]["session_index"])
        dem_ids = session_to_ids[sess_i]
        session_has_demos = any(s.get("game") == "watch" for s in games)
        # Screen order of the two partner slots on the presentation and choice
        # screens (slot 0 = demo-1). Drawn per session so slot 0 is not always
        # "Partner A" / the left cell. Logged by the client as choice_display_order.
        display_order = [0, 1] if random.random() < 0.5 else [1, 0]

        # 9a) demonstrator_presentation prepended (if enabled AND session has demos).
        # All-play sessions skip this — there's nothing to present.
        if present_demonstrators_apriori and session_has_demos:
            demo1_data = _build_demo_data(0, dem_ids, demo_style_color, demo_names, name_demonstrators)
            demo2_data = _build_demo_data(1, dem_ids, demo_style_color, demo_names, name_demonstrators)
            slot_names = [demo1_data.get("demonstrator_name"), demo2_data.get("demonstrator_name")]
            n1, n2 = slot_names[display_order[0]], slot_names[display_order[1]]
            partners = (
                f"Two partner starships, {n1} and {n2}, are coming along."
                if n1 and n2 else "Two partner starships are coming along."
            )
            presentation_stage = {
                "stage_type": "demonstrator_presentation",
                "session_index": sess_i,
                "session_total_rounds": num_rounds,
                "demonstrator1": demo1_data,
                "demonstrator2": demo2_data,
                "display_order": list(display_order),
                "title": f"EXPEDITION {sess_i} · {zones_title}, NEW PARTNERS",
                "message": (
                    f"You're heading {zones_into}. {partners} "
                    f"You'll watch each of them shoot, then take your own shots in {same_zones}. "
                    f"At the end of the expedition you'll be asked which one you'd pick as a partner. {_reward_line(sess_i)}"
                ),
            }
            games.insert(0, presentation_stage)
            print(f"DEBUG: Inserted demonstrator_presentation stage for session {sess_i}", file=sys.stderr)

        # 9b) Round games — inject zone_meta, demo data, overlay copy
        # The last play in each zone gets its own transition copy (the horizon is
        # made explicit). round_changing: last play of the round; session_fixed:
        # last play of the session.
        last_play_by_zone: Dict[int, int] = {}
        for e in games:
            if e.get("game") == "play":
                last_play_by_zone[e["zone"]["zone_global_index"]] = e["game_index"]
        seen_demonstrators = set()
        prev_zone = None
        prev_game = None
        is_first_game = True
        plays_in_zone = 0          # how many times the participant has played in the current zone
        watched_in_zone = []       # display names of every partner watched in the current zone, in order
        ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]
        session_has_presentation = bool(games) and games[0].get("stage_type") == "demonstrator_presentation"
        for e in games:
            if "stage_type" in e:
                prev_game = e["stage_type"]   # e.g. round_recap breaks the "just watched" chain
                continue
            z = e["zone"]["zone_global_index"]
            e["zone"] = zone_meta[z]
            new_zone = is_first_game or z != prev_zone
            if new_zone:
                plays_in_zone = 0
                watched_in_zone = []

            title = ""
            body = ""
            if e["game"] == "watch":
                dem_idx = e["demonstrator_index"]
                did = dem_ids[dem_idx]
                e["demonstrator"] = _build_demo_data(
                    dem_idx, dem_ids, demo_style_color, demo_names, name_demonstrators
                )
                name = e["demonstrator"].get("demonstrator_name")
                label = name.upper() if name else "PARTNER"
                who = name or "Your partner"
                n = num_pulls_per_watch_game
                if did in seen_demonstrators:
                    title = f"WATCH · {label} AGAIN"
                    if who in watched_in_zone:
                        # Already watched this partner in this very zone.
                        body = (f"You'll watch {who} again in the same zone. {who} takes {n} more shots. "
                                "Keep tracking its choices and outcomes.")
                    elif new_zone:
                        body = (f"You'll watch {who} again, but this time in a new zone. {who} takes {n} shots here. "
                                "Watch which asteroids it chooses and what it gets.")
                    else:
                        # Zone unchanged since the last stage, but this partner was only
                        # watched in an earlier zone — its first shots here.
                        body = (f"You've watched {who} before in an earlier zone; now you'll watch it in this zone. "
                                f"{who} takes {n} shots here. Watch which asteroids it chooses and what it gets.")
                else:
                    title = f"WATCH · {label}"
                    if new_zone:
                        body = f"New zone. {who} takes {n} shots. Watch which asteroids it chooses and what it gets."
                    else:
                        body = f"Same zone, different partner. {who} takes {n} shots. Watch which asteroids it chooses and what it gets."
                    seen_demonstrators.add(did)

                if who not in watched_in_zone:
                    watched_in_zone.append(who)

                if experience_message_text:
                    e["secondary-overlay-message"] = experience_message_text

            elif e["game"] == "play":
                n = num_pulls_per_play_game
                tail = f"You have {n} shots. Every shot counts toward your TOTAL REWARD."
                # Every partner watched in this zone is named (never just the latest
                # one) so the copy doesn't nudge the participant toward one of them.
                names = _join_names(watched_in_zone)
                nth = ordinals[plays_in_zone] if plays_in_zone < len(ordinals) else f"{plays_in_zone + 1}th"
                if e["game_index"] == last_play_by_zone.get(z):
                    # Final visit to this zone: say so, and that the next zone starts
                    # from scratch, so there is no exploration motive on the last shots.
                    title = "YOUR TURN · LAST SHOTS IN THIS ZONE"
                    if plays_in_zone > 0 and watched_in_zone:
                        recap = f"You've mined here, and you've watched {names} mine here. "
                    elif plays_in_zone > 0:
                        cardinals = ["once", "twice", "three times", "four times", "five times", "six times", "seven times", "eight times"]
                        times = cardinals[plays_in_zone - 1] if plays_in_zone <= len(cardinals) else f"{plays_in_zone} times"
                        recap = f"You've mined here {times} already. "
                    elif watched_in_zone:
                        recap = f"You've watched {names} mine here. "
                    else:
                        recap = ""
                    visit = "final" if plays_in_zone > 0 else "only"
                    body = (f"This is your {visit} visit to this zone. {recap}Use it now: the next zone "
                            f"after this will start from scratch with new asteroids and new reward yields. {tail}")
                elif new_zone:
                    title = "YOUR TURN · NEW ZONE"
                    body = f"New zone, new asteroids. {tail}"
                else:
                    title = "YOUR TURN"
                    just_watched = prev_game == "watch"
                    if plays_in_zone == 0:
                        # First time mining in this zone.
                        if len(watched_in_zone) == 1 and just_watched:
                            lead = "Same zone as the partner you just watched."
                        elif watched_in_zone:
                            lead = f"Same zone where you watched {names} mine."
                        else:
                            lead = "Same zone."
                    else:
                        # Played here before.
                        if watched_in_zone:
                            lead = (f"It's your turn to play in the same zone again: you've mined here, "
                                    f"and you've watched {names} mine here too. Use what you've learned.")
                        else:
                            lead = (f"It's your turn to play in the same zone again. This is your {nth} "
                                    "time mining here. Use what you've learned.")
                    body = f"{lead} {tail}"
                plays_in_zone += 1
            # choice-like / feedback inside a round: no overlay copy — rare and the
            # experimenter is on their own. Stage still gets zone_meta from the dict swap above.

            if is_first_game and not session_has_presentation:
                # No presentation slide (all-play session, or presentation disabled): announce
                # the expedition on the first transition slide instead.
                if session_has_demos:
                    title = f"EXPEDITION {sess_i} · {zones_title}, NEW PARTNERS"
                    lead = f"You're heading {zones_into} with two new partner starships. "
                else:
                    title = f"EXPEDITION {sess_i} · {zones_title}, FLYING SOLO"
                    lead = f"No partners on this trip. You'll shoot on your own {zones_across}. "
                body = lead + _reward_line(sess_i) + ("\n\n" + body if body else "")

            if title:
                e["overlay-title"] = title
            if body:
                e["overlay-message"] = body
            is_first_game = False
            prev_zone = z
            prev_game = e["game"]

        # 9c) End stages (choice + feedback) — zone, demo data, overlay copy
        for stage in end_stages:
            cz = stage["zone"]["zone_global_index"]
            stage["zone"] = zone_meta[cz]
            stage["demonstrator1"] = _build_demo_data(0, dem_ids, demo_style_color, demo_names, name_demonstrators)
            stage["demonstrator2"] = _build_demo_data(1, dem_ids, demo_style_color, demo_names, name_demonstrators)

            if stage.get("game") in CHOICE_LIKE_TOKENS:
                stage["display_order"] = list(display_order)
                stage["overlay-title"] = "END OF EXPEDITION · CHOOSE A PARTNER"
                # Hypothetical: the participant never actually watches the chosen partner,
                # and the choice zone is always a new, unplayed one.
                stage["overlay-message"] = (
                    "Imagine you were about to play again in a brand-new zone and could watch one partner shoot first. "
                    "Which starship would you choose?"
                )

    # --- 10) Practice session ---
    practice_zone = zone_meta[0]
    bonus_line = (
        f"BONUS: You will receive a {bonus_currency}{bonus_per_reward:.2f} bonus for each point "
        "you earn in mining rewards.\n\n"
        if bonus_per_reward is not None else ""
    )
    intro_message = (
        "[BOLD]PLEASE READ CAREFULLY:[/BOLD]\n\n"
        "Welcome to Fortune Frontier. In this game you will pilot the starship "
        "\"Prospector\" and mine ASTEROIDS by shooting them. "
        "Some asteroids yield more rewards than others.\n\n"
        "GOAL: Mine as much reward as possible by finding the best asteroids and shooting them.\n\n"
        "EXPEDITIONS: Your trip is split into expeditions. Each expedition takes you through "
        "asteroid zones, usually alongside two partner starships.\n\n"
        "ZONES: You will enter multiple asteroid zones (indicated by a zone number). "
        "Sometimes you will repeat the same zone with the same asteroids and hence the same reward yields. "
        "Sometimes you will move on to new zones with different asteroids and different reward yields.\n\n"
        "STARSHIP PARTNERS: You will also watch starship partners shoot asteroids. "
        "Some partners are much better at finding rewarding asteroids than others, and a partner "
        "that mines well in one zone will mine well in the next. Pay close attention to which "
        "asteroids each partner shoots and what it gets, so you can decide how much to trust it "
        "when it's your turn.\n\n"
        + bonus_line +
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
                "instruction3": "shoot the asteroid with spacebar",
                "instruction3_image": "mine.gif",
                "instruction4": "green indicates successful mining\n(increases reward)",
                "instruction4_image": "successful_mine.png",
                "instruction5": "red indicates unsuccessful mining\n(no reward)",
                "instruction5_image": "unsuccessful_mine.png",
                "instruction6": (
                    "You mine rewards from asteroids by shooting them. "
                    "Some asteroids yield reward more often than others. "
                    "Get optimal rewards by finding the asteroids that yield reward often!"
                ),
            },
        },
        {
            "stage_type": "instructions",
            "message": "How to Play",
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
            },
        },
        {
            "game": "practice",
            "demonstrator": None,
            "game_index": 0,
            "num_arm_pulls": num_pulls_per_play_game,
            "transfer": None,
            "stage_index": 0,
            "round_index": 0,
            "session_index": 0,
            "session_total_rounds": 0,
            "zone": practice_zone,
            "overlay-title": "PRACTICE",
            "overlay-message": "Get a feel for the controls. This round doesn't count toward your reward.",
        },
    ]

    return [practice_session] + raw_sessions


def _required(cfg: Dict[str, Any], key: str) -> Any:
    if key not in cfg:
        raise KeyError(f"required config field {key!r} is missing")
    return cfg[key]


if __name__ == "__main__":
    # --- Read config (fail loudly on missing required fields) ---
    try:
        with open('../config.json', 'r') as f:
            config = json.load(f)
    except Exception as e:
        print(f"FATAL: Could not read ../config.json: {e}", file=sys.stderr)
        sys.exit(1)

    # Required fields
    round_game_sequence_conditions = _required(config, 'round_game_sequence_conditions')
    session_end_stages = _required(config, 'session_end_stages')
    num_rounds = _required(config, 'num_rounds')
    num_pulls_per_play_game = _required(config, 'num_pulls_per_play_game')
    num_pulls_per_watch_game = _required(config, 'num_pulls_per_watch_game')
    demo_1_prior_experience = _required(config, 'demo_1_prior_experience')
    demo_2_prior_experience = _required(config, 'demo_2_prior_experience')
    bandit_payoffs = _required(config, 'bandit_payoffs')
    sampling_method = _required(config, 'sampling_method')
    bandit_assignment_mode = _required(config, 'bandit_assignment_mode')

    # Optional fields with defaults
    num_sessions = config.get('num_sessions', None)
    num_times_conditions_repeat = config.get('num_times_conditions_repeat', 1)
    prop_of_sessions = config.get('prop_of_sessions', 1.0)
    experience_message_text = config.get('experience_message_text', None)
    name_demonstrators = config.get('name_demonstrators', False)
    present_demonstrators_apriori = config.get('present_demonstrators_apriori', False)
    demonstrator_sampling_strategy = config.get('demonstrator_sampling_strategy', 'thompson')
    total_reward_scope = config.get('total_reward_scope', 'per_session')
    report_play_rewards_between_rounds = config.get('report_play_rewards_between_rounds', False)
    bonus_per_reward = config.get('bonus_per_reward', None)
    bonus_currency = config.get('bonus_currency', '$')

    # request_id from argv (used to name the backup file)
    if len(sys.argv) > 1:
        request_id = sys.argv[1]
    else:
        import time
        request_id = f"timeline_{int(time.time())}"

    tl = generate_timeline(
        round_game_sequence_conditions=round_game_sequence_conditions,
        session_end_stages=session_end_stages,
        num_rounds=num_rounds,
        num_pulls_per_play_game=num_pulls_per_play_game,
        num_pulls_per_watch_game=num_pulls_per_watch_game,
        demo_1_prior_experience=demo_1_prior_experience,
        demo_2_prior_experience=demo_2_prior_experience,
        bandit_payoffs=bandit_payoffs,
        sampling_method=sampling_method,
        num_sessions=num_sessions,
        num_times_conditions_repeat=num_times_conditions_repeat,
        prop_of_sessions=prop_of_sessions,
        bandit_assignment_mode=bandit_assignment_mode,
        experience_message_text=experience_message_text,
        name_demonstrators=name_demonstrators,
        present_demonstrators_apriori=present_demonstrators_apriori,
        demonstrator_sampling_strategy=demonstrator_sampling_strategy,
        total_reward_scope=total_reward_scope,
        report_play_rewards_between_rounds=report_play_rewards_between_rounds,
        bonus_per_reward=bonus_per_reward,
        bonus_currency=bonus_currency,
    )

    print(json.dumps(tl))

    try:
        backup_filename = f'../timelines/timeline_{request_id}.json'
        with open(backup_filename, 'w') as f:
            json.dump(tl, f, indent=4)
    except Exception as e:
        print(f"Warning: Could not write backup file: {e}", file=sys.stderr)
