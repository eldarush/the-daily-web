const mongoose = require('mongoose');

const guestCommentLimitSchema = new mongoose.Schema({
    _id: String,
    attempts: { type: [Date], default: [] },
    expiresAt: { type: Date, required: true }
}, { versionKey: false });
// TTL reclaims old identity records in the background. The limiter independently
// filters attempt timestamps, so expiry cleanup is not the rate-limit clock.
guestCommentLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('GuestCommentLimit', guestCommentLimitSchema);
