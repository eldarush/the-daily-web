const mongoose = require('mongoose');

/**
 * Time-bucketed view records for Impact Analytics.
 *
 * Instead of storing one document per page view (which would not scale to the
 * thousands of concurrent readers the spec assumes), views are aggregated into
 * one document per article per hour. Recording a view is a single atomic
 * `$inc` upsert on the { article, timestampBucket } pair, so concurrent hits on
 * the same article in the same hour contend on one document without lost writes.
 */
const viewAnalyticsSchema = new mongoose.Schema(
  {
    article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true, index: true },

    // Start of the hour this bucket accumulates, truncated to UTC HH:00:00.000.
    timestampBucket: { type: Date, required: true, index: true },

    views: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// One bucket per (article, hour) — enables atomic upsert and prevents duplicates.
viewAnalyticsSchema.index({ article: 1, timestampBucket: 1 }, { unique: true });

module.exports = mongoose.model('ViewAnalytics', viewAnalyticsSchema);
