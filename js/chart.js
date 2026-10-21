/* Titration Curve Explorer: the titration curve, pH against volume of titrant added. One series,
 * guides for the equivalence and half-equivalence volumes and the pH = pKa levels, the current point,
 * and a hover crosshair with a tooltip. Click or drag sets the volume (the slider is the keyboard
 * route). Colours and sizes come from the tokens on every refresh(). Exposes window.Chart.
 */
(function (root) {
  'use strict';

  var canvas, ctx, tip, wrap, W = 0, H = 0, dpr = 1, tok = {};
  var sys = null, params = null, st = null, pts = [], geom = null, hoverV = null, dragging = false, onPick = null;
  var cache = { key: '', pts: [] };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function init(c, t, o) {
    canvas = c;
    tip = t;
    wrap = c.parentElement;
    onPick = o && o.onPick;
    ctx = canvas.getContext('2d');
    refresh();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', function () { if (!dragging) setHover(null); });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', function () { dragging = false; });
    canvas.addEventListener('pointercancel', function () { dragging = false; });
  }

  function refresh() {
    tok = {
      surface: cssVar('--surface'), text: cssVar('--text-primary'), text2: cssVar('--text-secondary'),
      muted: cssVar('--text-muted'), grid: cssVar('--grid'), axis: cssVar('--axis'),
      curve: cssVar('--series-c'),
      font: parseFloat(cssVar('--chart-font')) || 12, fontSmall: parseFloat(cssVar('--chart-font-small')) || 11,
      line: parseFloat(cssVar('--chart-line')) || 2, marker: parseFloat(cssVar('--chart-marker')) || 5,
      halo: parseFloat(cssVar('--chart-halo')) || 4, family: cssVar('--font') || 'system-ui, sans-serif'
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

  /** The system, the conditions and the current state; the curve is resampled only when the conditions change. */
  function set(s, p, state) {
    sys = s; params = p; st = state;
    var V1 = root.Model.eqVolume1(p);
    var Vmax = Math.max(isFinite(V1) ? V1 * (s.n + 1) : 1, state.Vt * 1.08, 0.5);
    var key = [s.mode, s.n, s.pKa.join(','), p.Ca, p.Va, p.Ct, Vmax].join('|');
    if (cache.key !== key) cache = { key: key, pts: root.Model.curve(s, p, Vmax), steps: root.Model.steps(s, p, Vmax) };
    pts = cache.pts;
    geom = { Vmax: Vmax };
    draw();
  }

  /** The guides' positions for the drawn range (Model.steps), and that range's end, for the Key Points table. */
  function steps() { return cache.steps || []; }
  function lastVolume() { return geom ? geom.Vmax : 0; }

  function niceStep(span, target) {
    var raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
  }

  /** Tick and tooltip volumes: whole numbers as they are, otherwise one or two decimals. */
  function fmtV(v) {
    if (!isFinite(v)) return '';
    var a = Math.abs(v);
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  /** Text with a surface-coloured halo, so labels stay legible over the lines. */
  function haloText(text, x, y) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = tok.halo;
    ctx.strokeStyle = tok.surface;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }

  /**
   * A left-aligned guide label with a real subscript ("V" + "eq"), at the chart font with the subscript
   * at the small chart font, so it never shrinks below the drawn-text minimum the way Unicode subscript
   * characters do (there is no subscript q at all).
   */
  function haloSub(base, sub, x, y) {
    ctx.textAlign = 'left';
    ctx.font = tok.font + 'px ' + tok.family;
    haloText(base, x, y);
    var w = ctx.measureText(base).width;
    ctx.font = tok.fontSmall + 'px ' + tok.family;
    haloText(sub, x + w + 1, y + Math.round(tok.font * 0.3));
    w += 1 + ctx.measureText(sub).width;
    ctx.font = tok.font + 'px ' + tok.family;
    // The label's box, so the current point's label can keep clear of it.
    var top = ctx.textBaseline === 'top' ? y : y - tok.font;
    taken.push({ x: x, y: top, w: w, h: tok.font * 1.4 });
  }

  /** The width haloSub would draw. */
  function subWidth(base, sub) {
    ctx.font = tok.font + 'px ' + tok.family;
    var w = ctx.measureText(base).width + 1;
    ctx.font = tok.fontSmall + 'px ' + tok.family;
    w += ctx.measureText(sub).width;
    ctx.font = tok.font + 'px ' + tok.family;
    return w;
  }

  // Boxes of the labels drawn so far; a label placed later takes the first place that overlaps none.
  var taken = [];
  function overlapArea(x, y, w, h) {
    var a = 0;
    for (var i = 0; i < taken.length; i++) {
      var b = taken[i];
      a += Math.max(0, Math.min(x + w, b.x + b.w) - Math.max(x, b.x)) * Math.max(0, Math.min(y + h, b.y + b.h) - Math.max(y, b.y));
    }
    return a;
  }
  /** Of the candidate boxes {x, y}, the first that overlaps nothing, else the one that overlaps least. */
  function place(spots, w, h) {
    var best = null, bestA = Infinity;
    for (var i = 0; i < spots.length; i++) {
      var a = overlapArea(spots[i].x, spots[i].y, w, h);
      if (a === 0) return spots[i];
      if (a < bestA) { bestA = a; best = spots[i]; }
    }
    return best;
  }

  function draw() {
    if (!ctx || !st) return;
    if (!W && !layout()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tok.surface;
    ctx.fillRect(0, 0, W, H);
    taken = [];

    var L = 50, R = W < 420 ? 36 : 46, T = 34, B = 42;
    var x0 = L, x1 = W - R, y0 = T, y1 = H - B, Vmax = geom.Vmax, n = sys.n;
    geom.x0 = x0; geom.x1 = x1; geom.y0 = y0; geom.y1 = y1;
    function X(V) { return x0 + (V / Vmax) * (x1 - x0); }
    function Y(pH) { return y1 - (Math.min(14, Math.max(0, pH)) / 14) * (y1 - y0); }
    var v, px, k;

    // Grid: minor every 1 pH, labelled every 2.
    ctx.lineWidth = 1;
    ctx.font = tok.fontSmall + 'px ' + tok.family;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (v = 0; v <= 14; v++) {
      ctx.strokeStyle = tok.grid;
      ctx.globalAlpha = v % 2 ? 0.5 : 1;
      ctx.beginPath(); ctx.moveTo(x0, Y(v) + 0.5); ctx.lineTo(x1, Y(v) + 0.5); ctx.stroke();
      ctx.globalAlpha = 1;
      if (v % 2 === 0) { ctx.fillStyle = tok.muted; ctx.fillText(String(v), x0 - 8, Y(v)); }
    }
    var step = niceStep(Vmax, Math.max(3, Math.floor((x1 - x0) / 80)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (v = 0; v <= Vmax + 1e-9; v += step) {
      px = Math.round(X(v)) + 0.5;
      ctx.strokeStyle = tok.grid;
      ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
      ctx.fillStyle = tok.muted;
      ctx.fillText(fmtV(v), px, y1 + 7);
    }
    ctx.strokeStyle = tok.axis;
    ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0); ctx.lineTo(x0 + 0.5, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();

    // Axis titles.
    ctx.font = tok.font + 'px ' + tok.family;
    ctx.fillStyle = tok.text2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Volume of ' + (sys.mode === 'acid' ? 'strong base' : 'strong acid') + ' added (mL)', (x0 + x1) / 2, H - 6);
    ctx.save();
    ctx.translate(14, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('pH', 0, 0);
    ctx.restore();

    // Guides: equivalence volumes (dashed), half-equivalence volumes (dotted), pH = pKa levels (dash-dot).
    // The dotted line rises from each half-equivalence volume to the curve, and the dash-dot line runs from
    // the pH axis to where the curve really reaches pH = pKa (across the whole chart if it never does), so
    // both always end on the curve. Where the half-equivalence shortcut holds they meet there at one
    // point; where it fails (a pKa near 2 or 12, or steps that overlap) they reach the curve apart.
    var guides = cache.steps || [];
    if (guides.length) {
      ctx.strokeStyle = tok.text2;
      ctx.lineWidth = 1;
      guides.forEach(function (g) {
        if (g.Vk <= Vmax) {
          ctx.setLineDash([7, 5]);
          ctx.beginPath(); ctx.moveTo(X(g.Vk), y0); ctx.lineTo(X(g.Vk), y1); ctx.stroke();
        }
        if (g.Vh <= Vmax) {
          ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(X(g.Vh), Y(g.pHh)); ctx.lineTo(X(g.Vh), y1); ctx.stroke();
          ctx.setLineDash([10, 4, 2, 4]);
          ctx.beginPath(); ctx.moveTo(x0, Y(g.pK)); ctx.lineTo(g.Vx === null ? x1 : X(g.Vx), Y(g.pK)); ctx.stroke();
        }
      });
      ctx.setLineDash([]);
      // Labels parked at the ends of their guides, away from the curve: the volume guides' labels at the
      // top and bottom, then each pH = pKa level's label at the left, above its line or, where that place
      // is taken, below it.
      ctx.fillStyle = tok.text2;
      var drop = Math.round(tok.font * 0.3), gh = tok.font * 1.4;
      guides.forEach(function (g) {
        ctx.textBaseline = 'top';
        if (g.Vk <= Vmax) haloSub('V', n === 1 ? 'eq' : String(g.k), X(g.Vk) + 5, y0 + 2);
        ctx.textBaseline = 'bottom';
        if (g.Vh <= Vmax) haloSub((g.k === 1 ? '' : (g.k - 1)) + '½V', n === 1 ? 'eq' : '1', X(g.Vh) + 5, y1 - 5 - drop);
      });
      for (k = 1; k <= guides.length; k++) {
        var pKh2 = guides[k - 1].pK;
        if (pKh2 < 0.5 || pKh2 > 13.5) continue;
        // For a base the k-th step from the start is its k-th protonation, pH = 14 − pKb(k).
        var base = sys.mode === 'acid' ? (n === 1 ? 'pH = pK' : 'pK') : '14 − pK';
        var sub = (sys.mode === 'acid' ? 'a' : 'b') + (n === 1 ? '' : String(k));
        var lw2 = subWidth(base, sub), ly0 = Y(pKh2);
        // Box tops: just above the line, just below it, then a little further out each way; at the left
        // end of the line first, then one label's width along it, where pK values close together crowd.
        var tops = [ly0 - 3 - drop - tok.font, ly0 + 3, ly0 - 3 - drop - tok.font - gh / 2, ly0 + 3 + gh / 2], spotsK = [];
        [x0 + 6, x0 + 16 + lw2].forEach(function (lx) { tops.forEach(function (t) { spotsK.push({ x: lx, y: t }); }); });
        var at = place(spotsK, lw2, gh);
        ctx.textBaseline = 'top';
        haloSub(base, sub, at.x, at.y);
      }
    }

    // The curve.
    ctx.strokeStyle = tok.curve;
    ctx.lineWidth = tok.line;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i) ctx.lineTo(X(pts[i].V), Y(pts[i].pH)); else ctx.moveTo(X(pts[i].V), Y(pts[i].pH));
    }
    ctx.stroke();

    // Hover crosshair.
    if (hoverV !== null && hoverV >= 0 && hoverV <= Vmax) {
      var hs = root.Model.state(sys, params, hoverV);
      ctx.strokeStyle = tok.text2;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(X(hoverV), y0); ctx.lineTo(X(hoverV), y1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tok.text2;
      ctx.beginPath(); ctx.arc(X(hoverV), Y(hs.pH), Math.max(3, tok.marker - 1), 0, 2 * Math.PI); ctx.fill();
    }

    // The current point: a surface ring under a filled marker, with its pH beside it.
    if (st.Vt <= Vmax) {
      var cx = X(st.Vt), cy = Y(st.pH);
      ctx.strokeStyle = tok.axis;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, y1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tok.surface;
      ctx.beginPath(); ctx.arc(cx, cy, tok.marker + 2, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = tok.curve;
      ctx.beginPath(); ctx.arc(cx, cy, tok.marker, 0, 2 * Math.PI); ctx.fill();
      ctx.font = '600 ' + tok.font + 'px ' + tok.family;
      ctx.fillStyle = tok.text;
      ctx.textBaseline = 'middle';
      // Just above the point on the side towards the middle, else just below it, then a line further out
      // each way, then the other side: the first place no guide's label already holds.
      var label = 'pH ' + st.pH.toFixed(2), lw = ctx.measureText(label).width, lh = tok.font + 4;
      var inward = cx > (x0 + x1) / 2 ? -1 : 1, spots = [], best;
      var up = cy - tok.marker - 10, down = cy + tok.marker + 12;
      [inward, -inward].forEach(function (side) {
        [up, down, up - lh, down + lh, up - 2 * lh, down + 2 * lh, up - 3 * lh].forEach(function (y) {
          var bx = side > 0 ? cx + tok.marker + 7 : cx - tok.marker - 7 - lw;
          if (bx < x0 + 2 || bx + lw > x1 - 2) return;
          spots.push({ x: bx, y: Math.min(y1 - 22, Math.max(y0 + 22, y)) - lh / 2 });
        });
      });
      // Near the start, the pK labels stand in a column at the left edge: try just to its right too.
      var col = x0;
      taken.forEach(function (b) { if (b.x <= x0 + 6) col = Math.max(col, b.x + b.w); });
      if (col + 8 + lw <= x1 - 2 && col + 8 > cx) {
        [up, down, up - lh, down + lh].forEach(function (y) { spots.push({ x: col + 8, y: Math.min(y1 - 22, Math.max(y0 + 22, y)) - lh / 2 }); });
      }
      best = place(spots, lw, lh) || { x: cx + tok.marker + 7, y: cy - tok.marker - 10 - lh / 2 };
      ctx.textAlign = 'left';
      haloText(label, best.x, best.y + lh / 2);
      taken.push({ x: best.x, y: best.y, w: lw, h: lh, point: true });
    }
  }

  // --- pointer -------------------------------------------------------------------

  function vFromEvent(e) {
    if (!geom || !geom.x1) return null;
    var r = canvas.getBoundingClientRect(), x = e.clientX - r.left;
    return Math.min(geom.Vmax, Math.max(0, (x - geom.x0) / (geom.x1 - geom.x0) * geom.Vmax));
  }

  function setHover(V, e) {
    hoverV = V;
    draw();
    if (V === null) { tip.hidden = true; return; }
    var hs = root.Model.state(sys, params, V), reg = root.Model.region(sys, params, V);
    tip.textContent = '';
    var head = document.createElement('div');
    head.className = 'tip-head';
    head.textContent = fmtV(V) + ' mL · pH ' + hs.pH.toFixed(2);
    var body = document.createElement('div');
    body.textContent = reg.text;
    tip.appendChild(head);
    tip.appendChild(body);
    tip.hidden = false;
    if (e) {
      var wr = wrap.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      var x = e.clientX - wr.left + 14, y = e.clientY - wr.top - tr.height - 10;
      if (x + tr.width > wr.width) x = e.clientX - wr.left - tr.width - 14;
      if (y < 0) y = e.clientY - wr.top + 14;
      tip.style.left = Math.max(0, x) + 'px';
      tip.style.top = y + 'px';
    }
  }

  function onMove(e) {
    var V = vFromEvent(e);
    if (V === null) return;
    if (dragging && onPick) onPick(V);
    setHover(V, e);
  }

  function onDown(e) {
    var V = vFromEvent(e);
    if (V === null) return;
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
    if (onPick) onPick(V);
    setHover(V, e);
  }

  /** Close the tooltip; true when there was one to close. */
  function closeTip() {
    if (hoverV === null) return false;
    setHover(null);
    return true;
  }

  root.Chart = {
    init: init, refresh: refresh, layout: layout, set: set, draw: draw, closeTip: closeTip,
    steps: steps, lastVolume: lastVolume,
    labels: function () { return taken.slice(); }    // the drawn labels' boxes, for console checks
  };
})(window);
