const { createHash, createHmac, timingSafeEqual } = require('crypto');
const GuestCommentLimit = require('../models/GuestCommentLimit');
const WINDOW_MS = 60 * 1000;
const MAX_COMMENTS = 3;

// Spam protection: a guest may post at most 3 comments per rolling minute.
// Signed-in users are skipped (they are identified by their account).
// This reserves attempts before Comment.create; a later persistence failure
// can consume a slot. It is a rolling window, not a clock-minute quota.
exports.guestCommentLimiter = async (req, res, next) => {
    if (req.session?.user) return next();
    try {
        // Make sure this browser has a saved session, so it has a stable session id.
        req.session.commentDevice = true;
        await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        // Keep separate browser identities for people behind a shared IP.
        // Stored as a SHA-256 hash, so the raw session id never sits in this collection.
        let id = createHash('sha256').update(req.sessionID).digest('hex');
        const signature = value => createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex');
        const device = req.headers?.cookie?.match(/(?:^|;\s*)daily_web_device=([a-f0-9]{64})\.([a-f0-9]{64})(?:;|$)/);
        if (device && timingSafeEqual(Buffer.from(device[2]), Buffer.from(signature(device[1])))) id = device[1];
        // A signed browser identity outlives login sessions; erased cookies still create a new identity.
        res.cookie('daily_web_device', id + '.' + signature(id), {
            httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 * 1000
        });
        const now = new Date();
        const cutoff = new Date(now.getTime() - WINDOW_MS);
        const expiresAt = new Date(now.getTime() + WINDOW_MS);
        // Step 1: create this guest's record if it does not exist yet (expiresAt feeds a TTL index).
        try {
            await GuestCommentLimit.updateOne({ _id: id }, {
                $setOnInsert: { attempts: [], expiresAt }
            }, { upsert: true });
        } catch (error) {
            // Two first attempts can race the initial upsert. A duplicate means
            // the identity record now exists; the atomic budget check still runs.
            if (error.code !== 11000) throw error;
        }
        // Keep recent attempts, check the budget and append in one update so parallel
        // requests cannot exceed the limit.
        // TTL cleanup is asynchronous. Filter by cutoff on every request rather
        // than depending on MongoDB deleting the record exactly at expiration.
        const recent = { $filter: { input: '$attempts', as: 'time', cond: { $gt: ['$$time', cutoff] } } };
        // The predicate and append run as one database update for every process.
        const accepted = await GuestCommentLimit.findOneAndUpdate({
            _id: id, $expr: { $lt: [{ $size: recent }, MAX_COMMENTS] }
        }, [{ $set: { attempts: { $concatArrays: [recent, [now]] }, expiresAt } }], { new: true });
        if (accepted) return next();
        // Step 3: over the limit. Answer 429 and tell the client how long to wait.
        const existing = await GuestCommentLimit.findById(id).lean();
        const oldest = existing?.attempts.find(time => time > cutoff);
        const retryAfterSeconds = Math.max(1, Math.ceil(((oldest ? oldest.getTime() : now.getTime()) + WINDOW_MS - now.getTime()) / 1000));
        res.set('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ error: 'Too many comments. Please try again later', retryAfterSeconds });
    } catch (error) {
        next(error);
    }
};
