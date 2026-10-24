const mongoose = require('mongoose');

// authorName is a display snapshot; user is an optional account reference. Public
// responses project away userIp/user even though this schema retains them.
const commentSchema = new mongoose.Schema({
    article: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Article',
        required: true,
        index: true
    },

    authorName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },

    content: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },

    userIp: {
        type: String,
        required: true,
        index: true
    },

    isRegisteredUser: {
        type: Boolean,
        default: false
    },

    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
});

module.exports = mongoose.model('Comment', commentSchema);