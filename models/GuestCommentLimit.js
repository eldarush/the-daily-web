const mongoose = require('mongoose');

const guestCommentLimitSchema = new mongoose.Schema({
    _id: String,
    attempts: { type: [Date], default: [] },
    expiresAt: { type: Date, required: true }
}, { versionKey: false });
guestCommentLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('GuestCommentLimit', guestCommentLimitSchema);
