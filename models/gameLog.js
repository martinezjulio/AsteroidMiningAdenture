const mongoose = require('mongoose');

const gameLogSchema = new mongoose.Schema({
    // User identification
    prolific_id: { type: String, required: true },
    uid: { type: String, required: true },
    
    // Game progression
    session_index: { type: Number, required: true },
    step: { type: Number, required: true },
    position: { type: Number, required: true },
    action: { type: String, enum: ['left', 'right', 'up', 'down', 'pull'], required: true },
    timestamp: { type: Date, default: Date.now },
    
    // Game state
    shots_remaining: { type: Number, required: true },
    game: { type: String, enum: ['watch', 'choice', 'play', 'blind', 'indicate', 'practice'], required: true },
    game_total_reward: { type: Number, default: 0 },
    user_total_reward: { type: Number, default: 0 },
    reward_generated: { type: Boolean, default: false },
    shot: { type: Boolean, default: false },
    
    // Session configuration
    transfer: { type: Boolean, default: false },
    game_sequence: [{ type: String }],
    
    // Stage/game identifiers
    game_index: { type: Number, required: true },
    stage_index: { type: Number, required: true },
    round_index: { type: Number, default: null },
    
    // Demonstrator info
    demonstrator_index: { type: Number, default: null },
    demonstrator_type: { type: String, default: null },
    demonstrator_id: { type: Number, default: null },
    demonstrator_trajectory: [{ type: Number }],
    
    // Zone info
    zone_index: { type: Number, required: true },
    zone_bandit: [[{ type: Number }]], // Array of arrays for bandit payoffs
    zone_bandit_id: { type: String, default: null },
    
    // Tracking
    refresh_count: { type: Number, default: 0 },
    
    // Additional metadata
    experiment_number: { type: Number, default: null },
    created_at: { type: Date, default: Date.now }
});

// Index for efficient queries
gameLogSchema.index({ prolific_id: 1, uid: 1, timestamp: 1 });
gameLogSchema.index({ session_index: 1, game_index: 1, step: 1 });

module.exports = mongoose.model('GameLog', gameLogSchema); 