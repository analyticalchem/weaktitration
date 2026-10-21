/* Titration Curve Explorer: the species bars. Moles of each form of the titrand (plain bars, one
 * series colour each, each named on the chart) and, when shown, the free OH⁻ and H₃O⁺ (hatched bars set
 * apart by a divider). Linear or log axis. Every bar carries its value as drawn text and the same numbers
 * are in the species table. Exposes window.Bars.
 *
 * Beside the curve (a wide, landscape window) the bars stand up, side by side, and fill the panel's
 * height; under the curve (a narrow or portrait window) they lie down, one row each, and the box's height
 * follows the number of bars.
 */
(function (root) {
  'use strict';

  var canvas, ctx, tip, wrap, W = 0, H = 0, dpr = 1, tok = {};
  var rows = [], geom = [], hover = -1, opts = { scale: 'linear', showIons: false }, upright = null;
  // Lying down: one band per bar. Standing up: the box's own height, at least V_MIN.
  var BAND = 34, BAND_MIN = 26, GAP = 12, TOP = 8, BOTTOM = 38, V_H = 300, V_MIN = 180;
  // Must match the media query in css/page.css that puts the species panel beside the curve.
  var BESIDE = '(min-width: 981px) and (min-aspect-ratio: 1/1)';
  var SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function sup(n) {
    return String(n).split('').map(function (c) { return SUP[c] !== undefined ? SUP[c] : c; }).join('');
  }

  /** 2.50 × 10⁻³, always in scientific form; 0 stays 0. */
  function sci(x, sig) {
    if (!isFinite(x)) return '—';
    if (x === 0) return '0';
    var parts = x.toExponential((sig || 3) - 1).split('e');
    return parts[0] + ' × 10' + sup(parseInt(parts[1], 10));
  }

  function beside() { return !!(root.matchMedia && root.matchMedia(BESIDE).matches); }

  function init(c, t) {
    canvas = c;
    tip = t;
    wrap = c.parentElement;
    ctx = canvas.getContext('2d');
    refresh();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', function () { setHover(-1); });
  }

  function refresh() {
    tok = {
      surface: cssVar('--surface'), text: cssVar('--text-primary'), text2: cssVar('--text-secondary'),
      muted: cssVar('--text-muted'), grid: cssVar('--grid'), axis: cssVar('--axis'),
      series: [cssVar('--series-a'), cssVar('--series-b'), cssVar('--series-c'), cssVar('--series-d')],
      oh: cssVar('--series-e'), h3o: cssVar('--series-f'),
      font: parseFloat(cssVar('--chart-font')) || 12, fontSmall: parseFloat(cssVar('--chart-font-small')) || 11,
      halo: parseFloat(cssVar('--chart-halo')) || 4, family: cssVar('--font') || 'system-ui, sans-serif'
    };
  }

  /** The box's height for the way the bars stand: --h, and --h-min, which one screen may shrink it to. */
  function size() {
    upright = beside();
    wrap.classList.toggle('is-upright', upright);
    var fixed = TOP + (opts.showIons ? GAP : 0) + BOTTOM;
    wrap.style.setProperty('--h', (upright ? V_H : fixed + BAND * rows.length) + 'px');
    wrap.style.setProperty('--h-min', (upright ? V_MIN : fixed + BAND_MIN * rows.length) + 'px');
  }

  function layout() {
    if (!canvas) return false;
    if (rows.length && upright !== beside()) size();
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    dpr = root.devicePixelRatio || 1;
    var w = Math.round(r.width), h = Math.round(r.height);
    if (w !== W || h !== H || canvas.width !== Math.round(w * dpr)) {
      W = w; H = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return true;
  }

  /** sys and the current state; o = { scale: 'linear' | 'log', showIons }. */
  function set(sys, st, o) {
    opts = o || opts;
    var sp = root.Model.speciesList(sys);
    rows = sp.map(function (s, i) {
      return { label: s.label, color: tok.series[i], v: st.moles[s.j], frac: st.alpha[s.j] };
    });
    if (opts.showIons) {
      if (sys.mode === 'acid') {
        rows.push({ label: 'OH⁻', color: tok.oh, v: st.nOH, ion: true, first: true });
        rows.push({ label: 'H₃O⁺', color: tok.h3o, v: st.nH, ion: true });
      } else {
        rows.push({ label: 'H₃O⁺', color: tok.h3o, v: st.nH, ion: true, first: true });
        rows.push({ label: 'OH⁻', color: tok.oh, v: st.nOH, ion: true });
      }
    }
    rows.nA = st.nA;
    rows.Vtot = st.Vtot;
    size();
    layout();
    draw();
  }

  function niceTicks(max, target) {
    if (!(max > 0)) return { step: 1, max: 1 };
    var raw = max / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
    return { step: step, max: Math.ceil(max / step - 1e-9) * step };
  }

  /** The value axis, whichever way the bars stand: f(moles) → 0..1 along a bar, the ticks, the title. */
  function valueAxis() {
    var ticks = [], e, v;
    if (opts.scale === 'log') {
      // One decade per gridline; the floor sits two decades under the smallest non-zero bar so the
      // ~10⁻¹¹ mol of free OH⁻ in a buffer is a visible length, not a stub.
      var pos = rows.filter(function (r) { return r.v > 0; }).map(function (r) { return r.v; });
      var eMax = Math.ceil(Math.log10(Math.max.apply(null, pos.concat([1e-12]))) + 0.05);
      var eMin = Math.floor(Math.log10(Math.min.apply(null, pos.concat([1])))) - 2;
      eMin = Math.max(eMin, eMax - 16, -18);
      eMin = Math.min(eMin, eMax - 2);
      var every = eMax - eMin > 8 ? 2 : 1;
      for (e = eMin; e <= eMax; e++) ticks.push({ f: (e - eMin) / (eMax - eMin), label: (e - eMin) % every === 0 ? '10' + sup(e) : '' });
      return {
        f: function (val) { return val <= 0 ? 0 : Math.max(0, (Math.log10(val) - eMin) / (eMax - eMin)); },
        ticks: ticks, title: 'Moles (log scale)'
      };
    }
    // A shared power of ten keeps the tick labels short.
    var vmax = Math.max(rows.nA, opts.showIons ? Math.max.apply(null, rows.map(function (r) { return r.v; })) : 0, 1e-12) * 1.08;
    e = Math.floor(Math.log10(vmax));
    var scale = Math.pow(10, e), t = niceTicks(vmax / scale, 4);
    for (v = 0; v <= t.max + 1e-9; v += t.step) ticks.push({ f: v / t.max, label: String(Math.round(v * 100) / 100) });
    return {
      f: function (val) { return val / (t.max * scale); },
      ticks: ticks, title: e === 0 ? 'Moles' : 'Moles (× 10' + sup(e) + ')'
    };
  }

  /** A bar's outline, rounded at its free end only (the right end lying down, the top standing up). */
  function barPath(x, y, w, h, standing) {
    var r = Math.min(4, standing ? Math.min(w / 2, h) : Math.min(w, h / 2));
    ctx.beginPath();
    if (standing) {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x, y + h);
    }
    ctx.closePath();
  }

  /** Fill a bar; the water ions are hatched, so they differ from the titrand's forms by pattern too. */
  function fillBar(r, x, y, w, h, standing) {
    barPath(x, y, w, h, standing);
    ctx.fillStyle = r.color;
    ctx.fill();
    if (!r.ion) return;
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = tok.surface;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var span = w + h;
    for (var s = -span; s < span; s += 6) {
      ctx.moveTo(x + s, y + h);
      ctx.lineTo(x + s + h, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function haloText(text, x, y) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = tok.halo;
    ctx.strokeStyle = tok.surface;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }

  // Boxes of the text drawn, for console checks that no two labels overlap.
  var drawn = [];
  function text(str, x, y, size, halo) {
    if (halo) haloText(str, x, y); else ctx.fillText(str, x, y);
    var w = ctx.measureText(str).width, a = ctx.textAlign, b = ctx.textBaseline;
    var left = a === 'center' ? x - w / 2 : a === 'right' ? x - w : x;
    var top = b === 'top' ? y : b === 'bottom' ? y - size : y - size / 2;
    drawn.push({ x: left, y: top, w: w, h: size });
  }

  function draw() {
    if (!ctx || !rows.length) return;
    if (!W && !layout()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tok.surface;
    ctx.fillRect(0, 0, W, H);
    geom = [];
    drawn = [];
    if (upright) drawStanding(valueAxis()); else drawLying(valueAxis());
  }

  /** Under the curve: one row per bar, named at its left, its value at its end. */
  function drawLying(ax) {
    var L = W < 420 ? 76 : 100, R = W < 420 ? 84 : 104, x0 = L, x1 = W - R, y0 = TOP, y1 = H - BOTTOM;
    var band = (y1 - y0 - (opts.showIons ? GAP : 0)) / rows.length;
    function X(val) { return x0 + Math.min(1, ax.f(val)) * (x1 - x0); }

    ctx.lineWidth = 1;
    ctx.font = tok.fontSmall + 'px ' + tok.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ax.ticks.forEach(function (t) {
      var px = Math.round(x0 + t.f * (x1 - x0)) + 0.5;
      ctx.strokeStyle = tok.grid;
      ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
      if (t.label) { ctx.fillStyle = tok.muted; ctx.fillText(t.label, px, y1 + 7); }
    });
    ctx.strokeStyle = tok.axis;
    ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0); ctx.lineTo(x0 + 0.5, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();
    ctx.font = tok.font + 'px ' + tok.family;
    ctx.fillStyle = tok.text2;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ax.title, (x0 + x1) / 2, H - 4);

    var bh = Math.min(22, band - 8), shift = 0;
    rows.forEach(function (r, i) {
      if (r.first) shift = GAP;
      var y = y0 + band * i + (band - bh) / 2 + shift;
      if (r.first) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = tok.grid;
        ctx.beginPath(); ctx.moveTo(0, y - GAP / 2 - 4 + 0.5); ctx.lineTo(W, y - GAP / 2 - 4 + 0.5); ctx.stroke();
      }
      var bw = Math.max(0, X(r.v) - x0);
      if (r.v > 0) bw = Math.max(bw, 2);
      if (bw > 0) fillBar(r, x0 + 1, y, bw, bh, false);
      ctx.font = tok.font + 'px ' + tok.family;
      ctx.fillStyle = tok.text2;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      text(r.label, x0 - 10, y + bh / 2, tok.font);
      ctx.font = '600 ' + tok.fontSmall + 'px ' + tok.family;
      ctx.fillStyle = tok.text;
      ctx.textAlign = 'left';
      text(sci(r.v, 3), x0 + bw + 8, y + bh / 2, tok.fontSmall);
      geom.push({ x: 0, y: y - 6, w: W, h: bh + 12, row: r, tipX: x0 + 20, tipY: y + bh + 6, tipAbove: y - 6 });
    });
  }

  /** Beside the curve: the bars stand side by side, named under the axis, each value over its bar. */
  function drawStanding(ax) {
    var fs = tok.fontSmall, f = tok.font, line = fs + 3;
    var x0 = 52, x1 = W - 8, y0 = 2 * line + 10, y1 = H - Math.round(f * 1.4) - 12;
    var gapUnits = opts.showIons ? 0.5 : 0, band = (x1 - x0) / (rows.length + gapUnits);
    var bw = Math.min(band * 0.62, f * 4.6);
    function Y(val) { return y1 - Math.min(1, ax.f(val)) * (y1 - y0); }

    ctx.lineWidth = 1;
    ctx.font = fs + 'px ' + tok.family;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ax.ticks.forEach(function (t) {
      var py = Math.round(y1 - t.f * (y1 - y0)) + 0.5;
      ctx.strokeStyle = tok.grid;
      ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
      if (t.label) { ctx.fillStyle = tok.muted; ctx.fillText(t.label, x0 - 6, py); }
    });
    ctx.strokeStyle = tok.axis;
    ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0); ctx.lineTo(x0 + 0.5, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();
    ctx.save();
    ctx.font = f + 'px ' + tok.family;
    ctx.fillStyle = tok.text2;
    ctx.translate(12, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ax.title, 0, 0);
    ctx.restore();

    var shift = 0;
    rows.forEach(function (r, i) {
      if (r.first) {
        shift = gapUnits;
        var dx = Math.round(x0 + band * (i + gapUnits / 2)) + 0.5;
        ctx.lineWidth = 1;
        ctx.strokeStyle = tok.grid;
        ctx.beginPath(); ctx.moveTo(dx, y0 - line); ctx.lineTo(dx, H - 2); ctx.stroke();
      }
      var cx = x0 + band * (i + shift + 0.5), top = Y(r.v), bh = y1 - top;
      if (r.v > 0) { bh = Math.max(bh, 2); top = y1 - bh; }
      if (bh > 0) fillBar(r, cx - bw / 2, top, bw, bh, true);
      // The name under the axis, the value over the bar: mantissa, then the power of ten under it.
      ctx.font = f + 'px ' + tok.family;
      ctx.fillStyle = tok.text2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      text(r.label, cx, y1 + 6, f);
      var val = sci(r.v, 3).split(' × '), vy = top - 4;
      ctx.font = '600 ' + fs + 'px ' + tok.family;
      ctx.fillStyle = tok.text;
      ctx.textBaseline = 'bottom';
      if (val[1]) { text('× ' + val[1], cx, vy, fs, true); vy -= line; }
      text(val[0], cx, vy, fs, true);
      geom.push({ x: cx - band / 2, y: 0, w: band, h: H, row: r, tipX: cx - 20, tipY: y1 + 4, tipAbove: vy - line });
    });
  }

  function setHover(i) {
    if (i === hover) return;
    hover = i;
    if (i < 0) { tip.hidden = true; return; }
    var g = geom[i], r = g.row;
    tip.textContent = '';
    var head = document.createElement('div');
    head.className = 'tip-head';
    head.textContent = r.label + (r.ion ? ' present' : '');
    tip.appendChild(head);
    var l1 = document.createElement('div');
    l1.textContent = sci(r.v, 4) + ' mol · ' + sci(r.v * 1000 / rows.Vtot, 3) + ' M';
    tip.appendChild(l1);
    if (r.frac !== undefined) {
      var l2 = document.createElement('div');
      l2.textContent = (r.frac * 100).toFixed(1) + '% of the titrand';
      tip.appendChild(l2);
    }
    tip.hidden = false;
    var wr = wrap.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    var x = Math.min(wr.width - tr.width - 4, Math.max(0, g.tipX)), y = g.tipY;
    if (y + tr.height > wr.height) y = g.tipAbove - tr.height;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  }

  function onMove(e) {
    var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = -1;
    for (var i = 0; i < geom.length; i++) {
      var g = geom[i];
      if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) { best = i; break; }
    }
    setHover(best);
  }

  function closeTip() {
    if (hover < 0) return false;
    setHover(-1);
    return true;
  }

  root.Bars = {
    init: init, refresh: refresh, layout: layout, set: set, draw: draw, closeTip: closeTip, sci: sci,
    labels: function () { return drawn.slice(); }    // the drawn labels' boxes, for console checks
  };
})(window);
