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

#### Development Mode (Local)
```bash
# Start with auto-restart on file changes
npm run dev

# Or start normally
npm start
```
- Game accessible at: `http://localhost:8080`
- Connects to local MongoDB: `mongodb://localhost:27017/AMGDB`
- No authentication required

#### Production Mode
```bash
# 1. Set up MongoDB credentials
cp mongo_auth.json.example mongo_auth.json
# Edit mongo_auth.json with your MongoDB username/password

# 2. Set environment variable
export NODE_ENV=production

# 3. Start the server
npm start
```

#### Custom Port
```bash
# Set custom port (default is 8080)
PORT=3000 npm start

# Or for production
PORT=3000 NODE_ENV=production npm start
```

### MongoDB Setup

#### Local Development
```bash
# macOS (Homebrew)
brew services start mongodb-community

# Ubuntu/Linux
sudo systemctl start mongod

# Windows
net start MongoDB
```

#### Production
1. Create `mongo_auth.json`:
   ```json
   {
       "user": "your_mongodb_username",
       "password": "your_mongodb_password"
   }
   ```
2. Ensure MongoDB is running with authentication enabled

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

### 1. **Introduction**
```json
{
  "stage_type": "introduction",
  "message": "Welcome text that appears on screen"
}
```

### 2. **Instructions**
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

### 3. **Practice**
```json
{
  "stage_type": "practice",
  "num_arm_pulls": 5,
  "zone": {...zone_object...}
}
```

### 4. **Play**
```json
{
  "stage_type": "play", 
  "num_arm_pulls": 10,
  "zone": {...zone_object...}
}
```

### 5. **Watch** 
```json
{
  "stage_type": "watch",
  "zone": {...zone_object...},
  "demonstrator": {...demonstrator_object...}
}
```

### 6. **Indicate**
```json
{
  "stage_type": "indicate",
  "zone": {...zone_object...}, 
  "demonstrator": {...demonstrator_object...}
}
```

### 7. **Blind**
```json
{
  "stage_type": "blind",
  "num_arm_pulls": 8,
  "zone": {...zone_object...}
}
```

### 8. **Choice**
```json
{
  "stage_type": "choice",
  "transfer": false,
  "zone": {...zone_object...},
  "demonstrator1": {...demonstrator_object...},
  "demonstrator2": {...demonstrator_object...}
}
```

### 9. **Online-Choice**
```json
{
  "stage_type": "online-choice",
  "transfer": false,
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

#### Common Properties
- `stage_type`: Game type (see Game Types above)
- `game_index`: Sequential game number within session
- `stage_index`: Stage number within session container
- `session_index`: Session number (0-based)
- `round_index`: Round number (optional)

#### Transfer Learning
- `transfer`: Boolean indicating if this is a transfer condition

#### Overlay Messages
- `overlay-message`: Text shown in transition overlay
- `choice-overlay-message`: Text for choice phase (online-choice)
- `watch-overlay-message`: Text for watch phase (online-choice)

## MongoDB Logging

The game automatically logs all user actions to MongoDB:

### Logged Data
- User actions: `left`, `right`, `up`, `down`, `pull`
- Game state: rewards, position, remaining shots
- Session information: game sequence, stage indices
- Demonstrator data: type, trajectory, selections
- Zone information: bandit structure, zone properties

### Special Logging for Online-Choice
- **Choice phase** → logged as `game: "choice"`
- **Watch phase** → logged as `game: "watch"`

## Asset Structure

### Required Directories
```
assets/
├── demonstrators/     # demonstrator_XX.png files
├── landscapes/        # landscape_XX.png files  
├── zone_backgrounds/  # zone_XX.png files
├── asteroids/         # asteroid_XX.png files
├── introduction/      # GIF and PNG instruction files
└── user.png          # Player sprite
```

### Image Mapping System
The game uses a randomization system that maps logical indices to shuffled image files, ensuring each playthrough uses different visual assets while maintaining game logic.

## Development Notes

### Adding New Game Types
1. Add the new game type to the `gameLog.js` schema
2. Create a `setup[GameType]` function in `main.js`
3. Add the case to the switch statement in `loadStage()`
4. Update the `maybeAddSummaryIcon()` function if needed

### Timeline Generation
Use the Python scripts in `timeline_models/` to generate timeline.json files programmatically rather than editing by hand.

### Debugging
- Check browser console for game logs
- Use `GET /api/logs/:prolific_id` to view logged data
- Monitor MongoDB collections for data verification

## Troubleshooting

### Common Issues
1. **MongoDB Connection Error**: Ensure MongoDB is running and credentials are correct
2. **Missing Images**: Check that all referenced images exist in assets folders
3. **Timeline Validation**: Validate JSON syntax and required properties
4. **Port Conflicts**: Use `PORT=XXXX` to specify different port

### Performance Tips
- Keep trajectory arrays reasonable in length
- Optimize image file sizes
- Use appropriate bandit grid sizes (recommend 1x12 or 2x6)
