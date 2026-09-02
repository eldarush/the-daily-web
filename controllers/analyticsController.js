const mongoose = require('mongoose');
const Article = require('../models/Article');
const ViewAnalytics = require('../models/ViewAnalytics');

/**
 * Truncates a date to the start of its UTC hour (HH:00:00.000).
 * @param {Date} date - Any moment in time.
 * @returns {Date} The start-of-hour bucket key.
 */
function toHourBucket(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), 0, 0, 0)
  );
}

/**
 * Records a single view of an article. Called by the public article page when a
 * reader opens an article. Atomically increments the current hour's bucket and
 * the article's denormalized total. Never throws into the caller's render path —
 * a failed view count must not break serving the article.
 * @param {string} articleId - The viewed article's id.
 * @returns {Promise<void>}
 */
async function recordView(articleId) {
  if (!mongoose.isValidObjectId(articleId)) {
    return;
  }

  const hourBucket = toHourBucket(new Date());

  try {
    await Promise.all([
      ViewAnalytics.findOneAndUpdate(
        { article: articleId, timestampBucket: hourBucket },
        { $inc: { views: 1 } },
        { upsert: true, new: true }
      ),
      Article.findByIdAndUpdate(articleId, { $inc: { viewsCount: 1 } })
    ]);
  } catch (err) {
    console.error(`recordView failed for article ${articleId}:`, err.message);
  }
}

/**
 * Returns the hourly view timeline for an article plus the editor-update
 * milestones, for the Impact Analytics graph.
 * @param {import('express').Request} req - Expects params.articleId.
 * @param {import('express').Response} res - JSON { timeline, milestones }.
 * @returns {Promise<void>}
 */
async function getArticleAnalytics(req, res, next) {
  const { articleId } = req.params;

  if (!mongoose.isValidObjectId(articleId)) {
    return res.status(400).json({ error: 'Invalid article id' });
  }

  try {
    const article = await Article.findById(articleId).select('publishedUpdates publishedAt title').lean();
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const records = await ViewAnalytics.find({ article: articleId }).sort({ timestampBucket: 1 }).lean();

    return res.json({
      title: article.title,
      publishedAt: article.publishedAt,
      timeline: records.map((r) => ({ time: r.timestampBucket, views: r.views })),
      milestones: (article.publishedUpdates || []).map((m) => ({
        time: m.publishedAt,
        changelogNote: m.changelogNote || 'Editorial update'
      }))
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { recordView, getArticleAnalytics, toHourBucket };
