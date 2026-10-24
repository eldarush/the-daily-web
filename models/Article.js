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
    // hasUpdate marks a real proposal; the default draft status alone does not.
    hasUpdate: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'pending', 'rejected'], default: 'draft' },
    editorNotes: { type: String, default: '' },
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

/**
 * The text fields of one version of an article, for comparing two versions.
 */
const articleTextSchema = new mongoose.Schema(
  {
    title: String,
    summary: String,
    content: String,
    category: String,
    imageUrl: String
  },
  { _id: false }
);

/**
 * What an editor changed in a submitted article: the reporter's text before the
 * editor's first edit, and the editor's latest version. The reporter's workspace
 * highlights the difference. Cleared when the reporter resubmits or it is approved.
 */
const editorChangesSchema = new mongoose.Schema(
  {
    before: articleTextSchema,
    after: articleTextSchema,
    editedAt: Date
  },
  { _id: false }
);

const articleSchema = new mongoose.Schema(
  {
    title: { type: String, default: '', trim: true },
    summary: { type: String, default: '', trim: true },
    content: { type: String, default: '' },
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
    saveVersion: { type: Number, default: 0 },
    viewsCount: { type: Number, default: 0, index: true },
    publishedAt: { type: Date, default: null, index: true },

    // Staged edits to a published article (dual-version workflow).
    pendingUpdate: { type: pendingUpdateSchema, default: () => ({}) },

    // Timestamps of editor updates, for analytics milestone markers.
    publishedUpdates: { type: [publishedUpdateSchema], default: [] },

    // Set while an editor's edits to a submitted article wait for the reporter to see them.
    editorChanges: { type: editorChangesSchema, default: undefined }
  },
  { timestamps: true }
);

// Available full-text index. The current public search uses escaped title/summary
// regexes instead; declaring this index does not make those queries $text queries.
articleSchema.index({ title: 'text', summary: 'text', content: 'text' });

// Indexes for the public feed's status/category filters and date/popularity sorts.
articleSchema.index({ status: 1, publishedAt: -1, _id: -1 });
articleSchema.index({ status: 1, category: 1, publishedAt: -1, _id: -1 });
articleSchema.index({ status: 1, viewsCount: -1, publishedAt: -1, _id: -1 });
articleSchema.index({ status: 1, category: 1, viewsCount: -1, publishedAt: -1, _id: -1 });

const Article = mongoose.model('Article', articleSchema);

module.exports = Article;
module.exports.ARTICLE_CATEGORIES = ARTICLE_CATEGORIES;
module.exports.ARTICLE_STATUSES = ARTICLE_STATUSES;

// Submission/publication require nonblank content; draft persistence deliberately
// allows incomplete text so autosave can retain work before it is ready to review.
module.exports.isComplete = function (fields) {
  return ['title', 'summary', 'content'].every(key => typeof fields[key] === 'string' && fields[key].trim())
    && ARTICLE_CATEGORIES.includes(fields.category);
};
