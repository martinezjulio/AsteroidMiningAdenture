require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const GameLog = require('./models/gameLog'); // Import the model
const app = express();

const PORT = process.env.PORT || 8080;
const isProduction = process.env.NODE_ENV === 'production';
const host = isProduction ? '0.0.0.0' : 'localhost';

const mongoDBUri = process.env.MONGODB_URI;
if (!mongoDBUri) {
    console.error('MONGODB_URI env var is required (e.g. mongodb://localhost:27017/AMGDB for local dev)');
    process.exit(1);
}

// Middleware
app.use(express.json());
// Only the client bundle and its assets are public. Serving the repo root would expose
// config.json / configs/*.yaml (the payoff table), server.js and generated timelines.
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '1h' }));
app.use('/vendor', express.static(path.join(__dirname, 'vendor'), { maxAge: '7d', immutable: true }));
app.get('/main.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.js'));
});

// Read config
const config = require('./config.json');
const experiment_config_path = config.experiment_config;
// Extract filename from path as experiment_id
const experiment_id = experiment_config_path.split('/').pop(); // Gets "timeline_june_09_2025.json"
console.log('Experiment config path:', experiment_config_path);
console.log('Experiment ID:', experiment_id);

// MongoDB
mongoose.connect(mongoDBUri)
    .then(() => console.log('Connected to MongoDB...'))
    .catch(err => console.error('Could not connect to MongoDB...', err));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Build asset manifest once at startup so the client gets directory listings
// in a single request instead of probing each filename sequentially.
const ASSET_DIRS = {
    landscapes: 'assets/landscapes',
    zone_backgrounds: 'assets/zone_backgrounds',
    asteroids: 'assets/asteroids'
};
const assetManifest = {};
for (const [key, dir] of Object.entries(ASSET_DIRS)) {
    try {
        assetManifest[key] = fs.readdirSync(path.join(__dirname, dir))
            .filter(f => f.endsWith('.png'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (err) {
        console.warn(`Could not read ${dir}:`, err.message);
        assetManifest[key] = [];
    }
}
console.log(
    `Asset manifest: ${assetManifest.landscapes.length} landscapes, ` +
    `${assetManifest.zone_backgrounds.length} zone backgrounds, ` +
    `${assetManifest.asteroids.length} asteroids`
);

app.get('/api/asset-manifest', (req, res) => {
    res.json(assetManifest);
});

// Endpoint to get experiment config
app.get('/api/config', (req, res) => {
    // Compose a demonstrator_config blob from the flat YAML fields. The browser
    // (main.js) consumes priors + payoffs via this object during watch stages.
    const demonstrator_config = {
        demo_1_prior_experience: config.demo_1_prior_experience,
        demo_2_prior_experience: config.demo_2_prior_experience,
        bandit_payoffs: config.bandit_payoffs,
        demonstrator_sampling_strategy: config.demonstrator_sampling_strategy
    };
    res.json({
        experiment_id,
        experiment_config_path,
        display_running_total_reward: config.display_running_total_reward || false,
        total_reward_scope: config.total_reward_scope || 'per_session',
        report_play_rewards_between_rounds: config.report_play_rewards_between_rounds || false,
        bandit_assignment_mode: config.bandit_assignment_mode || 'session_fixed',
        prolific_completion_url: config.prolific_completion_url || null,
        reward_breakdown_display: config.reward_breakdown_display || 'none',
        demonstrator_config,
        verbose: config.verbose || false
    });
});

// Concurrency management for timeline generation
const MAX_CONCURRENT_GENERATIONS = 4; // Limit concurrent Python processes
const GENERATION_QUEUE = [];
let activeGenerations = 0;

// Cleanup old timeline backup files on startup
function cleanupOldBackupFiles() {
    const timelinesDir = path.join(__dirname, 'timelines');
    const oneHourAgo = Date.now() - (60 * 60 * 1000); // 1 hour ago

    try {
        if (!fs.existsSync(timelinesDir)) {
            fs.mkdirSync(timelinesDir, { recursive: true });
            console.log('📁 Created timelines directory');
            return;
        }

        const files = fs.readdirSync(timelinesDir);
        let cleanedCount = 0;
        
        files.forEach(file => {
            if (file.startsWith('timeline_') && file.endsWith('.json') && file !== 'timeline.json') {
                const filePath = path.join(timelinesDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime.getTime() < oneHourAgo) {
                    fs.unlinkSync(filePath);
                    cleanedCount++;
                }
            }
        });
        
        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} old timeline backup files`);
        }
    } catch (error) {
        console.warn('⚠️ Warning: Could not cleanup old backup files:', error.message);
    }
}

// Run cleanup on startup
cleanupOldBackupFiles();

// Run cleanup every hour
setInterval(cleanupOldBackupFiles, 60 * 60 * 1000);

// Endpoint to generate a fresh timeline for each user
app.get('/api/timeline', (req, res) => {
    console.log('🎲 Generating fresh timeline for new user...');
    
    // Add to queue if we're at capacity
    if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
        console.log(`📋 Queue timeline generation (${GENERATION_QUEUE.length + 1} in queue)`);
        GENERATION_QUEUE.push({ req, res });
        return;
    }
    
    processTimelineGeneration(req, res);
});

function processTimelineGeneration(req, res) {
    activeGenerations++;
    console.log(`🔄 Processing timeline generation (${activeGenerations}/${MAX_CONCURRENT_GENERATIONS} active)`);
    
    // Generate unique identifier for this request
    const requestId = `timeline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Set a reasonable timeout for timeline generation
    const timeout = setTimeout(() => {
        console.error('⏰ Timeline generation timed out for request:', requestId);
        finishGeneration();
        res.status(500).json({ 
            error: 'Timeline generation timed out',
            details: 'The Python script took too long to execute',
            requestId: requestId
        });
    }, 30000); // 30 second timeout
    
    // Auto-detect working Python command
    const pythonCommands = ['python3', 'python', 'py'];
    
    const findWorkingPython = (commands, index = 0) => {
        if (index >= commands.length) {
            clearTimeout(timeout);
            finishGeneration();
            return res.status(500).json({
                error: 'No working Python installation found',
                tested: commands,
                suggestion: 'Install Python and ensure it\'s in your PATH',
                requestId: requestId
            });
        }
        
        const cmd = commands[index];
        const testProcess = spawn(cmd, ['--version']);
        
        testProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`🐍 Using Python command: ${cmd} for request: ${requestId}`);
                generateWithPython(cmd);
            } else {
                findWorkingPython(commands, index + 1);
            }
        });
        
        testProcess.on('error', (error) => {
            findWorkingPython(commands, index + 1);
        });
    };
    
    const generateWithPython = (pythonCommand) => {
        // Run the Python script to generate a new timeline. Python reads
        // every config field directly from config.json now, so the only
        // argv we still need is the request_id (used for the backup filename).
        const args = ['models.py', requestId];
        
        const pythonProcess = spawn(pythonCommand, args, {
            cwd: path.join(__dirname, 'timeline_models'),
            stdio: ['pipe', 'pipe', 'pipe']
        });
    
        let timelineData = '';
        let errorData = '';
        
        pythonProcess.stdout.on('data', (data) => {
            timelineData += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
            errorData += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
            clearTimeout(timeout);
            finishGeneration();
            
            if (code !== 0) {
                console.error(`❌ Python script failed with code: ${code} for request: ${requestId}`);
                console.error('Error output:', errorData);
                return res.status(500).json({ 
                    error: 'Failed to generate timeline', 
                    details: errorData,
                    exitCode: code,
                    requestId: requestId
                });
            }
            
            try {
                // Parse the timeline JSON from the Python output
                const timeline = JSON.parse(timelineData);
                console.log(`✅ Successfully generated fresh timeline for ${requestId} with`, timeline.length, 'sessions');
                
                // Log some stats about the generated timeline
                let totalStages = 0;
                timeline.forEach(session => {
                    if (Array.isArray(session[0])) {
                        // Nested session
                        session.forEach(container => totalStages += container.length);
                    } else {
                        // Simple session
                        totalStages += session.length;
                    }
                });
                console.log(` Timeline stats for ${requestId}: ${timeline.length} sessions, ${totalStages} total stages`);
                
                res.json(timeline);
            } catch (parseError) {
                console.error(`❌ Failed to parse timeline JSON for ${requestId}:`, parseError);
                console.error('Raw output was:', timelineData.substring(0, 500), '...');
                res.status(500).json({ 
                    error: 'Failed to parse generated timeline',
                    details: parseError.message,
                    rawOutput: timelineData.substring(0, 200),
                    requestId: requestId
                });
            }
        });
        
        pythonProcess.on('error', (error) => {
            clearTimeout(timeout);
            finishGeneration();
            console.error(`❌ Failed to start Python process for ${requestId}:`, error);
            res.status(500).json({ 
                error: 'Failed to start timeline generation',
                details: error.message,
                suggestion: 'Make sure Python is installed and accessible in PATH',
                requestId: requestId
            });
        });
    };
    
    function finishGeneration() {
        activeGenerations--;
        console.log(`✅ Finished generation (${activeGenerations}/${MAX_CONCURRENT_GENERATIONS} active, ${GENERATION_QUEUE.length} queued)`);
        
        // Process next item in queue
        if (GENERATION_QUEUE.length > 0) {
            const next = GENERATION_QUEUE.shift();
            console.log(`🚀 Processing queued timeline generation (${GENERATION_QUEUE.length} remaining)`);
            setImmediate(() => processTimelineGeneration(next.req, next.res));
        }
    }
    
    // Start the process by finding working Python
    findWorkingPython(pythonCommands);
}

// Test endpoint to verify Python setup
app.get('/api/test-python', (req, res) => {
    console.log('🧪 Testing Python setup...');
    
    const pythonCommands = ['python3', 'python', 'py'];
    
    const testCommand = (commands, index = 0) => {
        if (index >= commands.length) {
            return res.status(500).json({
                error: 'No working Python installation found',
                tested: commands,
                suggestion: 'Install Python and ensure it\'s in your PATH'
            });
        }
        
        const cmd = commands[index];
        const testProcess = spawn(cmd, ['--version']);
        
        let output = '';
        let errorOutput = '';
        
        testProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        testProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        testProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ Found working Python: ${cmd} - ${output.trim()}`);
                res.json({
                    success: true,
                    command: cmd,
                    version: output.trim() || errorOutput.trim(),
                    message: 'Python is working correctly'
                });
            } else {
                console.log(`❌ Python command '${cmd}' failed, trying next...`);
                testCommand(commands, index + 1);
            }
        });
        
        testProcess.on('error', (error) => {
            console.log(`❌ Python command '${cmd}' not found, trying next...`);
            testCommand(commands, index + 1);
        });
    };
    
    testCommand(pythonCommands);
});

// Timeline generation status endpoint for monitoring
app.get('/api/timeline-status', (req, res) => {
    res.json({
        active_generations: activeGenerations,
        max_concurrent: MAX_CONCURRENT_GENERATIONS,
        queue_length: GENERATION_QUEUE.length,
        capacity_available: MAX_CONCURRENT_GENERATIONS - activeGenerations,
        server_time: new Date(),
        uptime_seconds: process.uptime()
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timeline_system: {
            active: activeGenerations,
            queued: GENERATION_QUEUE.length,
            capacity: MAX_CONCURRENT_GENERATIONS
        },
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date()
    });
});

// Endpoint to log game data. 503 while MongoDB is down so the client's log queue
// retries instead of treating it as a permanent failure; 400 for rows the schema
// rejects (retrying those can't help).
app.post('/api/log', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ success: false, error: 'database unavailable' });
    }
    try {
        const gameLog = new GameLog(req.body);
        await gameLog.save();
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error saving game log:', error);
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, error: error.message });
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

// Endpoint to get game logs (local debugging only — participant data must not be
// readable from the public deployment).
app.get('/api/logs/:prolific_id', async (req, res) => {
    if (isProduction) {
        return res.status(404).end();
    }
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