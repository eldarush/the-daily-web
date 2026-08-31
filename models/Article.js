const mongoose = require('mongoose');

/**
 * Allowed article categories. Single source of truth shared with the public
 * feed module — any category filter/sort on the client must use this list.
 * @type {readonly string[]}
 */
const ARTICLE_CATEGORIES = ['News', 'Technology', 'Economy', 'Sports', 'Culture', 'Health', 'World'];

/**
 * Allowed lifecycle states for an article.
 *   draft     — being written / returned for corrections, editable by its author.
 *   pending   — submitted, awaiting editor review.
 *   published — live and visible to the public.
 *   rejected  — returned by an editor with notes; author may fix and resubmit.
 * @type {readonly string[]}
 */
const ARTICLE_STATUSES = ['draft', 'pending', 'published', 'rejected'];

/**
 * Sub-schema staging edits made to an ALREADY-PUBLISHED article.
 * While `hasUpdate` is true the public keeps seeing the live fields; the staged
 * values here are promoted to the live fields only when an editor approves.
 */
const pendingUpdateSchema = new mongoose.Schema(
  {
    hasUpdate: { type: Boolean, default: false },
    title: { type: String, trim: true },
    summary: { type: String, trim: true },
    content: { type: String },
    category: { type: String, enum: ARTICLE_CATEGORIES },
    imageUrl: { type: String },
    updatedAt: { type: Date }
  },
  { _id: false }
);

/**
 * One entry per time an editor published an update to a live article.
 * Consumed by Impact Analytics to draw milestone markers on the view timeline.
 */
const publishedUpdateSchema = new mongoose.Schema(
  {
    publishedAt: { type: Date, default: Date.now },
    editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changelogNote: { type: String, trim: true }
  },
  { _id: false }
);

const articleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    summary: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    category: {
      type: String,
      enum: ARTICLE_CATEGORIES,
      required: true,
      index: true
    },
    imageUrl: { type: String, default: '/images/default-article.jpg' },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ARTICLE_STATUSES,
      default: 'draft',
      index: true
    },
    editorNotes: { type: String, default: '' },
    viewsCount: { type: Number, default: 0, index: true },
    publishedAt: { type: Date, default: null, index: true },

    // Staged edits to a published article (dual-version workflow).
    pendingUpdate: { type: pendingUpdateSchema, default: () => ({}) },

    // Timestamps of editor updates, for analytics milestone markers.
    publishedUpdates: { type: [publishedUpdateSchema], default: [] }
  },
  { timestamps: true }
);

// Full-text search across the primary editorial fields (title is the central field).
articleSchema.index({ title: 'text', summary: 'text', content: 'text' });

// Compound index backing the paginated "latest first" feed and reporter lists.
articleSchema.index({ status: 1, publishedAt: -1 });

const Article = mongoose.model('Article', articleSchema);

module.exports = Article;
module.exports.ARTICLE_CATEGORIES = ARTICLE_CATEGORIES;
module.exports.ARTICLE_STATUSES = ARTICLE_STATUSES;
