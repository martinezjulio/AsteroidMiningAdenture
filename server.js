const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const GameLog = require('./models/gameLog'); // Import the model
const app = express();
const PORT = process.env.PORT || 8080;
const isProduction = process.env.NODE_ENV === 'production';
const host = isProduction ? '0.0.0.0' : 'localhost';
let mongoDBUri;

// Middleware
app.use(express.json());
app.use(express.static('.')); // Serve all files from current directory

// Read config
const config = require('./config.json');
const experiment_config_path = config.experiment_config;
// Extract filename from path as experiment_id
const experiment_id = experiment_config_path.split('/').pop(); // Gets "timeline_june_09_2025.json"
console.log('Experiment config path:', experiment_config_path);
console.log('Experiment ID:', experiment_id);

if (isProduction) {
    // On server, read MongoDB credentials from mongo_auth.json
    let raw_data = fs.readFileSync('mongo_auth.json');
    let auth = JSON.parse(raw_data);
    mongoDBUri = `mongodb://${auth.user}:${auth.password}@127.0.0.1:27017/AMGDB?authSource=admin`;
} else {
    // Locally, connect to MongoDB without credentials
    mongoDBUri = 'mongodb://localhost:27017/AMGDB';
}

// MongoDB
mongoose.connect(mongoDBUri)
    .then(() => console.log('Connected to MongoDB...'))
    .catch(err => console.error('Could not connect to MongoDB...', err));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to get experiment config
app.get('/api/config', (req, res) => {
    res.json({ 
        experiment_id,
        experiment_config_path 
    });
});

// Endpoint to log game data
app.post('/api/log', async (req, res) => {
    try {
        const gameLog = new GameLog(req.body);
        await gameLog.save();
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error saving game log:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to log page refresh
app.post('/api/log-refresh', async (req, res) => {
    try {
        const { prolific_id, uid, session_id } = req.body;
        
        // Find the most recent log entry for this user and increment refresh count
        const lastLog = await GameLog.findOne({ 
            prolific_id: prolific_id,
            uid: uid,
            session_id: session_id 
        }).sort({ timestamp: -1 });
        
        if (lastLog) {
            // Update all logs for this user session with incremented refresh count
            await GameLog.updateMany(
                { prolific_id: prolific_id, uid: uid, session_id: session_id },
                { $inc: { refresh_count: 1 } }
            );
        }
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error logging refresh:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to get game logs (for debugging)
app.get('/api/logs/:prolific_id', async (req, res) => {
    try {
        const logs = await GameLog.find({ prolific_id: req.params.prolific_id }).sort({ timestamp: 1 });
        res.json(logs);
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, host, () => {
    console.log(`Server running on http://${host}:${PORT}`);
}); 