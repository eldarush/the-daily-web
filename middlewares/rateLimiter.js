const guestCommentAttempts = new Map();

const WINDOW_MS = 60*1000;
const MAX_COMMENTS = 3;

exports.guestCommentLimiter = (req, res, next) => {
    if (req.session?.user) {
        return next();
    }
    const ip = req.ip;
    const now = Date.now();

    const attempts = guestCommentAttempts.get(ip) || [];

    const recentAttempts = attempts.filter( time => now - time < WINDOW_MS);

    if (recentAttempts.length >= MAX_COMMENTS){
        const oldestAttempt = recentAttempts[0];

        const retryAfterSeconds = Math.ceil(
            (WINDOW_MS - (now - oldestAttempt)) / 1000
        );

        return res.status(429).json({
            error: 'Too many comments. Please try again later',
            retryAfterSeconds: retryAfterSeconds
        });
    }

    recentAttempts.push(now);
    guestCommentAttempts.set(ip, recentAttempts);

    next();
};