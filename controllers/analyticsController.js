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

async function listPublishedArticles(req, res, next) {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  if (!Number.isSafeInteger(page) || page < 1) {
    return res.status(400).json({ error: 'Invalid page' });
  }
  try {
    const filter = { status: 'published' };
    const [articles, total] = await Promise.all([
      Article.find(filter).select('title').sort({ publishedAt: -1, _id: -1 })
        .skip((page - 1) * 20).limit(20).lean(),
      Article.countDocuments(filter)
    ]);
    return res.json({ articles, page, hasMore: page * 20 < total });
  } catch (err) { return next(err); }
}

async function setViewBucket(req, res, next) {
  const { articleId } = req.params;
  const { time, views } = req.body;
  if (!mongoose.isValidObjectId(articleId)) {
    return res.status(400).json({ error: 'Invalid article id' });
  }
  const date = typeof time === 'string' ? new Date(time) : new Date(NaN);
  if (!Number.isFinite(date.getTime()) || date.getTime() !== toHourBucket(date).getTime() ||
      !Number.isSafeInteger(views) || views < 0) {
    return res.status(400).json({ error: 'Provide a UTC hour and a nonnegative integer view count' });
  }
  try {
    if (!await Article.exists({ _id: articleId })) {
      return res.status(404).json({ error: 'Article not found' });
    }
    const previous = await ViewAnalytics.findOneAndUpdate(
      { article: articleId, timestampBucket: date }, { $set: { views } },
      { upsert: true, new: false, runValidators: true }
    );
    await Article.findByIdAndUpdate(articleId, { $inc: { viewsCount: views - (previous ? previous.views : 0) } });
    return res.json({ time: date, views });
  } catch (err) { return next(err); }
}

async function resetArticleAnalytics(req, res, next) {
  const { articleId } = req.params;
  if (!mongoose.isValidObjectId(articleId)) {
    return res.status(400).json({ error: 'Invalid article id' });
  }
  try {
    const article = await Article.findById(articleId);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const records = await ViewAnalytics.find({ article: articleId }).select('_id');
    let removedViews = 0;
    for (const record of records) {
      const removed = await ViewAnalytics.findByIdAndDelete(record._id);
      if (removed) removedViews += removed.views;
    }
    // Subtract only deleted counts; new views can keep arriving during reset.
    await Article.findByIdAndUpdate(articleId, { $inc: { viewsCount: -removedViews } });
    return res.json({ message: 'View statistics reset' });
  } catch (err) { return next(err); }
}

module.exports = { recordView, getArticleAnalytics, toHourBucket, listPublishedArticles, setViewBucket, resetArticleAnalytics };
