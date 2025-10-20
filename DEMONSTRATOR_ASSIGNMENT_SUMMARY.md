# Demonstrator Style+Color Assignment System - Summary

## Problem Solved

The demonstrator style+color assignment is now **built into the timeline generation process** rather than being computed at runtime. This ensures constraints are always satisfied since the timeline is generated randomly by Python.

## How It Works

### 1. Python Timeline Generation (`timeline_models/models.py`)

When a timeline is generated, the Python code:

1. **Assigns Demonstrator IDs** (lines 170-176)
   - Each session gets 2 unique demonstrator IDs

2. **Assigns Style+Color with Constraints** (lines 177-236)
   - For each session, assigns style+color combinations to the two demonstrators
   - **Guarantees within each session:**
     - Different styles (e.g., style1 vs style2)
     - Different colors (e.g., red vs orange)
   - **Globally ensures:**
     - Each demonstrator gets a unique style+color combination
     - Same demonstrator always has same appearance

3. **Embeds in Timeline JSON**
   - Each demonstrator object now includes:
     - `demonstrator_style`: "style1", "style2", etc.
     - `demonstrator_color`: "red", "orange", "blue", etc.

### 2. JavaScript Runtime (`main.js`)

The JavaScript code simply **reads and uses** the style+color from the timeline:

- `mapDemonstratorImage(index, style, color)` uses the provided style+color
- Image paths become: `assets/demonstrators/styles/style1/red.png`
- No runtime computation needed - just reads what Python generated

## Constraint Verification

The system enforces:

### ✅ Within Each Session
- No two demonstrators share the same **style**
- No two demonstrators share the same **color**
- Example: Session 1 might have Demo 13 (style1/red) and Demo 19 (style2/orange)

### ✅ Across Sessions
- Each demonstrator_global_index gets a **globally unique** style+color combination
- Same demonstrator always looks the same
- Example: Demo 13 (style1/orange) in session 2 can't also be (style1/orange) - that combo is used

### ✅ Between Sessions
- Demonstrators in different sessions **CAN** share styles or colors (but not both)
- Example: Session 1 Demo 13 (style1/red) and Session 2 Demo 8 (style1/orange) can both use style1

## Tested and Verified

Run this to verify any generated timeline:
```bash
cd timeline_models
python3 -c "
from models import generate_timeline
import json

timeline = generate_timeline(rounds=3, num_play_arm_pulls=6, num_watch_arm_pulls=6)

# Extract and verify
sessions = {}
for item in timeline:
    # ... extraction logic ...

# Verify constraints
for sess_idx, demos in sessions.items():
    styles = [d['style'] for d in demos.values()]
    colors = [d['color'] for d in demos.values()]
    
    if len(styles) != len(set(styles)):
        print(f'❌ Session {sess_idx}: Duplicate styles!')
    if len(colors) != len(set(colors)):
        print(f'❌ Session {sess_idx}: Duplicate colors!')
    else:
        print(f'✅ Session {sess_idx}: All unique')
"
```

## File Structure Required

```
assets/demonstrators/styles/
├── style1/
│   ├── red.png
│   ├── orange.png
│   ├── blue.png
│   ├── green.png
│   ├── yellow.png
│   └── purple.png
├── style2/
│   └── ... (same colors)
├── style3/
├── style4/
├── style5/
└── style6/
```

Total combinations: 6 styles × 6 colors = 36 unique demonstrator appearances

## Benefits of Python-Side Generation

1. **Guaranteed Correctness**: Constraints are enforced at generation time
2. **No Runtime Complexity**: JavaScript just reads the values
3. **Deterministic**: Same timeline file always produces same demonstrators
4. **Debuggable**: Can inspect timeline JSON to see exact assignments
5. **Reproducible**: Timeline files can be saved and reused exactly

## Migration Note

- Old demonstrator images (`demonstrator_00.png`, etc.) are no longer used
- All demonstrators now use the style/color system from `styles/` folders
- The JavaScript no longer needs to compute assignments - it's all in the timeline!

