/* Chart of hourly views and approved-update markers, drawn with Chart.js
   (loaded before this script on the page).
   The article picker and chart data come from the editor-only analytics API. */
(function () {
  'use strict';

  const COLOR_LINE = '#2b6cb0';
  const COLOR_FILL = 'rgba(43, 108, 176, 0.12)';
  const COLOR_AXIS = '#cbd5e0';
  const COLOR_GRID = '#edf2f7';
  const COLOR_TEXT = '#718096';
  const COLOR_MILESTONE = '#dd6b20';
  const HOUR = 60 * 60 * 1000;
  const ASPECT_RATIO = 900 / 380;

  const canvas = document.getElementById('impactChart');
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

  let chart = null; // the Chart.js instance for the article on screen
  let updates = []; // { time, note } of that article's approved updates
  let requestNumber = 0;

  function resetChart() {
    // A new selection or selector page invalidates earlier requests.
    requestNumber++;
    if (chart) chart.destroy();
    chart = null;
    updates = [];
    canvas.hidden = true;
    summaryEl.hidden = true;
    emptyEl.hidden = true;
    tooltip.hidden = true;
  }

  // Counters exist only for hours with views. Put a zero on each side of a gap so
  // the line drops to zero there, without a point for every missing hour.
  function withGapZeros(records) {
    const points = [];
    records.forEach(function (record) {
      const previous = points[points.length - 1];
      const time = new Date(record.time).getTime();
      if (previous) {
        if (time - previous.x > HOUR) points.push({ x: previous.x + HOUR, y: 0 });
        if (time - previous.x > 2 * HOUR) points.push({ x: time - HOUR, y: 0 });
      }
      points.push({ x: time, y: record.views });
    });
    return points;
  }

  // Shown in the viewer's local time zone (buckets are stored in UTC).
  function formatTime(value) {
    const d = new Date(value);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Dashed orange line and a small triangle at the moment each update was approved,
  // so a jump in views can be tied to an update. Chart.js has no such marker built in.
  const updateMarkers = {
    id: 'updateMarkers',
    afterDatasetsDraw: function (c) {
      const ctx = c.ctx;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = COLOR_MILESTONE;
      ctx.fillStyle = COLOR_MILESTONE;
      ctx.lineWidth = 1.5;
      updates.forEach(function (m) {
        const x = c.scales.x.getPixelForValue(m.time);
        ctx.beginPath();
        ctx.moveTo(x, c.chartArea.top);
        ctx.lineTo(x, c.chartArea.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 5, c.chartArea.top - 6);
        ctx.lineTo(x + 5, c.chartArea.top - 6);
        ctx.lineTo(x, c.chartArea.top);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    },
    // remember the mouse position, so the tooltip knows when it is over a marker;
    // beforeEvent, because Chart.js builds the tooltip before afterEvent runs
    beforeEvent: function (c, args) {
      c.mouseX = args.event.x;
    }
  };

  // Chart.js asks for the tooltip through this; it fills the page's own tooltip box,
  // which also shows the changelog note when the mouse is within 8 pixels of a marker.
  function showTooltip(context) {
    const t = context.tooltip;
    if (t.opacity === 0 || t.dataPoints.length === 0) {
      tooltip.hidden = true;
      return;
    }
    const point = t.dataPoints[0].raw;
    let marker = null;
    let bestDist = 8;
    updates.forEach(function (m) {
      const d = Math.abs(context.chart.scales.x.getPixelForValue(m.time) - context.chart.mouseX);
      if (d < bestDist) {
        bestDist = d;
        marker = m;
      }
    });

    const when = new Date(point.x).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    let html = '<strong>' + point.y + ' views</strong><br>' + when;
    if (marker) {
      // The note is typed by an editor, so it is escaped before going into innerHTML (no XSS).
      html += '<div class="tooltip-milestone">' + escapeHtml(marker.note || 'Editor update') + '</div>';
    }
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    tooltip.style.left = t.caretX + 'px';
    tooltip.style.top = t.caretY + 'px';
  }

  // Main drawing step, called with the JSON from GET /api/analytics/:articleId.
  function render(data) {
    const points = withGapZeros(data.timeline || []);
    emptyEl.textContent = 'No view data yet for this article.';
    if (points.length === 0) {
      emptyEl.hidden = false;
      canvas.hidden = true;
      summaryEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    canvas.hidden = false;

    updates = (data.milestones || []).map(function (m) {
      return { time: new Date(m.time).getTime(), note: m.changelogNote };
    });

    // The time axis covers the points and the markers, so a marker is never off the plot.
    // A single hour gets room on both sides.
    const times = points.map(function (p) { return p.x; })
      .concat(updates.map(function (m) { return m.time; }));
    let min = Math.min.apply(null, times);
    let max = Math.max.apply(null, times);
    if (min === max) { min -= HOUR / 2; max += HOUR / 2; }

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          data: points,
          parsing: false, // x and y are already numbers
          fill: 'origin',
          borderColor: COLOR_LINE,
          backgroundColor: COLOR_FILL,
          borderWidth: 2,
          tension: 0,
          pointRadius: 3,
          pointBackgroundColor: COLOR_LINE,
          pointBorderColor: COLOR_LINE
        }]
      },
      options: {
        animation: false,
        aspectRatio: ASPECT_RATIO,
        layout: { padding: { top: 8 } }, // room for the marker triangles
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false }, // the page has its own legend
          tooltip: { enabled: false, external: showTooltip }
        },
        scales: {
          x: {
            type: 'linear',
            min: min,
            max: max,
            grid: { display: false },
            border: { color: COLOR_AXIS },
            ticks: { color: COLOR_TEXT, font: { size: 11 }, maxRotation: 0, callback: formatTime },
            // only the start, the middle and the end
            afterBuildTicks: function (scale) {
              scale.ticks = [min, (min + max) / 2, max].map(function (value) { return { value: value }; });
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: COLOR_GRID },
            border: { display: false },
            ticks: { color: COLOR_TEXT, font: { size: 11 }, precision: 0 }
          }
        }
      },
      plugins: [updateMarkers]
    });

    renderSummary(points.map(function (p) { return p.y; }), data.milestones || []);
  }

  // Fills the three numbers above the chart: total views, number of updates, busiest hour.
  function renderSummary(views, updateList) {
    const total = views.reduce(function (a, b) { return a + b; }, 0);
    document.getElementById('sum-total').textContent = total.toLocaleString();
    document.getElementById('sum-updates').textContent = String(updateList.length);
    document.getElementById('sum-peak').textContent = Math.max.apply(null, views).toLocaleString();
    summaryEl.hidden = false;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
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
    emptyEl.textContent = 'Loading statistics…';
    emptyEl.hidden = false;
    try {
      const res = await fetch('/api/analytics/' + id);
      if (!res.ok) throw new Error('Could not load statistics');
      const data = await res.json();
      if (currentRequest !== requestNumber) return;
      render(data);
    } catch (err) {
      if (currentRequest !== requestNumber) return;
      resetChart();
      emptyEl.textContent = 'Could not load statistics. Select the article again to retry.';
      emptyEl.hidden = false;
    }
  }

  // Wires every event once, then loads the first page of articles.
  function init() {
    selectEl.addEventListener('change', handleSelect);
    previousEl.addEventListener('click', function () { stepArticle(-1); });
    nextEl.addEventListener('click', function () { stepArticle(1); });
    loadArticleOptions();
  }

  // Wait until the HTML is parsed, so all the elements above exist.
  document.addEventListener('DOMContentLoaded', init);
})();
