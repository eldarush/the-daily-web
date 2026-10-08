const { createHash } = require('crypto');
const GuestCommentLimit = require('../models/GuestCommentLimit');
const WINDOW_MS = 60 * 1000;
const MAX_COMMENTS = 3;

exports.guestCommentLimiter = async (req, res, next) => {
    if (req.session?.user) return next();
    try {
        req.session.commentDevice = true;
        await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        const id = createHash('sha256').update(req.sessionID).digest('hex');
        const now = new Date();
        const cutoff = new Date(now.getTime() - WINDOW_MS);
        const expiresAt = new Date(now.getTime() + WINDOW_MS);
        try {
            await GuestCommentLimit.updateOne({ _id: id }, {
                $setOnInsert: { attempts: [], expiresAt }
            }, { upsert: true });
        } catch (error) {
            if (error.code !== 11000) throw error;
        }
        const recent = { $filter: { input: '$attempts', as: 'time', cond: { $gt: ['$$time', cutoff] } } };
        // The predicate and append run as one database update for every process.
        const accepted = await GuestCommentLimit.findOneAndUpdate({
            _id: id, $expr: { $lt: [{ $size: recent }, MAX_COMMENTS] }
        }, [{ $set: { attempts: { $concatArrays: [recent, [now]] }, expiresAt } }], { new: true });
        if (accepted) return next();
        const existing = await GuestCommentLimit.findById(id).lean();
        const oldest = existing?.attempts.find(time => time > cutoff);
        const retryAfterSeconds = Math.max(1, Math.ceil(((oldest ? oldest.getTime() : now.getTime()) + WINDOW_MS - now.getTime()) / 1000));
        res.set('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ error: 'Too many comments. Please try again later', retryAfterSeconds });
    } catch (error) {
        next(error);
    }
};
