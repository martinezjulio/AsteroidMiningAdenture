# Configuration Options

The `config.json` file controls various aspects of timeline generation and game behavior.

## Configuration Parameters

### `experiment_config`
- **Type**: String (file path)
- **Default**: `"configs/timeline.json"`
- **Description**: Path to the timeline configuration file

### `bandit_assignment_mode`
- **Type**: String
- **Options**: `"session_fixed"` or `"round_changing"`
- **Default**: `"session_fixed"`
- **Description**:
  - `"session_fixed"`: Same zone (bandit) for entire session
  - `"round_changing"`: Different zone for each round within a session

### `textbox_feedback`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Whether to include a feedback textbox stage after choice stages

### `session_demonstrators` ⭐ NEW
- **Type**: String
- **Options**: `"all"` or `"different"`
- **Default**: `"all"`
- **Description**: Controls which demonstrator type combinations are generated
  - `"all"`: Generates all 4 combinations:
    - Expert + Expert
    - Expert + Novice
    - Novice + Expert
    - Novice + Novice
  - `"different"`: Generates only sessions where demonstrators have different types:
    - Expert + Novice
    - Novice + Expert
    - ❌ Excludes: Expert + Expert and Novice + Novice

### `prop_of_sessions` ⭐ NEW
- **Type**: Number (float between 0.0 and 1.0+)
- **Default**: `0.5`
- **Description**: Proportion of generated sessions to include in the timeline
  - `1` or `1.0`: Use ALL generated sessions
  - `0.5`: Use HALF of the generated sessions (randomly selected)
  - `0.25`: Use QUARTER of the sessions
  - Values ≥ 1.0 will keep all sessions
  - Always keeps at least 1 session minimum

## Example Configurations

### Default (All Session Types, Half Selected)
```json
{
    "experiment_config": "configs/timeline.json",
    "bandit_assignment_mode": "session_fixed",
    "textbox_feedback": false,
    "session_demonstrators": "all",
    "prop_of_sessions": 0.5
}
```

### Only Mixed Demonstrator Types (All Sessions)
```json
{
    "experiment_config": "configs/timeline.json",
    "bandit_assignment_mode": "round_changing",
    "textbox_feedback": true,
    "session_demonstrators": "different",
    "prop_of_sessions": 1
}
```

## Session Selection

After generating sessions based on these patterns, the system:
1. Shuffles all generated sessions
2. Selects a **proportion** of them based on `prop_of_sessions`

### Examples

**With `"session_demonstrators": "all"` (4 patterns generated)**
- `"prop_of_sessions": 1` → 4 sessions in timeline
- `"prop_of_sessions": 0.5` → 2 sessions randomly selected
- `"prop_of_sessions": 0.25` → 1 session randomly selected

**With `"session_demonstrators": "different"` (2 patterns generated)**
- `"prop_of_sessions": 1` → 2 sessions in timeline (Expert/Novice AND Novice/Expert)
- `"prop_of_sessions": 0.5` → 1 session randomly selected

## Notes

- Changes to `config.json` require regenerating the timeline (restart the server or generate new timeline)
- Invalid values will cause the system to fall back to defaults
- The `session_demonstrators` filter is applied before the randomization and half-selection

