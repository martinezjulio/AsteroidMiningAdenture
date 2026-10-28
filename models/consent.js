const mongoose = require('mongoose');

// One row per decision on the consent page (the first screen): agree or decline.
// Prolific asks researchers to record consent with a timestamp alongside the Prolific
// ID. Rows exist only in Prolific mode (PROLIFIC_PID in the URL), so the ID is required.
// A declining participant is then redirected to the study's "No consent" completion
// path (prolific_no_consent_url) so the submission is returned rather than paid.
const consentSchema = new mongoose.Schema({
    prolific_id: { type: String, required: true },        // from the PROLIFIC_PID URL parameter
    prolific_study_id: { type: String, default: null },
    prolific_session_id: { type: String, default: null },
    uid: { type: String, required: true },                // regenerated on every page load
    consented: { type: Boolean, required: true },         // true = "I agree to participate"
    experiment_id: { type: String, default: null },
    timestamp: { type: Date, default: Date.now }
});

consentSchema.index({ prolific_id: 1, timestamp: 1 });

module.exports = mongoose.model('Consent', consentSchema);
