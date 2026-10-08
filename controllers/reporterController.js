const mongoose = require('mongoose');
const Article = require('../models/Article');

const PAGE_SIZE = 20;

// Fields a reporter is allowed to author/edit on an article body.
const EDITABLE_FIELDS = ['title', 'summary', 'content', 'category', 'imageUrl'];

/**
 * Picks only the whitelisted editable fields from a request body.
 * @param {Record<string, any>} body - Raw request body.
 * @returns {Record<string, any>} Sanitized subset.
 */
function pickEditableFields(body) {
  const out = {};
  for (const key of EDITABLE_FIELDS) {
    if (body[key] !== undefined) {
      out[key] = body[key];
    }
  }
  return out;
}

/**
 * Loads an article and asserts the session user owns it.
 * @param {string} articleId - Article id.
 * @param {string} userId - Session user id.
 * @returns {Promise<{ article: any, error: { status: number, message: string } | null }>}
 */
async function loadOwnedArticle(articleId, userId) {
  if (!mongoose.isObjectIdOrHexString(articleId)) {
    return { article: null, error: { status: 400, message: 'Invalid article id' } };
  }
  const article = await Article.findById(articleId);
  if (!article) {
    return { article: null, error: { status: 404, message: 'Article not found' } };
  }
  if (article.author.toString() !== userId) {
    return { article: null, error: { status: 403, message: 'You can only edit your own articles' } };
  }
  return { article, error: null };
}

/**
 * Lists the session reporter's own articles, newest first, paginated.
 * @param {import('express').Request} req - Query: page (1-based).
 * @param {import('express').Response} res - JSON { articles, page, total, pageSize }.
 * @returns {Promise<void>}
 */
async function getReporterArticles(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filter = { author: req.session.user.id };

    const [articles, total] = await Promise.all([
      Article.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      Article.countDocuments(filter)
    ]);

    return res.json({ articles, page, total, pageSize: PAGE_SIZE });
  } catch (err) {
    return next(err);
  }
}

/**
 * Creates a new draft article owned by the session reporter. Provides the id
 * that the autosave engine then writes into.
 * @param {import('express').Request} req - Optional partial body.
 * @param {import('express').Response} res - JSON { id } with 201.
 * @returns {Promise<void>}
 */
async function createArticle(req, res, next) {
  try {
    if (!req.body || EDITABLE_FIELDS.some(key => req.body[key] !== undefined && typeof req.body[key] !== 'string')) {
      return res.status(400).json({ error: 'Article fields must be strings' });
    }
    const fields = pickEditableFields(req.body);
    if (fields.category !== undefined && !Article.ARTICLE_CATEGORIES.includes(fields.category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const article = await Article.create({
      title: fields.title || 'Untitled draft',
      summary: fields.summary || 'Draft summary',
      content: fields.content || 'Start writing your article…',
      category: fields.category || Article.ARTICLE_CATEGORIES[0],
      imageUrl: fields.imageUrl,
      author: req.session.user.id,
      status: 'draft'
    });

    return res.status(201).json({ id: article._id, updatedAt: article.updatedAt });
  } catch (err) {
    return next(err);
  }
}

/**
 * Continuous autosave. For a published article, edits are staged into
 * `pendingUpdate` (the live version stays untouched). For a draft or rejected
 * article, edits are written straight to the primary fields. Editing an article
 * that is awaiting approval is refused.
 * @param {import('express').Request} req - Params.id, body of editable fields.
 * @param {import('express').Response} res - JSON { success, updatedAt }.
 * @returns {Promise<void>}
 */
async function autosaveArticle(req, res, next) {
  try {
    const { article, error } = await loadOwnedArticle(req.params.id, req.session.user.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    if (!req.body || EDITABLE_FIELDS.some(key => req.body[key] !== undefined && typeof req.body[key] !== 'string')) {
      return res.status(400).json({ error: 'Article fields must be strings' });
    }
    const fields = pickEditableFields(req.body);
    if (fields.category !== undefined && !Article.ARTICLE_CATEGORIES.includes(fields.category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const version = req.body.saveVersion === undefined ? article.saveVersion + 1 : req.body.saveVersion;
    if (!Number.isSafeInteger(version) || version < 1) {
      return res.status(400).json({ error: 'Invalid save version' });
    }
    const now = new Date();

    if (article.status === 'published') {
      if (article.pendingUpdate.status === 'pending') {
        return res.status(400).json({ error: 'Cannot edit a revision awaiting approval' });
      }
      const previous = article.pendingUpdate.hasUpdate ? article.pendingUpdate : article;
      article.pendingUpdate = {
        status: article.pendingUpdate.status,
        editorNotes: article.pendingUpdate.editorNotes || '',
        hasUpdate: true,
        title: fields.title ?? previous.title,
        summary: fields.summary ?? previous.summary,
        content: fields.content ?? previous.content,
        category: fields.category ?? previous.category,
        imageUrl: fields.imageUrl ?? previous.imageUrl,
        updatedAt: now
      };
    } else if (article.status === 'draft' || article.status === 'rejected') {
      Object.assign(article, fields);
    } else {
      return res.status(400).json({ error: 'Cannot edit an article that is awaiting approval' });
    }

    await article.validate();
    const filter = {
      _id: article._id, status: article.status,
      $or: [{ saveVersion: { $lte: version } }, { saveVersion: { $exists: false } }]
    };
    const update = { saveVersion: version };
    if (article.status === 'published') {
      filter['pendingUpdate.status'] = { $in: [article.pendingUpdate.status, null] };
      update.pendingUpdate = article.pendingUpdate.toObject();
    } else Object.assign(update, fields);
    const result = await Article.updateOne(filter, { $set: update });
    if (!result.matchedCount) {
      return res.status(409).json({ error: 'A newer save or review state exists. Reload before editing.' });
    }
    return res.json({ success: true, updatedAt: now, saveVersion: version });
  } catch (err) {
    return next(err);
  }
}

/**
 * Submits a draft or rejected article for editor review (→ pending). Any other
 * source state is an illegal transition and refused.
 * @param {import('express').Request} req - Params.id.
 * @param {import('express').Response} res - JSON { success, status }.
 * @returns {Promise<void>}
 */
async function submitArticle(req, res, next) {
  try {
    const { article, error } = await loadOwnedArticle(req.params.id, req.session.user.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const candidate = article.status === 'published' ? article.pendingUpdate : article;
    if (!Article.isComplete(candidate)) {
      return res.status(400).json({ error: 'Title, summary, content and a valid category are required before submission' });
    }
    if (article.status === 'published') {
      if (!article.pendingUpdate.hasUpdate || !['draft', 'rejected'].includes(article.pendingUpdate.status)) {
        return res.status(400).json({ error: 'No editable revision to submit' });
      }
      article.pendingUpdate.status = 'pending';
      article.pendingUpdate.editorNotes = '';
    } else if (article.status !== 'draft' && article.status !== 'rejected') {
      return res.status(400).json({ error: `Cannot submit an article in '${article.status}' state` });
    }

    if (article.status !== 'published') article.status = 'pending';
    article.editorNotes = '';
    await article.save();

    return res.json({ success: true, status: article.status, revisionStatus: article.pendingUpdate.status });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getReporterArticles, createArticle, autosaveArticle, submitArticle };
