/* Titration Curve Explorer: the species bars. Moles of each form of the titrand (plain bars, one
 * series colour each, named at the left) and, when shown, the free OH⁻ and H₃O⁺ (hatched bars below
 * a divider). Linear or log axis. Every bar carries its value as drawn text and the same numbers are
 * in the species table. Exposes window.Bars.
 */
(function (root) {
  'use strict';

  var canvas, ctx, tip, wrap, W = 0, H = 0, dpr = 1, tok = {};
  var rows = [], geom = [], hover = -1, opts = { scale: 'linear', showIons: false };
  var BAND = 34, GAP = 12, TOP = 8, BOTTOM = 38;
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
      family: cssVar('--font') || 'system-ui, sans-serif'
    };
  }

  function layout() {
    if (!canvas) return false;
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
    // The wrapper's height follows the number of bars; presentation mode scales it by 1.5.
    wrap.style.setProperty('--h', (TOP + BAND * rows.length + (opts.showIons ? GAP : 0) + BOTTOM) + 'px');
    layout();
    draw();
  }

  function niceTicks(max, target) {
    if (!(max > 0)) return { step: 1, max: 1 };
    var raw = max / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
    return { step: step, max: Math.ceil(max / step - 1e-9) * step };
  }

  function roundBar(x, y, w, h) {
    var r = Math.min(4, w);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  function draw() {
    if (!ctx || !rows.length) return;
    if (!W && !layout()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tok.surface;
    ctx.fillRect(0, 0, W, H);
    // The chart's share of the wrapper: the wrapper may be taller when presenting.
    var L = W < 420 ? 76 : 100, R = W < 420 ? 84 : 104, x0 = L, x1 = W - R, y0 = TOP, y1 = H - BOTTOM;
    var band = (y1 - y0 - (opts.showIons ? GAP : 0)) / rows.length;
    var X, axisTitle, v, px, e;

    ctx.lineWidth = 1;
    ctx.font = tok.fontSmall + 'px ' + tok.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (opts.scale === 'log') {
      // One decade per gridline; the floor sits two decades under the smallest non-zero bar so the
      // ~10⁻¹¹ mol of free OH⁻ in a buffer is a visible length, not a stub.
      var pos = rows.filter(function (r) { return r.v > 0; }).map(function (r) { return r.v; });
      var eMax = Math.ceil(Math.log10(Math.max.apply(null, pos.concat([1e-12]))) + 0.05);
      var eMin = Math.floor(Math.log10(Math.min.apply(null, pos.concat([1])))) - 2;
      eMin = Math.max(eMin, eMax - 16, -18);
      eMin = Math.min(eMin, eMax - 2);
      X = function (val) { return val <= 0 ? x0 : x0 + ((Math.log10(val) - eMin) / (eMax - eMin)) * (x1 - x0); };
      var every = eMax - eMin > 8 ? 2 : 1;
      for (e = eMin; e <= eMax; e++) {
        px = Math.round(X(Math.pow(10, e))) + 0.5;
        ctx.strokeStyle = tok.grid;
        ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
        if ((e - eMin) % every === 0) { ctx.fillStyle = tok.muted; ctx.fillText('10' + sup(e), px, y1 + 7); }
      }
      axisTitle = 'Moles (log scale)';
    } else {
      // A shared power of ten keeps the tick labels short.
      var vmax = Math.max(rows.nA, opts.showIons ? Math.max.apply(null, rows.map(function (r) { return r.v; })) : 0, 1e-12) * 1.08;
      e = Math.floor(Math.log10(vmax));
      var scale = Math.pow(10, e), t = niceTicks(vmax / scale, 4);
      X = function (val) { return x0 + (val / (t.max * scale)) * (x1 - x0); };
      for (v = 0; v <= t.max + 1e-9; v += t.step) {
        px = Math.round(X(v * scale)) + 0.5;
        ctx.strokeStyle = tok.grid;
        ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
        ctx.fillStyle = tok.muted;
        ctx.fillText(String(Math.round(v * 100) / 100), px, y1 + 7);
      }
      axisTitle = e === 0 ? 'Moles' : 'Moles (× 10' + sup(e) + ')';
    }
    ctx.strokeStyle = tok.axis;
    ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0); ctx.lineTo(x0 + 0.5, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();
    ctx.font = tok.font + 'px ' + tok.family;
    ctx.fillStyle = tok.text2;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(axisTitle, (x0 + x1) / 2, H - 4);

    var bh = Math.min(22, band - 8), gapAt = -1;
    geom = [];
    rows.forEach(function (r, i) {
      if (r.first) gapAt = i;
      var y = y0 + band * i + (band - bh) / 2 + (gapAt >= 0 && i >= gapAt ? GAP : 0);
      if (r.first) {
        ctx.strokeStyle = tok.grid;
        ctx.beginPath(); ctx.moveTo(0, y - GAP / 2 - 4 + 0.5); ctx.lineTo(W, y - GAP / 2 - 4 + 0.5); ctx.stroke();
      }
      var bw = Math.max(0, X(r.v) - x0);
      if (r.v > 0) bw = Math.max(bw, 2);
      if (bw > 0) {
        roundBar(x0 + 1, y, bw, bh);
        ctx.fillStyle = r.color;
        ctx.fill();
        if (r.ion) {
          // Hatched: the water ions differ from the titrand's forms by pattern as well as colour.
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = tok.surface;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (var s = -bh; s < bw + bh; s += 6) {
            ctx.moveTo(x0 + 1 + s, y + bh);
            ctx.lineTo(x0 + 1 + s + bh, y);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.font = tok.font + 'px ' + tok.family;
      ctx.fillStyle = tok.text2;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.label, x0 - 10, y + bh / 2);
      ctx.font = '600 ' + tok.fontSmall + 'px ' + tok.family;
      ctx.fillStyle = tok.text;
      ctx.textAlign = 'left';
      ctx.fillText(sci(r.v, 3), x0 + bw + 8, y + bh / 2);
      ctx.lineWidth = 1;
      geom.push({ y: y, h: bh, row: r });
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
    var x = Math.min(wr.width - tr.width - 4, (W < 420 ? 76 : 100) + 20), y = g.y + g.h + 6;
    if (y + tr.height > wr.height) y = g.y - tr.height - 6;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  }

  function onMove(e) {
    var r = canvas.getBoundingClientRect(), y = e.clientY - r.top, best = -1;
    for (var i = 0; i < geom.length; i++) {
      if (y >= geom[i].y - 6 && y <= geom[i].y + geom[i].h + 6) { best = i; break; }
    }
    setHover(best);
  }

  function closeTip() {
    if (hover < 0) return false;
    setHover(-1);
    return true;
  }

  root.Bars = { init: init, refresh: refresh, layout: layout, set: set, draw: draw, closeTip: closeTip, sci: sci };
})(window);
