const mongoose = require('mongoose');
const Article = require('../models/Article');
const Comment = require('../models/Comment');
const ViewAnalytics = require('../models/ViewAnalytics');

const PAGE_SIZE = 20;
const EDITABLE_FIELDS = ['title', 'summary', 'content', 'category', 'imageUrl'];

/** Copies the editable text fields of an article or revision into a plain object. */
function textOf(source) {
  return Object.fromEntries(EDITABLE_FIELDS.map(key => [key, source[key]]));
}

/**
 * Loads an article by id with a validity/existence guard.
 * @param {string} articleId - Article id.
 * @returns {Promise<{ article: any, error: { status: number, message: string } | null }>}
 */
async function loadArticle(articleId) {
  if (!mongoose.isObjectIdOrHexString(articleId)) {
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
      if (['pending', 'rejected', 'draft'].includes(req.query.status)) {
        filter.$or = [{ status: req.query.status }, { status: 'published', 'pendingUpdate.hasUpdate': true, 'pendingUpdate.status': req.query.status }];
      } else filter.status = req.query.status;
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
 * @param {import('express').Response} res - JSON { status, live, pending }.
 * @returns {Promise<void>}
 */
async function getArticleDiff(req, res, next) {
  try {
    const { article, error } = await loadArticle(req.params.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    return res.json({
      status: article.status,
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
 * True when the reporter has submitted the article (or a revision of a live one)
 * and it waits for review. Only then is the reporter's copy locked, so only then
 * can the editor change it without the reporter's autosave writing over it.
 * @param {any} article - Article document.
 * @returns {boolean}
 */
function isSubmitted(article) {
  return article.status === 'pending' ||
    (article.status === 'published' && article.pendingUpdate.hasUpdate && article.pendingUpdate.status === 'pending');
}

/**
 * Editor edits a submitted article directly. On a published article the edit
 * changes the staged revision (public keeps the live version); otherwise the
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

    if (!req.body || EDITABLE_FIELDS.some(key => req.body[key] !== undefined && typeof req.body[key] !== 'string')) {
      return res.status(400).json({ error: 'Article fields must be strings' });
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
    if (!isSubmitted(article)) {
      return res.status(409).json({ error: 'Only submitted articles can be edited. The reporter is still working on this one.' });
    }

    const target = article.status === 'published' ? article.pendingUpdate : article;
    // Keep the reporter's text from before the editor's first edit in this review,
    // so the reporter later sees everything the editor changed, not only the last save.
    const before = article.editorChanges ? textOf(article.editorChanges.before) : textOf(target);
    Object.assign(target, fields);
    if (article.status === 'published') target.updatedAt = new Date();
    article.editorChanges = { before, after: textOf(target), editedAt: new Date() };

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
    if (req.body.changelogNote !== undefined && typeof req.body.changelogNote !== 'string') {
      return res.status(400).json({ error: 'Changelog note must be a string' });
    }
    const { article, error } = await loadArticle(req.params.id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const hasStagedUpdate = article.pendingUpdate && article.pendingUpdate.hasUpdate;

    const candidate = hasStagedUpdate ? article.pendingUpdate : article;
    if (!Article.isComplete(candidate)) {
      return res.status(400).json({ error: 'Title, summary, content and a valid category are required before publication' });
    }

    // Case 1: an approved revision of a live article. Copy the staged fields over the live
    // ones and log a milestone (the analytics chart draws a marker for it).
    // Case 2: a first-time publication: pending → published.
    if (hasStagedUpdate) {
      if (article.status !== 'published' || article.pendingUpdate.status !== 'pending') {
        return res.status(400).json({ error: 'Only submitted revisions can be approved' });
      }
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
    article.editorChanges = undefined;
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

    const revision = article.status === 'published' && article.pendingUpdate.hasUpdate && article.pendingUpdate.status === 'pending';
    if (article.status !== 'pending' && !revision) {
      return res.status(400).json({ error: `Cannot reject an article in '${article.status}' state` });
    }

    if (revision) {
      article.pendingUpdate.status = 'rejected';
      article.pendingUpdate.editorNotes = notes;
    } else {
      article.status = 'rejected';
      article.editorNotes = notes;
    }
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

    // MongoDB has no foreign keys or cascades, so we delete the related documents ourselves.
    await Comment.deleteMany({ article: article._id });
    await ViewAnalytics.deleteMany({ article: article._id });
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
