const mongoose = require('mongoose');

// One row per `beforeunload` fired during the study (reload, tab close, navigating
// away) — excluding the end-of-study "Return to Prolific" redirect. Game-log rows carry
// `refresh_count` as it stood when they were logged and are never modified afterwards;
// this collection records the unload events themselves, with their timing and context.
const pageUnloadSchema = new mongoose.Schema({
    prolific_id: { type: String, default: "" },           // from the PROLIFIC_PID URL parameter (rows exist only in Prolific mode)
    prolific_study_id: { type: String, default: null },
    prolific_session_id: { type: String, default: null },
    uid: { type: String, required: true },                // regenerated on every page load
    session_id: { type: String, default: null },          // per-expedition id, as in GameLog
    session_index: { type: Number, default: null },
    stage_index: { type: Number, default: null },
    game: { type: String, default: null },
    refresh_count: { type: Number, required: true },      // count including this event
    experiment_id: { type: String, default: null },
    timestamp: { type: Date, default: Date.now }
});

pageUnloadSchema.index({ prolific_id: 1, uid: 1, timestamp: 1 });

module.exports = mongoose.model('PageUnload', pageUnloadSchema);
