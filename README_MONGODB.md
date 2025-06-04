# MongoDB Logging Setup for Spatial Bandits Game

This game includes comprehensive MongoDB logging that tracks every user action and game event. Here's how to set it up:

## Prerequisites

1. **MongoDB**: Install MongoDB locally or have access to a MongoDB server
2. **Node.js**: Install Node.js (version 14 or higher)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. MongoDB Configuration

#### For Local Development:
- No additional configuration needed
- The game will connect to `mongodb://localhost:27017/AMGDB`

#### For Production:
1. Copy `mongo_auth.json.example` to `mongo_auth.json`
2. Edit `mongo_auth.json` with your MongoDB credentials:
   ```json
   {
       "user": "your_mongodb_username",
       "password": "your_mongodb_password"
   }
   ```
3. Set the environment variable: `export NODE_ENV=production`

### 3. Start the Server

#### Local Development:
```bash
npm run dev
```

#### Production:
```bash
npm start
```

The server will run on `http://localhost:8080` (local) or `http://0.0.0.0:8080` (production).

## Logged Data

The system logs the following variables for every user action:

- **User Information**: `prolific_id`, `uid` (auto-generated)
- **Game Progress**: `session_index`, `step`, `position`, `action`, `timestamp`
- **Game State**: `shots_remaining`, `game` type, `game_total_reward`, `user_total_reward`
- **Action Details**: `reward_generated`, `shot` (boolean for arm pulls)
- **Session Info**: `transfer`, `game_sequence`
- **Stage/Game IDs**: `game_index`, `stage_index`, `round_index`
- **Demonstrator Info**: `demonstrator_index`, `demonstrator_type`, `demonstrator_id`, `demonstrator_trajectory`
- **Zone Info**: `zone_index`, `zone_bandit`, `zone_bandit_id`
- **Tracking**: `refresh_count`

## Logged Actions

- **Movement**: `left`, `right`, `up`, `down` - when user moves position
- **Pulling**: `pull` - when user pulls an arm/shoots an asteroid

## Online-Choice Game Logging

**Important**: The `online-choice` game type is handled specially for logging purposes:
- **Choice phase** → logged as `game: "choice"`  
- **Watch phase** → logged as `game: "watch"`

This allows for consistent analysis of choice and watch behaviors regardless of whether they occur as standalone games or as part of an online-choice sequence.

## Database Structure

Data is stored in the `AMGDB` database in the `gamelogs` collection. Each document represents one user action.

**Game Types**: `watch`, `choice`, `play`, `blind`, `indicate`, `practice`
**Actions**: `left`, `right`, `up`, `down`, `pull`

## API Endpoints

- `POST /api/log` - Log a game action
- `POST /api/log-refresh` - Log page refresh
- `GET /api/logs/:prolific_id` - Retrieve logs for a specific user (for debugging)

## Usage in Game Code

The logging is automatically integrated into the game. Key functions:

- `logToMongoDB(action, additionalData)` - Log any action
- `resetGameTracking(gameType, numArmPulls)` - Initialize tracking for new game
- `initializeGameSequence()` - Track sequence of games in session

## Troubleshooting

1. **Connection Error**: Check MongoDB is running and connection string is correct
2. **Missing Logs**: Ensure `window.currentStage` is set and `prolificID` is collected
3. **Refresh Tracking**: Check that page refresh handlers are properly set up

## Security Note

Keep `mongo_auth.json` secure and never commit it to version control. Add it to your `.gitignore` file. 