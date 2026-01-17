const mongoose = require('mongoose');

const gameLogSchema = new mongoose.Schema({
    // User identification
    prolific_id: { type: String, required: true },
    uid: { type: String, required: true },
    session_id: { type: String, required: true },
    
    // Game progression
    session_index: { type: Number, required: true },
    step: { type: Number, required: true },
    position: { type: Number, required: true },
    action: { type: String, enum: ['left', 'right', 'up', 'down', 'shoot', 'feedback', 'trajectory_complete'], required: true },
    timestamp: { type: Date, default: Date.now },
    
    // Game state
    shots_remaining: { type: Number, required: true },
    game: { type: String, enum: ['watch', 'choice', 'play', 'blind', 'indicate', 'practice', 'feedback'], required: true },
    game_total_reward: { type: Number, default: 0 },
    user_total_reward: { type: Number, default: 0 },
    reward_generated: { type: Boolean, default: false },
    shot: { type: Boolean, default: false },
    
    // Session configuration
    transfer: { type: Boolean, default: false },
    game_sequence: { type: String, default: "" },
    
    // Stage/game identifiers
    game_index: { type: Number, required: true },
    stage_index: { type: Number, required: true },
    round_index: { type: Number, default: null },
    
    // Demonstrator info (updated field names)
    demonstrator_session_index: { type: Number, default: null },
    demonstrator_type: { type: String, default: null },
    demonstrator_global_index: { type: Number, default: null },
    demonstrator_id: { type: String, default: null }, // Now stores the actual image filename
    demonstrator_trajectory: { type: String, default: "" },
    
    // Inline mode demonstrator data (only populated in inline mode)
    demonstrator_all_actions: { type: String, default: null }, // JSON string of all actions including warmup
    demonstrator_all_rewards: { type: String, default: null }, // JSON string of all rewards including warmup
    
    // Zone info (updated field names and new fields)
    zone_global_index: { type: Number, required: true },
    zone_color: { type: String, default: null }, // Generated zone color
    zone_background: { type: String, default: null }, // Mapped background image filename
    zone_bandit: { type: String, default: "" }, // Comma-separated bandit payoffs
    zone_bandit_id: { type: String, default: null },
    zone_bandit_arm_image_ids: { type: String, default: "" }, // Comma-separated asteroid image filenames
    
    // Choice-specific fields (null for non-choice games)
    choice_demonstrator_id: { type: String, default: null }, // Demonstrator image filename of chosen demonstrator
    choice_demonstrator_type: { type: String, default: null }, // Type of chosen demonstrator
    
    // Feedback-specific fields (null for non-feedback actions)
    feedback_text: { type: String, default: null }, // User's feedback response
    
    // Tracking
    refresh_count: { type: Number, default: 0 },
    
    // Additional metadata
    experiment_id: { type: String, required: true },
    created_at: { type: Date, default: Date.now }
});

// Index for efficient queries
gameLogSchema.index({ prolific_id: 1, uid: 1, timestamp: 1 });
gameLogSchema.index({ session_index: 1, game_index: 1, step: 1 });

module.exports = mongoose.model('GameLog', gameLogSchema); 