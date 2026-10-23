/* Canvas chart of hourly views and approved-update milestones.
   The article picker and chart data come from the editor-only analytics API. */
(function () {
  'use strict';

  // Empty space around the plot, in pixels, for the axis labels.
  const PAD = { top: 30, right: 24, bottom: 46, left: 52 };
  const COLOR_LINE = '#2b6cb0';
  const COLOR_FILL = 'rgba(43, 108, 176, 0.12)';
  const COLOR_AXIS = '#cbd5e0';
  const COLOR_TEXT = '#718096';
  const COLOR_MILESTONE = '#dd6b20';

  const canvas = document.getElementById('impactChart');
  const ctx = canvas.getContext('2d');
  const selectEl = document.getElementById('article-select');
  const previousEl = document.getElementById('articles-previous');
  const nextEl = document.getElementById('articles-next');
  const pageEl = document.getElementById('articles-page');
  let articlePage = 1;
  // the articles in the picker now, and whether another page follows
  let articleList = [];
  let hasMorePages = false;
  const tooltip = document.getElementById('chart-tooltip');
  const emptyEl = document.getElementById('chart-empty');
  const summaryEl = document.getElementById('chart-summary');

  // Pixel positions of what is currently drawn, kept so the tooltip can find
  // the nearest hour without redrawing anything.
  let points = []; // { x, y, time, views }
  let milestones = []; // { x, time, changelogNote }
  let requestNumber = 0;

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function resetChart() {
    // A new selection or selector page invalidates earlier requests.
    requestNumber++;
    points = [];
    milestones = [];
    clear();
    canvas.hidden = true;
    summaryEl.hidden = true;
    emptyEl.hidden = true;
    tooltip.hidden = true;
  }

  // Size of the drawing area inside the padding (canvas is 900 × 380).
  function plotWidth() {
    return canvas.width - PAD.left - PAD.right;
  }

  function plotHeight() {
    return canvas.height - PAD.top - PAD.bottom;
  }

  // Draws the horizontal gridlines with view counts on the left, and three
  // date labels under the plot (first hour, middle, last hour).
  function drawAxes(maxViews, tMin, tMax) {
    ctx.strokeStyle = COLOR_AXIS;
    ctx.fillStyle = COLOR_TEXT;
    ctx.lineWidth = 1;
    ctx.font = '11px -apple-system, Segoe UI, sans-serif';

    // Y axis + gridlines (5 steps)
    // e.g. maxViews 33 → labels 0, 7, 13, 20, 26, 33 from bottom to top.
    const steps = 5;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let s = 0; s <= steps; s++) {
      const val = Math.round((maxViews / steps) * s);
      // s = 0 is the bottom line; each step moves up by a fifth of the height.
      const y = PAD.top + plotHeight() - (plotHeight() / steps) * s;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotWidth(), y);
      ctx.strokeStyle = s === 0 ? COLOR_AXIS : '#edf2f7';
      ctx.stroke();
      ctx.fillText(String(val), PAD.left - 8, y);
    }

    // X axis time labels (start / mid / end)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labels = [tMin, (tMin + tMax) / 2, tMax];
    labels.forEach(function (t, idx) {
      const x = PAD.left + (labels.length === 1 ? plotWidth() / 2 : (plotWidth() / 2) * idx);
      const d = new Date(t);
      // Shown in the viewer's local time zone (buckets are stored in UTC).
      const text = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(text, x, PAD.top + plotHeight() + 8);
    });
  }

  // Draws the views as a line, with a light fill underneath it.
  function drawSeries() {
    if (points.length === 0) return;

    // Filled area under the line
    // Path: bottom-left → along every point → bottom-right → close back to the start.
    ctx.beginPath();
    ctx.moveTo(points[0].x, PAD.top + plotHeight());
    points.forEach(function (p) { ctx.lineTo(p.x, p.y); });
    ctx.lineTo(points[points.length - 1].x, PAD.top + plotHeight());
    ctx.closePath();
    ctx.fillStyle = COLOR_FILL;
    ctx.fill();

    // Line, including explicit zero points for hours without stored counters.
    ctx.beginPath();
    points.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = COLOR_LINE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COLOR_LINE;
    points.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  // Draws a dashed orange vertical line (+ triangle on top) at the moment
  // each update was approved, so a jump in views can be tied to an update.
  function drawMilestones() {
    // save/restore: the dash pattern only applies inside this function.
    ctx.save();
    ctx.setLineDash([5, 4]); // 5px dash, 4px gap
    ctx.strokeStyle = COLOR_MILESTONE;
    ctx.fillStyle = COLOR_MILESTONE;
    ctx.lineWidth = 1.5;
    milestones.forEach(function (m) {
      ctx.beginPath();
      ctx.moveTo(m.x, PAD.top);
      ctx.lineTo(m.x, PAD.top + plotHeight());
      ctx.stroke();
      // marker triangle at top
      ctx.beginPath();
      ctx.moveTo(m.x - 5, PAD.top - 6);
      ctx.lineTo(m.x + 5, PAD.top - 6);
      ctx.lineTo(m.x, PAD.top);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  // Main drawing step, called with the JSON from GET /api/analytics/:articleId.
  function render(data) {
    // Start from a blank canvas: forget the previous article completely.
    points = [];
    milestones = [];
    clear();

    const timeline = [];
    const hour = 60 * 60 * 1000;
    // Add gap boundaries without allocating a point for every missing hour.
    (data.timeline || []).forEach(function (record) {
      const previous = timeline[timeline.length - 1];
      const time = new Date(record.time).getTime();
      if (previous) {
        const before = new Date(previous.time).getTime();
        if (time - before > hour) timeline.push({ time: new Date(before + hour).toISOString(), views: 0 });
        if (time - before > 2 * hour) timeline.push({ time: new Date(time - hour).toISOString(), views: 0 });
      }
      timeline.push(record);
    });
    if (timeline.length === 0) {
      emptyEl.hidden = false;
      canvas.hidden = true;
      summaryEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    emptyEl.textContent = 'No view data yet for this article.';
    canvas.hidden = false;

    // Find the ranges the chart must cover. Milestone times are included so an
    // update marker is never outside the drawn time range.
    const times = timeline.map(function (r) { return new Date(r.time).getTime(); })
      .concat((data.milestones || []).map(function (m) { return new Date(m.time).getTime(); }));
    const views = timeline.map(function (r) { return r.views; });
    let tMin = Math.min.apply(null, times);
    let tMax = Math.max.apply(null, times);
    if (tMin === tMax) { tMin -= hour / 2; tMax += hour / 2; }
    const maxViews = Math.max(1, Math.max.apply(null, views)); // at least 1: never divide by 0
    const span = tMax - tMin || 1;

    // Data → pixels.
    // x: the earliest time maps to the left edge of the plot, the latest to the right edge.
    // y: 0 views maps to the bottom, maxViews to the top. It is "plotHeight − …"
    //    because canvas y grows DOWNWARD (y = 0 is the top of the canvas).
    function xFor(t) { return PAD.left + (plotWidth() * (t - tMin)) / span; }
    function yFor(v) { return PAD.top + plotHeight() - (plotHeight() * v) / maxViews; }

    // One point per hourly bucket.
    points = timeline.map(function (r) {
      const t = new Date(r.time).getTime();
      return { x: xFor(t), y: yFor(r.views), time: t, views: r.views };
    });
    // One marker per approved update, kept only if it falls inside the plot.
    milestones = (data.milestones || [])
      .map(function (m) {
        return { x: xFor(new Date(m.time).getTime()), time: new Date(m.time).getTime(), changelogNote: m.changelogNote };
      })
      .filter(function (m) { return m.x >= PAD.left && m.x <= PAD.left + plotWidth(); });

    // Draw in layers: later drawings paint on top of earlier ones.
    drawAxes(maxViews, tMin, tMax);
    drawSeries();
    drawMilestones();

    renderSummary(views, data.milestones || []);
  }

  // Fills the three numbers above the chart: total views, number of updates, busiest hour.
  function renderSummary(views, updateList) {
    const total = views.reduce(function (a, b) { return a + b; }, 0);
    document.getElementById('sum-total').textContent = total.toLocaleString();
    document.getElementById('sum-updates').textContent = String(updateList.length);
    document.getElementById('sum-peak').textContent = Math.max.apply(null, views).toLocaleString();
    summaryEl.hidden = false;
  }

  // The canvas is 900px wide internally but CSS can display it smaller or larger;
  // this converts the mouse position on screen into the canvas's own pixel units.
  function toCanvasCoords(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  // The data point whose x is closest to the mouse (only x matters: we pick the hour).
  function nearestPoint(cx) {
    let best = null;
    let bestDist = Infinity;
    points.forEach(function (p) {
      const d = Math.abs(p.x - cx);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    });
    return best;
  }

  // An update marker counts as "hovered" only if the mouse is within 8 pixels of it.
  function nearestMilestone(cx) {
    let best = null;
    let bestDist = 8;
    milestones.forEach(function (m) {
      const d = Math.abs(m.x - cx);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    });
    return best;
  }

  // Tooltip: on every mouse move, show the nearest hour's views and time,
  // plus the update's changelog note when the mouse is on a marker.
  function handleMove(evt) {
    if (points.length === 0) return;
    const c = toCanvasCoords(evt);
    const milestone = nearestMilestone(c.x);
    const point = nearestPoint(c.x);
    if (!point) return;

    const when = new Date(point.time).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    let html = '<strong>' + point.views + ' views</strong><br>' + when;
    if (milestone) {
      // The note is typed by an editor, so it is escaped before going into innerHTML (no XSS).
      html += '<div class="tooltip-milestone">' + escapeHtml(milestone.changelogNote || 'Editor update') + '</div>';
    }
    tooltip.innerHTML = html;
    tooltip.hidden = false;

    // Convert the point back from canvas pixels to screen pixels to place the tooltip on it.
    const rect = canvas.getBoundingClientRect();
    const screenX = rect.left + (point.x * rect.width) / canvas.width;
    const screenY = rect.top + (point.y * rect.height) / canvas.height;
    tooltip.style.left = (screenX - rect.left) + 'px';
    tooltip.style.top = (screenY - rect.top) + 'px';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function handleLeave() {
    tooltip.hidden = true;
  }

  // Fills the dropdown with published articles, 20 per page.
  // Server: routes/api/analyticsRoutes.js → analyticsController.listPublishedArticles.
  // pick ('first' or 'last') also chooses that article once the page is loaded.
  async function loadArticleOptions(pick) {
    resetChart();
    const currentRequest = requestNumber;
    selectEl.disabled = true;
    // no double clicks while a page loads
    previousEl.disabled = true;
    nextEl.disabled = true;
    articleList = [];
    hasMorePages = false;
    try {
      const res = await fetch('/api/analytics/articles?page=' + articlePage);
      if (currentRequest !== requestNumber) return;
      if (!res.ok) {
        selectEl.innerHTML = '<option value="">Could not load</option>';
        return;
      }
      const body = await res.json();
      if (currentRequest !== requestNumber) return;
      articleList = body.articles || [];
      hasMorePages = Boolean(body.hasMore);
      pageEl.textContent = 'Page ' + articlePage;
      if (articleList.length === 0) {
        selectEl.innerHTML = '<option value="">No published articles</option>';
        return;
      }
      selectEl.innerHTML = '<option value="">Select an article…</option>';
      articleList.forEach(function (a) {
        const opt = document.createElement('option');
        opt.value = a._id;
        opt.textContent = a.title;
        selectEl.appendChild(opt);
      });
    } catch (err) {
      if (currentRequest !== requestNumber) return;
      selectEl.innerHTML = '<option value="">Could not load</option>';
    } finally {
      if (currentRequest === requestNumber) {
        selectEl.disabled = false;
        updateStepButtons();
      }
    }
    // after the finally block: handleSelect bumps requestNumber, which would
    // stop the finally from enabling the dropdown
    if (pick && articleList.length > 0 && currentRequest === requestNumber) {
      await chooseIndex(pick === 'last' ? articleList.length - 1 : 0);
    }
  }

  // option 0 is the "Select an article…" placeholder
  function chooseIndex(index) {
    selectEl.selectedIndex = index + 1;
    return handleSelect();
  }

  // -1 when nothing is chosen yet
  function currentIndex() {
    return selectEl.selectedIndex - 1;
  }

  // off at the very first and the very last article
  function updateStepButtons() {
    const index = currentIndex();
    previousEl.disabled = articlePage === 1 && index <= 0;
    nextEl.disabled = !(index < articleList.length - 1 || hasMorePages);
  }

  // Moves one article. Past the end of the 20 shown it loads the next or
  // previous page and picks its first or last article.
  function stepArticle(direction) {
    const index = currentIndex();
    if (direction > 0) {
      if (index < articleList.length - 1) return chooseIndex(index + 1);
      if (hasMorePages) {
        articlePage++;
        return loadArticleOptions('first');
      }
    } else {
      if (index > 0) return chooseIndex(index - 1);
      if (articlePage > 1) {
        articlePage--;
        return loadArticleOptions('last');
      }
    }
  }

  // The API returns only the selected article's counters and update milestones.
  async function handleSelect() {
    const id = selectEl.value;
    updateStepButtons();
    resetChart();
    const currentRequest = requestNumber;
    if (!id) return;
    try {
      const res = await fetch('/api/analytics/' + id);
      if (!res.ok) throw new Error('Could not load statistics');
      const data = await res.json();
      if (currentRequest !== requestNumber) return;
      render(data);
    } catch (err) {
      if (currentRequest !== requestNumber) return;
      clear();
      canvas.hidden = true;
      summaryEl.hidden = true;
      emptyEl.textContent = 'Could not load statistics. Select the article again to retry.';
      emptyEl.hidden = false;
    }
  }

  // Wires every event once, then loads the first page of articles.
  function init() {
    selectEl.addEventListener('change', handleSelect);
    previousEl.addEventListener('click', function () { stepArticle(-1); });
    nextEl.addEventListener('click', function () { stepArticle(1); });
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseleave', handleLeave);
    loadArticleOptions();
  }

  // Wait until the HTML is parsed, so all the elements above exist.
  document.addEventListener('DOMContentLoaded', init);
})();
