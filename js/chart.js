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
  var SUB = ['', '₁', '₂', '₃'];

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
    if (cache.key !== key) cache = { key: key, pts: root.Model.curve(s, p, Vmax) };
    pts = cache.pts;
    geom = { Vmax: Vmax };
    draw();
  }

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

  function draw() {
    if (!ctx || !st) return;
    if (!W && !layout()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tok.surface;
    ctx.fillRect(0, 0, W, H);

    var L = 50, R = W < 420 ? 36 : 46, T = 34, B = 42;
    var x0 = L, x1 = W - R, y0 = T, y1 = H - B, Vmax = geom.Vmax, n = sys.n;
    var V1 = root.Model.eqVolume1(params);
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
    if (isFinite(V1) && V1 > 0) {
      ctx.strokeStyle = tok.text2;
      ctx.lineWidth = 1;
      for (k = 1; k <= n; k++) {
        var Vk = k * V1, Vh = (k - 0.5) * V1;
        var pKh = sys.mode === 'acid' ? sys.pKa[k - 1] : sys.pKa[n - k];
        if (Vk <= Vmax) {
          ctx.setLineDash([7, 5]);
          ctx.beginPath(); ctx.moveTo(X(Vk), y0); ctx.lineTo(X(Vk), y1); ctx.stroke();
        }
        if (Vh <= Vmax) {
          ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(X(Vh), Y(pKh)); ctx.lineTo(X(Vh), y1); ctx.stroke();
          ctx.setLineDash([10, 4, 2, 4]);
          ctx.beginPath(); ctx.moveTo(x0, Y(pKh)); ctx.lineTo(X(Vh), Y(pKh)); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      // Labels parked at the ends of their guides, away from the curve.
      ctx.font = tok.fontSmall + 'px ' + tok.family;
      ctx.fillStyle = tok.text2;
      ctx.textAlign = 'left';
      for (k = 1; k <= n; k++) {
        var Vk2 = k * V1, Vh2 = (k - 0.5) * V1;
        var pKh2 = sys.mode === 'acid' ? sys.pKa[k - 1] : sys.pKa[n - k];
        ctx.textBaseline = 'top';
        if (Vk2 <= Vmax) haloText(n === 1 ? 'Vₑq' : 'V' + SUB[k], X(Vk2) + 5, y0 + 2);
        ctx.textBaseline = 'bottom';
        if (Vh2 <= Vmax) haloText(n === 1 ? '½Vₑq' : (k === 1 ? '½' : (k - 1) + '½') + 'V₁', X(Vh2) + 5, y1 - 5);
        if (pKh2 >= 0.5 && pKh2 <= 13.5) {
          var lbl = sys.mode === 'acid' ? (n === 1 ? 'pH = pKa' : 'pKa' + SUB[k]) : (n === 1 ? '14 − pKb' : '14 − pKb' + SUB[k]);
          haloText(lbl, x0 + 6, Y(pKh2) - 3);
        }
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
      var right = cx > (x0 + x1) / 2;
      ctx.textAlign = right ? 'right' : 'left';
      var ly = Math.min(y1 - 22, Math.max(y0 + 22, cy - tok.marker - 10));
      haloText('pH ' + st.pH.toFixed(2), cx + (right ? -(tok.marker + 7) : tok.marker + 7), ly);
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

  root.Chart = { init: init, refresh: refresh, layout: layout, set: set, draw: draw, closeTip: closeTip };
})(window);
