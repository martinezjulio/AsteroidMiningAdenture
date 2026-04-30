# Spatial Bandits Game (Mining2D)

A spatial multi-armed bandit game with MongoDB logging, featuring asteroid mining, demonstrator learning, and choice-based gameplay.

<img width="848" alt="Mining2D" src="https://github.com/user-attachments/assets/37a1bf48-4178-451c-a4bd-d93a9445038a" />

## Quick Start

### Prerequisites
- **Node.js** (version 14 or higher)
- **MongoDB** (local installation or remote access)

### Installation
```bash
# Clone the repository
git clone [your-repo-url]
cd SpatialBanditsGame

# Install dependencies
npm install
```

### Running the Game

The server reads its MongoDB connection string from the `MONGODB_URI` environment variable (required — the server exits if it's unset).

#### Development Mode (Local)
```bash
# Start a local MongoDB
brew services start mongodb-community   # macOS
# sudo systemctl start mongod           # Linux
# net start MongoDB                     # Windows

# Point the app at it
export MONGODB_URI='mongodb://localhost:27017/AMGDB'

# Start with auto-restart on file changes
npm run dev

# Or start normally
npm start
```
Game accessible at `http://localhost:8080`.

#### Custom Port
```bash
PORT=3000 MONGODB_URI='mongodb://localhost:27017/AMGDB' npm start
```

#### Production Deployment

The recommended production deployment is **Google Cloud Run + MongoDB Atlas** — see [Deploying to Cloud Run + Atlas](#deploying-to-cloud-run--atlas) below.

If you prefer a self-hosted VM, just export `MONGODB_URI` (and `NODE_ENV=production` to bind on `0.0.0.0`) before running `npm start`. Front it with whatever reverse proxy you like.

## Deploying to Cloud Run + Atlas

The repo ships with a `Dockerfile` and `.dockerignore` for Google Cloud Run.

### One-time setup

1. **MongoDB Atlas** (cloud.mongodb.com)
   - Create a free **M0** cluster.
   - **Database Access** → add a user with `readWrite` on database `AMGDB`.
   - **Network Access** → allow `0.0.0.0/0` (Cloud Run egresses from a dynamic IP pool unless a Serverless VPC connector is configured).
   - Grab the SRV connection string and substitute the password and database:
     `mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/AMGDB?retryWrites=true&w=majority`

2. **Google Cloud project** — pick or create one and link a billing account (Cloud Run free tier still applies; billing is required to enable APIs).

### Deploy

```bash
# 1. Project + APIs (one-time)
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com secretmanager.googleapis.com

# 2. Store the Atlas URI in Secret Manager (one-time)
printf '%s' 'mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/AMGDB?...' \
  | gcloud secrets create MONGODB_URI --data-file=- --replication-policy=automatic

# Grant the default Cloud Run service account read access
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding MONGODB_URI \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 3. Deploy (idempotent — re-run to push updates)
gcloud run deploy asteroid-mining-game \
  --source . \
  --region us-east4 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 8 \
  --timeout 60 \
  --min-instances 0 \
  --max-instances 4 \
  --set-secrets MONGODB_URI=MONGODB_URI:latest
```

Pick a Cloud Run region close to your Atlas region — `us-east4` (Virginia) co-locates with Atlas AWS `us-east-1`.

### Updating the Atlas password later

```bash
printf '%s' 'mongodb+srv://NEW_URI...' \
  | gcloud secrets versions add MONGODB_URI --data-file=-
```
Cloud Run picks up the new version on the next request because the deploy uses `MONGODB_URI:latest`.

## Game Configuration

The game behavior is controlled through the `config.json` file in the root directory. This file allows you to customize experimental parameters without modifying the code.

### Configuration Options

#### `experiment_config`
- **Type**: `string`
- **Default**: `"configs/timeline.json"`
- **Description**: Path to the timeline configuration file (currently used for fallback scenarios)

#### `bandit_assignment_mode`
- **Type**: `string`
- **Default**: `"session_fixed"`
- **Options**:
  - `"session_fixed"`: All rounds within a session use the same bandit (same reward structure)
  - `"round_changing"`: Each round within a session uses a different bandit (different reward structure)

#### `textbox_feedback`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Controls the end-game experience
- **Options**:
  - `false`: Show direct Prolific redirect button (original behavior)
  - `true`: Show feedback form asking about partner choice before Prolific redirect

#### `session_demonstrators`
- **Type**: `string`
- **Default**: `"all"`
- **Options**:
  - `"all"`: Generates all 4 combinations (Expert+Expert, Expert+Novice, Novice+Expert, Novice+Novice)
  - `"different"`: Generates only sessions where demonstrators have different types (Expert+Novice, Novice+Expert)

#### `prop_of_sessions`
- **Type**: `number` (float between 0.0 and 1.0+)
- **Default**: `0.5`
- **Description**: Proportion of generated sessions to include in the timeline
  - `1.0`: Use ALL generated sessions
  - `0.5`: Use HALF of the generated sessions (randomly selected)
  - `0.25`: Use QUARTER of the sessions
  - Values ≥ 1.0 will keep all sessions
  - Always keeps at least 1 session minimum

#### `omit_explicit_experience_transfer_message`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Controls whether to display explicit messages about demonstrators' experience levels
  - `true`: Omits experience transfer messages from intro and watch transitions
  - `false`: Includes explicit experience transfer messages (default behavior)

#### `name_demonstrators`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Whether to assign names to demonstrators

#### `present_demonstrators_apriori`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Whether to present demonstrators before gameplay begins

#### `display_running_total_reward`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Whether to display a running total of rewards during gameplay

#### `demonstrator_config`
- **Type**: `object`
- **Default**: `null` (uses file mode with default settings)
- **Description**: Controls how demonstrator trajectories are generated

The `demonstrator_config` option determines whether demonstrator trajectories are loaded from a pre-computed file or generated in real-time using Thompson sampling.

**File Mode (Pre-computed Trajectories):**
```json
{
  "demonstrator_config": {
    "source": "file",
    "filename": "bandits_data.json"
  }
}
```
- Trajectories are loaded from the specified file in `timeline_models/`
- File must contain pre-computed Thompson sampling trajectories
- Each demonstrator follows a pre-defined path
- Reward outcomes are sampled randomly during gameplay
- This is the traditional mode used when `demonstrator_config` is not specified

**Inline Mode (Real-time Generation):**
```json
{
  "demonstrator_config": {
    "source": "inline",
    "bandit_payoffs": [0.0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.75, 0.8],
    "expert_demonstrator_experience": 72,
    "novice_demonstrator_experience": 0,
    "demonstrator_sampling_strategy": "thompson"
  }
}
```

**Inline Mode Parameters:**
- `bandit_payoffs`: Sorted list of reward probabilities (one per arm/asteroid)
- `expert_demonstrator_experience`: Number of warmup iterations for expert demonstrators (e.g., 72)
- `novice_demonstrator_experience`: Number of warmup iterations for novice demonstrators (e.g., 0)
- `demonstrator_sampling_strategy`: Algorithm to use (currently only "thompson" is supported)

**How Inline Mode Works:**
1. Each zone's bandit is a random permutation of `bandit_payoffs`
2. When a watch stage starts, a Thompson sampler is initialized with alpha=1, beta=1 for all arms
3. Warmup iterations run invisibly (0 for novice, 72 for expert)
4. Then the trajectory is shown to the user, continuing from the current alpha/beta state
5. Rewards shown to the user ARE the rewards that influence the demonstrator's next action
6. All actions and rewards (including warmup) are logged to MongoDB as JSON strings

**Differences from File Mode:**
- Trajectories are never the same twice (stochastic generation)
- Reward outcomes are consistent with demonstrator decisions (not random)
- Complete action/reward sequences are logged for post-hoc analysis
- Allows computing final alpha/beta values: `alpha_i = 1 + sum(rewards for arm i)`
- No need to pre-generate large trajectory files

**Thompson Sampling Algorithm:**
The inline mode uses Beta-Bernoulli Thompson sampling:
- Initialize: `alpha_i = 1`, `beta_i = 1` for all arms
- Each iteration:
  1. Sample `theta_i ~ Beta(alpha_i, beta_i)` for each arm
  2. Choose arm `a = argmax(theta_i)`
  3. Sample reward `r ~ Bernoulli(payoff[a])`
  4. Update: `alpha_a += r`, `beta_a += (1-r)`

**Logged Data:**
- `demonstrator_actions`: JSON string array of all arm indices selected (e.g., `"[0,1,2,5,1,2,4,5,...]"`)
- `demonstrator_rewards`: JSON string array of all rewards received (e.g., `"[1,0,0,1,1,1,0,1,...]"`)
- `demonstrator_source`: "inline" or "file" (indicates generation mode)
- `demonstrator_experience`: Warmup iterations used (e.g., 128 for expert, 0 for novice)
- `demonstrator_strategy`: Sampling strategy (e.g., "thompson")
- `demonstrator_bandit_payoffs`: JSON array of payoffs used for generation
- For inline mode: actions/rewards include both warmup iterations (not shown) and displayed iterations
- For file mode: actions/rewards contain only the displayed trajectory
- Example: Expert with 128 warmup + 6 shown = 134 total entries in inline mode
- Look for `action: "trajectory_complete"` entries to get the complete trajectory data

### Example Configuration

```json
{
    "experiment_config": "configs/timeline.json",
    "bandit_assignment_mode": "session_fixed",
    "textbox_feedback": false,
    "session_demonstrators": "all",
    "prop_of_sessions": 0.5,
    "omit_explicit_experience_transfer_message": false,
    "name_demonstrators": false,
    "present_demonstrators_apriori": false,
    "display_running_total_reward": false,
    "demonstrator_config": {
        "source": "file",
        "filename": "bandits_data.json"
    }
}
```

**Or with inline mode:**
```json
{
    "experiment_config": "configs/timeline.json",
    "bandit_assignment_mode": "round_changing",
    "textbox_feedback": true,
    "session_demonstrators": "different",
    "prop_of_sessions": 1.0,
    "omit_explicit_experience_transfer_message": true,
    "name_demonstrators": true,
    "present_demonstrators_apriori": true,
    "display_running_total_reward": true,
    "demonstrator_config": {
        "source": "inline",
        "bandit_payoffs": [0.0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.75, 0.8],
        "expert_demonstrator_experience": 72,
        "novice_demonstrator_experience": 0,
        "demonstrator_sampling_strategy": "thompson"
    }
}
```

### Bandit Assignment Modes Explained

#### Session Fixed Mode (`"session_fixed"`)
- **Default behavior**
- All rounds within a session share the same bandit/zone
- Example: Session 1 has 3 rounds, all using Zone 1 with the same asteroid reward rates
- Different sessions use different bandits/zones

#### Round Changing Mode (`"round_changing"`)
- Each round within a session uses a different bandit/zone
- Example: Session 1 has 3 rounds using Zone 1, Zone 2, and Zone 3 respectively
- Provides more variety within each session
- Useful for studying adaptation to changing environments

### End-Game Feedback System

#### Standard Mode (`textbox_feedback: false`)
- **Default behavior**
- Game ends with direct "Return to Prolific" button
- Immediate redirect to Prolific completion page

#### Feedback Mode (`textbox_feedback: true`)
- Shows feedback form at game completion
- Displays image of the partner the user chose in their final choice game
- Asks: "Why did you choose the following partner?"
- User must provide text response before proceeding to Prolific
- Feedback responses are automatically saved to MongoDB
- After submission, user is redirected to Prolific

### Switching Between Modes

To change the experimental condition:

1. **Edit `config.json`**:
   ```json
   {
       "experiment_config": "configs/timeline.json",
       "bandit_assignment_mode": "round_changing",
       "textbox_feedback": true,
       "session_demonstrators": "different",
       "prop_of_sessions": 1.0
   }
   ```

2. **Restart the server** to apply changes:
   ```bash
   npm start
   ```

3. **New users** will automatically receive timelines generated with the new mode

**Note**: Existing users who already have generated timelines will continue with their original assignment mode until they start a new session.

## Dynamic Timeline System

The game generates **fresh, randomized timelines** for each user, ensuring no two participants have the same experience.

### How It Works

1. **User visits site** → Frontend requests timeline from `/api/timeline`
2. **Server receives request** → Checks concurrency capacity and queues if needed
3. **Python generates timeline** → Runs `models.py` script with randomized parameters
4. **Server returns timeline** → Frontend loads the unique timeline
5. **User plays game** → With their personalized, randomized experience

### Concurrency Management

The system handles multiple simultaneous users safely and efficiently:

- **Maximum 3 concurrent Python processes** (configurable)
- **Automatic queuing** for additional requests (FIFO)
- **Unique request handling** with request IDs: `timeline_{timestamp}_{random}`
- **Separate backup files** prevent conflicts: `configs/timeline_{requestId}.json`
- **Automatic cleanup** of old backup files (hourly)
- **Timeout protection**: 30-second maximum generation time

### Request Flow

```
User Request → Queue Check → Process or Queue → Python Generation → Response
                    ↓                               ↓
          If capacity available              Unique backup file
                    ↓                               ↓
              Start generation                 JSON to stdout
                    ↓                               ↓
           Track active count                Return to user
```

### Python Execution

- **Auto-detects** Python command (`python3`, `python`, or `py`)
- **Fallback system**: If Python execution fails, falls back to static `timeline.json`
- **Generation time**: Typically 1-3 seconds per timeline
- **No caching**: Fresh generation per user ensures uniqueness

### Benefits

**For Researchers:**
- Better experimental control - no order effects from repeated timelines
- Increased statistical power - each participant has unique randomization
- Reproducible - session-specific randomization seeds can be logged

**For Participants:**
- Fresh experience - no predictability from shared timelines
- Improved validity - authentic decision-making without prior knowledge

**For Deployment:**
- No manual updates - timeline generation is automatic
- Scalable - handles multiple concurrent users
- Robust - fallback to static timeline if generation fails

## Timeline.json Structure

The `data/timeline.json` file defines the entire game experience. It's structured as an array of **sessions**, where each session contains **stages**.

### Basic Structure
```json
[
  // Session 1
  [
    // Stages in session 1
    {...stage1...},
    {...stage2...}
  ],
  // Session 2 (nested arrays)
  [
    // Container 1 in session 2
    [
      {...stage1...},
      {...stage2...}
    ],
    // Container 2 in session 2  
    [
      {...stage3...},
      {...stage4...}
    ]
  ]
]
```

### Session Types

#### Simple Sessions
```json
[
  {stage1}, {stage2}, {stage3}
]
```

#### Nested Sessions (Multiple Containers)
```json
[
  [ {stage1}, {stage2} ],  // Container 1
  [ {stage3}, {stage4} ]   // Container 2
]
```

## Game Types

### 1. **Prolific ID Form**
```json
{
  "stage_type": "prolific_id_form",
  "message": "Please enter your Prolific ID below:"
}
```

### 2. **Introduction**
```json
{
  "stage_type": "introduction",
  "message": "Welcome text that appears on screen",
  "instructions": {
    "instruction1": "Move left and right with arrow keys",
    "instruction1_image": "move_left_right.gif",
    "instruction2": "Move up and down with arrow keys", 
    "instruction2_image": "move_up_down.gif",
    "instruction3": "Press spacebar to mine asteroid",
    "instruction3_image": "mine.gif",
    "instruction4": "green indicates successful mining\n(increases reward)",
    "instruction4_image": "success.png",
    "instruction5": "red indicates unsuccessful mining\n(no reward)",
    "instruction5_image": "failure.png",
    "instruction6": "Final instruction text (optional)"
  }
}
```

### 3. **Instructions**
```json
{
  "stage_type": "instructions", 
  "message": "Game Instructions",
  "instructions": {
    "instruction1": "Move left and right with arrow keys",
    "instruction1_image": "move_left_right.gif",
    "instruction2": "Move up and down with arrow keys", 
    "instruction2_image": "move_up_down.gif",
    "instruction3": "Press spacebar to mine asteroid",
    "instruction3_image": "mine.gif",
    "instruction4": "green indicates successful mining\n(increases reward)",
    "instruction4_image": "success.png",
    "instruction5": "red indicates unsuccessful mining\n(no reward)",
    "instruction5_image": "failure.png",
    "instruction6": "Final instruction text (optional)"
  }
}
```

### 4. **Practice**
```json
{
  "game": "practice",
  "demonstrator": null,
  "game_index": 0,
  "num_arm_pulls": 6,
  "transfer": null,
  "stage_index": 0,
  "round_index": 0,
  "session_index": 0,
  "zone": {...zone_object...}
}
```

### 5. **Play**
```json
{
  "game": "play", 
  "demonstrator": null,
  "game_index": 1,
  "num_arm_pulls": 6,
  "transfer": null,
  "stage_index": 0,
  "round_index": 0,
  "session_index": 1,
  "zone": {...zone_object...}
}
```

### 6. **Watch** 
```json
{
  "game": "watch",
  "demonstrator": {...demonstrator_object...},
  "game_index": 0,
  "num_arm_pulls": 6,
  "transfer": null,
  "stage_index": 0,
  "round_index": 0,
  "session_index": 1,
  "zone": {...zone_object...},
  "overlay-message": "Watch message text"
}
```

### 7. **Choice**
```json
{
  "game": "choice",
  "game_index": 8,
  "num_arm_pulls": null,
  "transfer": false,
  "stage_index": 1,
  "round_index": null,
  "session_index": 2,
  "zone": {...zone_object...},
  "demonstrator1": {...demonstrator_object...},
  "demonstrator2": {...demonstrator_object...},
  "overlay-message": "Choose between starships message"
}
```

### 8. **Online-Choice**
```json
{
  "game": "online-choice",
  "choice_game_index": 8,
  "watch_game_index": 9,
  "num_arm_pulls": null,
  "transfer": false,
  "stage_index": 1,
  "round_index": null,
  "session_index": 1,
  "zone": {...zone_object...},
  "demonstrator1": {...demonstrator_object...},
  "demonstrator2": {...demonstrator_object...},
  "choice-overlay-message": "Choose the starship you would watch...",
  "watch-overlay-message": "You will now watch your chosen starship partner."
}
```

## Core Objects

### Zone Object
```json
{
  "zone_index": 1,
  "zone_color": "#f2b179", 
  "zone_background": "zone_01.png",
  "zone_mode": "asteroid",  // or "landscape"
  "zone_images": [
    "asteroid_12.png",
    "asteroid_49.png"
  ],
  "zone_bandit": [
    [0.35, 0.4, 0.55, 0.6, 0.75, 0.1, 0.5, 0.0, 0.8, 0.3, 0.2, 0.45]
  ],
  "bandit_id": "payoffs29"
}
```

**Zone Properties:**
- `zone_index`: Unique identifier for the zone
- `zone_color`: Hex color for borders and UI elements
- `zone_background`: Background image file (optional)
- `zone_mode`: `"asteroid"` (individual images per cell) or `"landscape"` (single masked image)
- `zone_images`: Array of image files for the zone
- `zone_bandit`: 2D array of reward probabilities (0.0-1.0)
- `bandit_id`: Identifier for the payoff structure

### Demonstrator Object
```json
{
  "demonstrator_type": "expert",
  "demonstrator_index": 0,
  "demonstrator_id": 1, 
  "demonstrator_image": "demonstrator_01.png",
  "demonstrator_trajectory": [8, 8, 11, 6, 8, 8]
}
```

**Demonstrator Properties:**
- `demonstrator_type`: "expert", "novice", etc.
- `demonstrator_index`: Index for image mapping system
- `demonstrator_id`: Unique identifier
- `demonstrator_image`: Image file for the demonstrator
- `demonstrator_trajectory`: Array of linear cell indices showing movement path

### Stage Properties

#### Property Usage Patterns
The timeline uses two different property naming patterns:

**Meta Stages** (setup/instruction phases):
- Use `stage_type`: "prolific_id_form", "introduction", "instructions"
- Do not have `game_index`, `session_index`, etc.

**Game Stages** (actual gameplay):
- Use `game`: "practice", "play", "watch", "choice", "online-choice"
- Include full tracking properties: `game_index`, `session_index`, `stage_index`, etc.

#### Common Properties for Game Stages
- `game`: Game type ("practice", "play", "watch", "choice", "online-choice")
- `game_index`: Sequential game number within session
- `stage_index`: Stage number within session container
- `session_index`: Session number (0-based)
- `round_index`: Round number (can be null)
- `num_arm_pulls`: Number of actions allowed (null for choice games)
- `demonstrator`: Demonstrator object (null for play/practice games)

#### Special Properties for Online-Choice
- `choice_game_index`: Game index for the choice phase
- `watch_game_index`: Game index for the watch phase
- `choice-overlay-message`: Text for choice phase
- `watch-overlay-message`: Text for watch phase

#### Transfer Learning
- `transfer`: Boolean indicating if this is a transfer condition

#### Overlay Messages
- `overlay-message`: Text shown in transition overlay
- `choice-overlay-message`: Text for choice phase (online-choice only)
- `watch-overlay-message`: Text for watch phase (online-choice only)

## Demonstrator Visual System

The game uses a sophisticated style+color assignment system for demonstrator appearances, ensuring visual distinctiveness within and across sessions.

### How It Works

The demonstrator style+color assignment is **built into the timeline generation process** (Python-side) rather than being computed at runtime.

#### Timeline Generation (`timeline_models/models.py`)

When a timeline is generated, the Python code:

1. **Assigns Demonstrator IDs**: Each session gets 2 unique demonstrator IDs
2. **Assigns Style+Color with Constraints**:
   - Within each session: Different styles AND different colors
   - Globally: Each demonstrator gets a unique style+color combination
   - Same demonstrator always has same appearance across sessions

3. **Embeds in Timeline JSON**: Each demonstrator object includes:
   - `demonstrator_style`: "style1", "style2", etc.
   - `demonstrator_color`: "red", "orange", "blue", etc.

#### JavaScript Runtime (`main.js`)

The JavaScript code simply **reads and uses** the style+color from the timeline:
- `mapDemonstratorImage(index, style, color)` uses the provided style+color
- Image paths: `assets/demonstrators/styles/style1/red.png`
- No runtime computation needed - just reads what Python generated

### Constraints Enforced

#### Within Each Session ✅
- No two demonstrators share the same **style**
- No two demonstrators share the same **color**
- Example: Session 1 might have Demo 13 (style1/red) and Demo 19 (style2/orange)

#### Across Sessions ✅
- Each demonstrator_global_index gets a **globally unique** style+color combination
- Same demonstrator always looks the same
- Example: Demo 13 always appears as (style2/blue) whenever it appears

#### Between Sessions ✅
- Demonstrators in different sessions **CAN** share styles or colors (but not both)
- Example: Session 1 Demo 13 (style1/red) and Session 2 Demo 8 (style1/orange) can both use style1

### File Structure

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
│   └── ... (same 6 colors)
├── style3/
├── style4/
├── style5/
└── style6/
```

**Total combinations**: 6 styles × 6 colors = **36 unique demonstrator appearances**

### Benefits

1. **Guaranteed Correctness**: Constraints are enforced at generation time
2. **No Runtime Complexity**: JavaScript just reads the values
3. **Deterministic**: Same timeline file always produces same demonstrators
4. **Debuggable**: Can inspect timeline JSON to see exact assignments
5. **Reproducible**: Timeline files can be saved and reused exactly

## MongoDB Logging

The game automatically logs all user actions to MongoDB with comprehensive tracking of game state, user behavior, and experimental conditions.

### Database Structure

- **Database**: `AMGDB`
- **Collection**: `gamelogs`
- Each document represents one user action

### Logged Variables

The system logs the following variables for every user action:

#### User Information
- `prolific_id`: Participant's Prolific ID
- `uid`: Auto-generated unique identifier
- `session_id`: MongoDB session identifier

#### Game Progress
- `session_index`: Session number (0-based)
- `step`: Action step counter
- `position`: Current player position
- `action`: User action (`left`, `right`, `up`, `down`, `pull`)
- `timestamp`: Action timestamp

#### Game State
- `shots_remaining`: Number of actions remaining
- `game`: Game type (`practice`, `play`, `watch`, `choice`, `feedback`)
- `game_total_reward`: Total reward in current game
- `user_total_reward`: Cumulative reward across all games

#### Action Details
- `reward_generated`: Reward from current action
- `shot`: Boolean indicating arm pull/mining action

#### Session Info
- `transfer`: Transfer learning condition indicator
- `game_sequence`: Sequence of games in session

#### Stage/Game IDs
- `game_index`: Sequential game number within session
- `stage_index`: Stage number within session container
- `round_index`: Round number (can be null)

#### Demonstrator Info
- `demonstrator_index`: Index for image mapping system
- `demonstrator_type`: "expert", "novice", etc.
- `demonstrator_id`: Unique demonstrator identifier
- `demonstrator_actions`: JSON array of arm indices (e.g., `"[8,8,11,6,8,8]"`)
- `demonstrator_rewards`: JSON array of rewards (e.g., `"[1,0,0,1,1,0]"`)
- `demonstrator_source`: Generation mode - "inline" or "file"
- `demonstrator_experience`: Warmup iterations (inline mode only, e.g., 128 for expert)
- `demonstrator_strategy`: Sampling strategy (inline mode only, e.g., "thompson")
- `demonstrator_bandit_payoffs`: JSON array of payoffs used (inline mode only)
- `demonstrator_style`: Visual style assignment
- `demonstrator_color`: Color assignment

**Note:** For inline mode, actions/rewards include warmup + displayed. For file mode, only displayed trajectory.

#### User Play Data
- `play_actions`: JSON array of arm indices selected by user (e.g., `"[2,5,8,11,6,9]"`)
- `play_rewards`: JSON array of rewards received by user (e.g., `"[1,0,1,1,0,1]"`)

**Note:** These fields are only populated for play games and logged in the `trajectory_complete` action at the end of each play game.

#### Zone Info
- `zone_index`: Unique zone identifier
- `zone_bandit`: JSON string of flattened 2D array (e.g., `"[0.35,0.4,0.55,...]"`)
- `zone_bandit_arm_image_ids`: JSON string array of image filenames (e.g., `"[\"asteroid_12.png\",\"asteroid_49.png\",...]"`)
- `zone_bandit_id`: Identifier for payoff structure

#### Tracking
- `refresh_count`: Page refresh counter

### Logged Actions

- **Movement**: `left`, `right`, `up`, `down` - when user moves position
- **Pulling**: `pull` - when user pulls an arm/shoots an asteroid
- **Feedback**: `feedback` - when user submits end-game feedback

### Special Logging for Online-Choice

The `online-choice` game type is handled specially for logging purposes:
- **Choice phase** → logged as `game: "choice"`
- **Watch phase** → logged as `game: "watch"`

This allows for consistent analysis of choice and watch behaviors regardless of whether they occur as standalone games or as part of an online-choice sequence.

### Feedback Data Collection

When `textbox_feedback: true` is enabled, feedback data is collected in the main `GameLog` collection:

- **Collection**: Main `GameLog` collection (same as all other user actions)
- **Action Type**: `action: "feedback"` and `game: "feedback"`
- **Data Stored**:
  - User identification: `prolific_id`, `uid`, `session_id`
  - Feedback text: `feedback_text` field with user's response
  - Choice context: `choice_demonstrator_id`, `choice_demonstrator_type`
  - Session context: `session_index`, zone information
  - Standard fields: All other GameLog fields for consistency

### Security Note

Never commit MongoDB connection strings to version control. Use environment variables locally and Secret Manager (or equivalent) in production.

## API Endpoints Reference

### Timeline Generation

#### `GET /api/timeline`
Generates and returns a fresh, randomized timeline for each user.

- **Response**: JSON timeline data
- **Behavior**: Automatically queued if server at capacity
- **Generation Time**: Typically 1-3 seconds
- **Concurrency**: Max 3 concurrent generations (configurable)

#### `GET /api/timeline-status`
Returns real-time status of the timeline generation system.

**Response**:
```json
{
  "active_generations": 2,
  "max_concurrent": 3,
  "queue_length": 1,
  "capacity_available": 1,
  "server_time": "2024-01-15T10:30:00.000Z",
  "uptime_seconds": 3600
}
```

#### `GET /api/test-python`
Tests Python installation and verifies timeline generation capabilities.

- **Use**: Debugging and setup verification
- **Response**: Python version and execution status

### Data Logging

#### `POST /api/log`
Log a game action to MongoDB.

- **Body**: Action data including position, reward, game state
- **Response**: Confirmation of logged data

#### `POST /api/log-refresh`
Log a page refresh event.

- **Body**: User identification data
- **Response**: Confirmation of logged refresh

#### `GET /api/logs/:prolific_id`
Retrieve all logs for a specific user (for debugging).

- **Parameters**: `prolific_id` - User's Prolific ID
- **Response**: Array of all logged actions for that user

### Health & Monitoring

#### `GET /api/health`
Comprehensive server health check.

**Returns**:
- Timeline system status
- MongoDB connection status
- Memory usage
- Server uptime
- Active process counts

## Asset Structure

### Required Directories
```
assets/
├── demonstrators/
│   ├── demonstrator_XX.png (legacy, no longer used)
│   └── styles/
│       ├── style1/
│       │   ├── red.png
│       │   ├── orange.png
│       │   ├── blue.png
│       │   ├── green.png
│       │   ├── yellow.png
│       │   └── purple.png
│       ├── style2/ (same 6 colors)
│       ├── style3/
│       ├── style4/
│       ├── style5/
│       └── style6/
├── landscapes/        # landscape_XX.png files  
├── zone_backgrounds/  # zone_XX.png files
├── asteroids/         # asteroid_XX.png files
├── introduction/      # GIF and PNG instruction files
└── user.png          # Player sprite
```

### Image Mapping System

The game uses a randomization system that maps logical indices to shuffled image files, ensuring each playthrough uses different visual assets while maintaining game logic.

**Demonstrator System**: All demonstrators now use the style+color system from the `styles/` folders. The timeline generation assigns each demonstrator a unique style+color combination, providing 36 possible unique appearances (6 styles × 6 colors).

## Testing & Monitoring

### Concurrency Testing

Test the timeline generation system with multiple simultaneous users:

```bash
# Install test dependencies (if not already installed)
npm install

# Run concurrency test (simulates 10 concurrent users)
npm run test-concurrency
```

#### Sample Test Output
```
🧪 Starting concurrency test with 10 users...
📡 Testing server: http://localhost:8080
📊 Server Status: { active_generations: 0, queue_length: 0, ... }

🚀 User 1: Requesting timeline...
🚀 User 2: Requesting timeline...
🚀 User 3: Requesting timeline...
...

✅ User 1: Timeline received in 2341ms (9 sessions)
✅ User 2: Timeline received in 2456ms (9 sessions)
✅ User 3: Timeline received in 2234ms (9 sessions)

📋 Test Results:
Total Users: 10
Successful: 10
Failed: 0
Total Duration: 8234ms
Average Time per User: 823ms
Success Rate: 100.0%
✅ Excellent performance!
```

#### Custom Test Configuration

Edit `test_concurrency.js` to adjust:
- `CONCURRENT_USERS`: Number of simultaneous users to simulate
- `SERVER_URL`: Target server URL
- `TEST_TIMEOUT`: Request timeout duration

### Monitoring in Production

#### Key Metrics to Watch
- Active generations count
- Queue length trends
- Average response times
- Error rates
- Memory usage patterns

#### Alerting Thresholds
- Queue length > 10 users
- Average response time > 10 seconds
- Error rate > 5%
- Memory usage > 80%

#### Real-Time Monitoring

Use the monitoring endpoints for real-time system status:

```bash
# Check timeline generation status
curl http://localhost:8080/api/timeline-status

# Check overall server health
curl http://localhost:8080/api/health

# Test Python installation
curl http://localhost:8080/api/test-python
```

### Performance Recommendations

#### Server Specifications
- **CPU**: Multi-core recommended for Python processes
- **Memory**: 2GB+ RAM for multiple concurrent generations
- **Storage**: SSD recommended for file I/O performance

#### Scaling Options
1. **Increase Concurrency**: Raise `MAX_CONCURRENT_GENERATIONS` in `server.js`
2. **Pre-generation**: Generate timeline pool in advance
3. **Caching**: Cache recently generated timelines
4. **Load Balancing**: Distribute across multiple servers

#### Configuration Tuning

In `server.js`:
```javascript
const MAX_CONCURRENT_GENERATIONS = 3; // Adjust based on server capacity
const TIMEOUT = 30000; // 30 second timeout
```

In `timeline_models/models.py`:
```python
# Timeline parameters
rounds=2
num_play_arm_pulls=6  
num_watch_arm_pulls=6
```

### File Management

#### Backup Files
- Unique files: `configs/timeline_{requestId}.json`
- Main file: `configs/timeline.json` (for backward compatibility)
- Automatic cleanup after 1 hour

#### Cleanup Process
- Runs on server startup
- Runs every hour automatically
- Only removes files older than 1 hour
- Preserves main `timeline.json` file

## Development Notes

### Adding New Game Types
1. Add the new game type to the `gameLog.js` schema
2. For meta stages: Create a `setup[GameType]` function using `stage_type` property
3. For game stages: Create a `setup[GameType]` function using `game` property
4. Add the case to the switch statement in `loadStage()`
5. Update the `maybeAddSummaryIcon()` function if needed

**Note**: Meta stages (prolific_id_form, introduction, instructions) use `stage_type`, while gameplay stages (practice, play, watch, choice, online-choice) use `game` property.

### Timeline Generation
Use the Python scripts in `timeline_models/` to generate timeline.json files programmatically rather than editing by hand.

### Debugging
- Check browser console for game logs
- Use `GET /api/logs/:prolific_id` to view logged data
- Monitor MongoDB collections for data verification

## Troubleshooting

### Common Issues

#### MongoDB Connection Error
**Symptoms**: Cannot connect to database, logs show connection errors

**Solutions**:
- Ensure MongoDB is running (`brew services start mongodb-community` on macOS)
- Check credentials in `mongo_auth.json` for production
- Verify connection string is correct
- Check firewall settings if using remote MongoDB

#### Missing Images
**Symptoms**: Broken images in game, console errors about missing assets

**Solutions**:
- Check that all referenced images exist in assets folders
- Verify demonstrator style/color images exist: `assets/demonstrators/styles/style1/red.png`, etc.
- Ensure zone backgrounds and asteroids are properly named
- Check file permissions

#### Timeline Validation
**Symptoms**: Game fails to load, timeline parsing errors

**Solutions**:
- Validate JSON syntax using a JSON validator
- Check all required properties are present
- Verify stage types match expected values
- Ensure demonstrator and zone objects are properly formatted

#### Port Conflicts
**Symptoms**: "Port already in use" error on startup

**Solutions**:
- Use `PORT=XXXX` to specify different port
- Check for other processes using port 8080: `lsof -i :8080`
- Kill conflicting process or choose different port

#### Python Installation Issues
**Symptoms**: "No working Python installation found", timeline generation fails

**Solutions**:
- Install Python 3.x and ensure it's in PATH
- Test with: `python3 --version` or `python --version`
- Verify Python can run: `curl http://localhost:8080/api/test-python`
- Check Python dependencies are installed

#### Timeline Generation Timeout
**Symptoms**: Timeline generation takes too long, timeout errors

**Solutions**:
- Check Python dependencies
- Verify `timeline_models/bandits_data.json` exists and is accessible
- Check system resources (CPU, memory)
- Consider increasing timeout in `server.js`

#### Failed to Parse Generated Timeline
**Symptoms**: JSON parsing errors after Python execution

**Solutions**:
- Check Python script syntax errors
- Manually run: `cd timeline_models && python3 models.py`
- Verify JSON output format
- Check for print statements in Python code (should output to stderr, not stdout)

#### High Queue Length
**Symptoms**: Many users waiting for timelines, slow response times

**Solutions**:
- Check Python installation and performance
- Consider increasing `MAX_CONCURRENT_GENERATIONS` in `server.js`
- Monitor system resources (CPU, memory)
- Check for hanging Python processes: `ps aux | grep python`
- Consider pre-generation strategy

#### Slow Response Times
**Symptoms**: Timeline generation takes longer than expected

**Solutions**:
- Verify Python script performance
- Check disk I/O for backup file writes
- Monitor network latency
- Profile Python script execution
- Consider pre-generation strategy

#### File Permission Errors
**Symptoms**: Cannot write timeline files, permission denied errors

**Solutions**:
- Ensure `configs/` directory is writable
- Check Node.js process permissions
- Verify disk space availability
- Check file ownership

#### Missing Logs in MongoDB
**Symptoms**: User actions not appearing in database

**Solutions**:
- Ensure `window.currentStage` is set correctly
- Verify `prolificID` is collected at game start
- Check page refresh handlers are properly set up
- Verify MongoDB connection is active
- Check browser console for logging errors

### Performance Tips

- Keep trajectory arrays reasonable in length (< 50 steps recommended)
- Optimize image file sizes (use compressed PNGs)
- Use appropriate bandit grid sizes (recommend 1x12 or 2x6)
- Monitor memory usage during concurrent timeline generation
- Consider caching strategies for high-traffic scenarios
- Use SSD storage for better file I/O performance

### Debug Steps

1. **Check server logs** for detailed error messages
2. **Test Python setup**: `GET /api/test-python`
3. **Check timeline status**: `GET /api/timeline-status`
4. **Verify MongoDB connection**: Check `/api/health`
5. **Test manual generation**: `cd timeline_models && python3 models.py`
6. **Check browser console** for client-side errors
7. **Verify config.json** syntax and values