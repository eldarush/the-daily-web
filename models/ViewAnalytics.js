const mongoose = require('mongoose');

/**
 * Time-bucketed view records for Impact Analytics.
 *
 * One document per article per hour keeps storage proportional to article-hours
 * rather than individual visits. The unique index identifies each bucket, and
 * `$inc` updates its count without a separate read-modify-write step.
 */
const viewAnalyticsSchema = new mongoose.Schema(
  {
    article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true, index: true },

    // Start of the hour this bucket accumulates, truncated to UTC HH:00:00.000.
    timestampBucket: { type: Date, required: true, index: true },

    views: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

// One bucket per (article, hour) — enables atomic upsert and prevents duplicates.
viewAnalyticsSchema.index({ article: 1, timestampBucket: 1 }, { unique: true });

module.exports = mongoose.model('ViewAnalytics', viewAnalyticsSchema);
