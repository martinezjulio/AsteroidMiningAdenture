const mongoose = require('mongoose');

const feedbackLogSchema = new mongoose.Schema({
    // User identification
    prolific_id: { type: String, required: true },
    uid: { type: String, required: true },
    session_id: { type: String, required: true },
    
    // Session context
    session_index: { type: Number, required: true },
    
    // Feedback content
    feedback_text: { type: String, required: true },
    
    // Choice context - which demonstrator was chosen
    chosen_demonstrator_id: { type: String, required: true }, // Image filename of chosen demonstrator
    chosen_demonstrator_type: { type: String, required: true }, // Type of chosen demonstrator (expert/novice)
    chosen_demonstrator_global_index: { type: Number, required: true }, // Global index of chosen demonstrator
    chosen_demonstrator_session_index: { type: Number, required: true }, // Session index (0 or 1)
    
    // Available demonstrators in the choice
    demonstrator1_id: { type: String, required: true },
    demonstrator1_type: { type: String, required: true },
    demonstrator1_global_index: { type: Number, required: true },
    demonstrator2_id: { type: String, required: true },
    demonstrator2_type: { type: String, required: true },
    demonstrator2_global_index: { type: Number, required: true },
    
    // Zone context
    zone_global_index: { type: Number, required: true },
    zone_bandit_id: { type: String, default: null },
    
    // Metadata
    experiment_id: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    created_at: { type: Date, default: Date.now }
});

// Index for efficient queries
feedbackLogSchema.index({ prolific_id: 1, session_index: 1 });
feedbackLogSchema.index({ timestamp: 1 });

module.exports = mongoose.model('FeedbackLog', feedbackLogSchema);
