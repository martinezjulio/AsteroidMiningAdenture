const mongoose = require('mongoose');

const gameLogSchema = new mongoose.Schema({
    // User identification
    prolific_id: { type: String, required: true },
    prolific_study_id: { type: String, default: null },   // STUDY_ID from the Prolific URL
    prolific_session_id: { type: String, default: null }, // SESSION_ID from the Prolific URL
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
    game: { type: String, enum: ['watch', 'choice', 'play', 'indicate', 'practice-play', 'practice-watch', 'practice', 'feedback'], required: true }, // 'practice' is the pre-2026-10-19 value for practice play
    game_total_reward: { type: Number, default: 0 },
    user_total_reward: { type: Number, default: 0 },
    reward_generated: { type: Boolean, default: false },
    shot: { type: Boolean, default: false },
    
    // Session configuration
    transfer: { type: Boolean, default: false },
    game_sequence: { type: String, default: "" },
    session_condition: { type: String, default: null }, // this session's round token list, e.g. "watch-demo-1-play-watch-demo-2-play"
    condition_order: { type: String, default: null },   // all sessions' labels in played order, "|"-separated (same on every row)
    
    // Stage/game identifiers
    game_index: { type: Number, required: true },
    stage_index: { type: Number, required: true },
    round_index: { type: Number, default: null },
    
    // Demonstrator info
    demonstrator_session_index: { type: Number, default: null },
    demonstrator_index: { type: Number, default: null }, // 0 = demo-1, 1 = demo-2 (replaces demonstrator_type)
    demonstrator_type: { type: String, default: null }, // legacy field — preserved for old logs; new logs leave null
    demonstrator_global_index: { type: Number, default: null },
    demonstrator_id: { type: String, default: null }, // Stores the actual image filename

    // Demonstrator trajectory data (always inline now)
    demonstrator_actions: { type: String, default: null }, // JSON array of arm indices
    demonstrator_rewards: { type: String, default: null }, // JSON array of rewards (0 or 1)

    // Demonstrator configuration metadata
    demonstrator_source: { type: String, default: null }, // legacy: "inline"|"file" — kept for old logs
    demonstrator_experience: { type: Number, default: null }, // Warmup iterations
    demonstrator_strategy: { type: String, default: null }, // "thompson"
    demonstrator_bandit_payoffs: { type: String, default: null }, // JSON array of payoffs used for generation
    demonstrator_filter: { type: String, default: null }, // pair filter active for this zone ("none" | "expert_gt_novice" | "expert_policy_gt_novice")
    demonstrator_filter_attempts: { type: Number, default: null }, // pairs drawn before one passed (1 = first draw)
    demonstrator_filter_satisfied: { type: Boolean, default: null }, // false if the attempt cap was hit
    
    // User play trajectory data (populated for play games only)
    play_actions: { type: String, default: null }, // JSON array of arm indices selected by user
    play_rewards: { type: String, default: null }, // JSON array of rewards received by user (0 or 1)
    
    // Zone info (updated field names and new fields)
    zone_global_index: { type: Number, required: true },
    zone_color: { type: String, default: null }, // Generated zone color
    zone_background: { type: String, default: null }, // Mapped background image filename
    zone_bandit: { type: String, default: null }, // JSON string of flattened bandit payoffs
    zone_bandit_id: { type: String, default: null },
    zone_bandit_arm_image_ids: { type: String, default: null }, // JSON string array of asteroid image filenames
    
    // Choice-specific fields (null for non-choice games)
    choice_demonstrator_id: { type: String, default: null }, // Demonstrator image filename of chosen demonstrator
    choice_demonstrator_index: { type: Number, default: null }, // 0 or 1 — which slot was chosen
    choice_demonstrator_type: { type: String, default: null }, // legacy field — preserved for old logs
    choice_display_order: { type: String, default: null }, // JSON [slot in left cell, slot in right cell]; slot 0 = demo-1
    
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