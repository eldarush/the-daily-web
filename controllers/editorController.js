const mongoose = require('mongoose');
const Article = require('../models/Article');

const PAGE_SIZE = 20;
const EDITABLE_FIELDS = ['title', 'summary', 'content', 'category', 'imageUrl'];

/**
 * Loads an article by id with a validity/existence guard.
 * @param {string} articleId - Article id.
 * @returns {Promise<{ article: any, error: { status: number, message: string } | null }>}
 */
async function loadArticle(articleId) {
  if (!mongoose.isValidObjectId(articleId)) {
    return { article: null, error: { status: 400, message: 'Invalid article id' } };
  }
  const article = await Article.findById(articleId);
  if (!article) {
    return { article: null, error: { status: 404, message: 'Article not found' } };
  }
  return { article, error: null };
}

/**
 * Lists all articles in the system, optionally filtered by status, paginated.
 * @param {import('express').Request} req - Query: status?, page?.
 * @param {import('express').Response} res - JSON { articles, page, total, pageSize }.
 * @returns {Promise<void>}
 */
async function listAllArticles(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filter = {};
    if (req.query.status) {
      if (!Article.ARTICLE_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      filter.status = req.query.status;
    }

    const [articles, total] = await Promise.all([
      Article.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .populate('author', 'fullName username')
        .lean(),
      Article.countDocuments(filter)
    ]);

    return res.json({ articles, page, total, pageSize: PAGE_SIZE });
  } catch (err) {
    return next(err);
  }
}

/**
 * Returns the live content vs the staged pending update, for the diff viewer.
 * @param {import('express').Request} req - Params.id.
 * @param {import('express').Response} res - JSON { live, pending }.
 * @returns {Promise<void>}
 */
async function getArticleDiff(req, res, next) {
  try {
    const { article, error } = await loadArticle(req.params.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    return res.json({
      live: {
        title: article.title,
        summary: article.summary,
        content: article.content,
        category: article.category,
        imageUrl: article.imageUrl
      },
      pending: article.pendingUpdate && article.pendingUpdate.hasUpdate ? article.pendingUpdate : null
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Editor edits the article body directly. On a published article the edit is
 * staged as a pending update (public keeps the live version); otherwise the
 * primary fields are updated in place.
 * @param {import('express').Request} req - Params.id, body of editable fields.
 * @param {import('express').Response} res - JSON { success }.
 * @returns {Promise<void>}
 */
async function editArticle(req, res, next) {
  try {
    const { article, error } = await loadArticle(req.params.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const fields = {};
    for (const key of EDITABLE_FIELDS) {
      if (req.body[key] !== undefined) {
        fields[key] = req.body[key];
      }
    }
    if (fields.category !== undefined && !Article.ARTICLE_CATEGORIES.includes(fields.category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    if (article.status === 'published') {
      article.pendingUpdate = {
        hasUpdate: true,
        title: fields.title ?? article.title,
        summary: fields.summary ?? article.summary,
        content: fields.content ?? article.content,
        category: fields.category ?? article.category,
        imageUrl: fields.imageUrl ?? article.imageUrl,
        updatedAt: new Date()
      };
    } else {
      Object.assign(article, fields);
    }

    await article.save();
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

/**
 * Approves an article. If it carries a staged update, the update is promoted to
 * the live fields and a milestone is logged. Otherwise the article is published
 * for the first time.
 * @param {import('express').Request} req - Params.id, body.changelogNote?.
 * @param {import('express').Response} res - JSON { success, status }.
 * @returns {Promise<void>}
 */
async function approveArticle(req, res, next) {
  try {
    const { article, error } = await loadArticle(req.params.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const hasStagedUpdate = article.pendingUpdate && article.pendingUpdate.hasUpdate;

    if (hasStagedUpdate) {
      article.title = article.pendingUpdate.title;
      article.summary = article.pendingUpdate.summary;
      article.content = article.pendingUpdate.content;
      article.category = article.pendingUpdate.category;
      article.imageUrl = article.pendingUpdate.imageUrl;
      article.publishedUpdates.push({
        publishedAt: new Date(),
        editor: req.session.user.id,
        changelogNote: req.body.changelogNote || 'Editorial update'
      });
      article.pendingUpdate = { hasUpdate: false };
    } else {
      if (article.status !== 'pending') {
        return res.status(400).json({ error: `Cannot publish an article in '${article.status}' state` });
      }
      article.status = 'published';
      article.publishedAt = new Date();
    }

    article.editorNotes = '';
    await article.save();
    return res.json({ success: true, status: article.status });
  } catch (err) {
    return next(err);
  }
}

/**
 * Returns an article to the reporter for corrections, with mandatory notes.
 * @param {import('express').Request} req - Params.id, body.notes (required).
 * @param {import('express').Response} res - JSON { success, status }.
 * @returns {Promise<void>}
 */
async function rejectArticle(req, res, next) {
  try {
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
    if (!notes) {
      return res.status(400).json({ error: 'Rejection notes are required' });
    }

    const { article, error } = await loadArticle(req.params.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    if (article.status !== 'pending') {
      return res.status(400).json({ error: `Cannot reject an article in '${article.status}' state` });
    }

    article.status = 'rejected';
    article.editorNotes = notes;
    await article.save();
    return res.json({ success: true, status: article.status });
  } catch (err) {
    return next(err);
  }
}

/**
 * Deletes an article.
 * @param {import('express').Request} req - Params.id.
 * @param {import('express').Response} res - JSON { success }.
 * @returns {Promise<void>}
 */
async function deleteArticle(req, res, next) {
  try {
    const { article, error } = await loadArticle(req.params.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    await article.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listAllArticles,
  getArticleDiff,
  editArticle,
  approveArticle,
  rejectArticle,
  deleteArticle
};
