const commentForm = document.getElementById('comment-form');
const articleId = document.getElementById('article-id').value;

const articleImage = document.querySelector('.article-image img');
if (articleImage) {
    const fallback = () => {
        if (articleImage.dataset.fallbackApplied) {
            articleImage.hidden = true;
            return;
        }
        articleImage.dataset.fallbackApplied = 'true';
        articleImage.src = '/images/default-article.jpg';
    };
    articleImage.addEventListener('error', fallback);
    if (articleImage.complete && !articleImage.naturalWidth) fallback();
}

const commentContent = document.getElementById('comment-content');
const commentsList = document.getElementById('comments-list');
const commentMessage = document.getElementById('comment-message');

commentForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const authorNameInput = document.getElementById('author-name');

    const authorName = authorNameInput
        ? authorNameInput.value.trim()
        : null;

    const content = commentContent.value.trim();

    if (!content) {
        commentMessage.textContent = 'Please enter a comment';
        return;
    }

    if (authorNameInput && !authorName) {
        commentMessage.textContent = 'Please enter your name';
        return;
    }

    try {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: {'Content-Type' : 'application/json'},
            body: JSON.stringify({
                articleId: articleId,
                authorName: authorName,
                content: content
                })
            });

            const data = await response.json();

            if (!response.ok) {
                commentMessage.textContent =
                    data.message || data.error || 'Failed to post comment';
                return;
            }

            const comment = data.comment;

            const noCommentsMessage = document.getElementById('no-comments');

            if (noCommentsMessage) {
                noCommentsMessage.remove();
            }

            const newComment = document.createElement('div');
            newComment.className = 'comment';
            newComment.dataset.commentId = comment._id;

            newComment.innerHTML = `
                <div class="comment-header">
                    <strong></strong>
                    <span></span>
                </div>

                <p class ="comment-content"></p>
            `;

            newComment.querySelector('strong').textContent = comment.authorName;
            newComment.querySelector('span').textContent =
                new Date(comment.createdAt).toLocaleString();
            newComment.querySelector('.comment-content').textContent = comment.content;

            commentsList.prepend(newComment);

            commentContent.value = '';

            if (authorNameInput) {
                authorNameInput.value = '';
            }

            commentMessage.textContent = 'Comment posted successfully';
    }
    catch(error) {
        commentMessage.textContent =
            'Something went wrong. Please try again';
    }
});


