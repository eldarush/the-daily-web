/* Impact Analytics: pure-canvas time-series of hourly views with vertical
   markers at each editor-update publication point. No charting library. */
(function () {
  'use strict';

  const PAD = { top: 30, right: 24, bottom: 46, left: 52 };
  const COLOR_LINE = '#2b6cb0';
  const COLOR_FILL = 'rgba(43, 108, 176, 0.12)';
  const COLOR_AXIS = '#cbd5e0';
  const COLOR_TEXT = '#718096';
  const COLOR_MILESTONE = '#dd6b20';

  const canvas = document.getElementById('impactChart');
  const ctx = canvas.getContext('2d');
  const selectEl = document.getElementById('article-select');
  const tooltip = document.getElementById('chart-tooltip');
  const emptyEl = document.getElementById('chart-empty');
  const summaryEl = document.getElementById('chart-summary');

  let points = []; // { x, y, time, views }
  let milestones = []; // { x, time, changelogNote }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function plotWidth() {
    return canvas.width - PAD.left - PAD.right;
  }

  function plotHeight() {
    return canvas.height - PAD.top - PAD.bottom;
  }

  function drawAxes(maxViews, tMin, tMax) {
    ctx.strokeStyle = COLOR_AXIS;
    ctx.fillStyle = COLOR_TEXT;
    ctx.lineWidth = 1;
    ctx.font = '11px -apple-system, Segoe UI, sans-serif';

    // Y axis + gridlines (5 steps)
    const steps = 5;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let s = 0; s <= steps; s++) {
      const val = Math.round((maxViews / steps) * s);
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
      const text = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit' });
      ctx.fillText(text, x, PAD.top + plotHeight() + 8);
    });
  }

  function drawSeries() {
    if (points.length === 0) return;

    // Filled area under the line
    ctx.beginPath();
    ctx.moveTo(points[0].x, PAD.top + plotHeight());
    points.forEach(function (p) { ctx.lineTo(p.x, p.y); });
    ctx.lineTo(points[points.length - 1].x, PAD.top + plotHeight());
    ctx.closePath();
    ctx.fillStyle = COLOR_FILL;
    ctx.fill();

    // Line
    ctx.beginPath();
    points.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = COLOR_LINE;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawMilestones() {
    ctx.save();
    ctx.setLineDash([5, 4]);
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

  function render(data) {
    points = [];
    milestones = [];
    clear();

    const timeline = data.timeline || [];
    if (timeline.length === 0) {
      emptyEl.hidden = false;
      canvas.hidden = true;
      summaryEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    canvas.hidden = false;

    const times = timeline.map(function (r) { return new Date(r.time).getTime(); });
    const views = timeline.map(function (r) { return r.views; });
    const tMin = Math.min.apply(null, times);
    const tMax = Math.max.apply(null, times);
    const maxViews = Math.max(1, Math.max.apply(null, views));
    const span = tMax - tMin || 1;

    function xFor(t) { return PAD.left + (plotWidth() * (t - tMin)) / span; }
    function yFor(v) { return PAD.top + plotHeight() - (plotHeight() * v) / maxViews; }

    points = timeline.map(function (r) {
      const t = new Date(r.time).getTime();
      return { x: xFor(t), y: yFor(r.views), time: t, views: r.views };
    });
    milestones = (data.milestones || [])
      .map(function (m) {
        return { x: xFor(new Date(m.time).getTime()), time: new Date(m.time).getTime(), changelogNote: m.changelogNote };
      })
      .filter(function (m) { return m.x >= PAD.left && m.x <= PAD.left + plotWidth(); });

    drawAxes(maxViews, tMin, tMax);
    drawSeries();
    drawMilestones();

    renderSummary(views, data.milestones || []);
  }

  function renderSummary(views, updateList) {
    const total = views.reduce(function (a, b) { return a + b; }, 0);
    document.getElementById('sum-total').textContent = total.toLocaleString();
    document.getElementById('sum-updates').textContent = String(updateList.length);
    document.getElementById('sum-peak').textContent = Math.max.apply(null, views).toLocaleString();
    summaryEl.hidden = false;
  }

  function toCanvasCoords(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

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
      html += '<div class="tooltip-milestone">✎ ' + escapeHtml(milestone.changelogNote || 'Editor update') + '</div>';
    }
    tooltip.innerHTML = html;
    tooltip.hidden = false;

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

  async function loadArticleOptions() {
    try {
      const res = await fetch('/api/editor/articles?status=published');
      if (!res.ok) {
        selectEl.innerHTML = '<option value="">Could not load</option>';
        return;
      }
      const body = await res.json();
      const list = body.articles || [];
      if (list.length === 0) {
        selectEl.innerHTML = '<option value="">No published articles</option>';
        return;
      }
      selectEl.innerHTML = '<option value="">Select an article…</option>';
      list.forEach(function (a) {
        const opt = document.createElement('option');
        opt.value = a._id;
        opt.textContent = a.title;
        selectEl.appendChild(opt);
      });
    } catch (err) {
      selectEl.innerHTML = '<option value="">Could not load</option>';
    }
  }

  async function handleSelect() {
    const id = selectEl.value;
    if (!id) {
      clear();
      summaryEl.hidden = true;
      emptyEl.hidden = true;
      return;
    }
    try {
      const res = await fetch('/api/analytics/' + id);
      if (!res.ok) return;
      const data = await res.json();
      render(data);
    } catch (err) {
      /* leave canvas as-is on failure */
    }
  }

  function init() {
    selectEl.addEventListener('change', handleSelect);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseleave', handleLeave);
    loadArticleOptions();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
