/* Titration Curve Explorer: page chrome, begun as a copy of the Op Amp Lab page script.
 *
 * Page chrome common to every analyticalchem page: the theme button
 * (auto → light → dark, stored per project), presentation mode (Present button,
 * Alt + Shift + P, ?present=1, Escape, leaving fullscreen), a coalesced layout
 * callback on resize, and number formatting. Exposes window.Page.
 */
(function (root) {
  'use strict';

  var NB = ' ';      // non-breaking space before units
  var MINUS = '−';   // true minus sign

  var opts = {}, themeKey = 'theme';
  var themes = ['auto', 'light', 'dark'];
  var els = {};

  function $(id) { return document.getElementById(id); }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** Fixed decimals, locale grouping, true minus sign, and no "−0.00". */
  function fmt(v, d) {
    if (!isFinite(v)) return '—';
    var s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    if (v < 0 && Number(Math.abs(v).toFixed(d)) !== 0) s = MINUS + s;
    return s;
  }

  /** As fmt, with an explicit + on positive values. */
  function fmtSigned(v, d) {
    var s = fmt(v, d);
    if (v > 0 && Number(v.toFixed(d)) !== 0) s = '+' + s;
    return s;
  }

  var PREFIXES = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

  /**
   * A value with an SI prefix and `sig` significant figures: fmtSI(2.5e-6, 'V') → "2.50 µV".
   * o.trim drops trailing zeros ("10 kΩ"); o.signed adds a + to positive values.
   */
  function fmtSI(v, unit, sig, o) {
    o = o || {};
    sig = sig || 3;
    if (!isFinite(v)) return '—';
    if (v === 0) return '0' + NB + unit;
    var a = Math.abs(v), i;
    for (i = 0; i < PREFIXES.length - 1; i++) if (a >= PREFIXES[i][0]) break;
    var scaled = v / PREFIXES[i][0];
    // Rounding can carry into the next prefix (999.8 µ → 1.00 m).
    if (Math.abs(Number(scaled.toPrecision(sig))) >= 1000 && i > 0) { i--; scaled = v / PREFIXES[i][0]; }
    var mag = Math.floor(Math.log10(Math.abs(Number(scaled.toPrecision(sig)))));
    var d = Math.max(0, sig - 1 - mag);
    var s = o.signed ? fmtSigned(scaled, d) : fmt(scaled, d);
    if (o.trim && s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s + NB + PREFIXES[i][1] + unit;
  }

  /**
   * Set an element's text from a string with simple subscripts, 'v_o = A·v_s' or
   * 'V_{DAC}', built as text nodes and <sub> elements (never innerHTML). A sign
   * subscript (+ or −) gets class "sgn" so it sits a little higher.
   */
  function setRich(el, str) {
    str = String(str);
    if (el._rich === str) return;
    el._rich = str;
    while (el.firstChild) el.removeChild(el.firstChild);
    var re = /_\{([^}]*)\}|_(.)/g, last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) el.appendChild(document.createTextNode(str.slice(last, m.index)));
      var sub = document.createElement('sub'), t = m[1] !== undefined ? m[1] : m[2];
      if (t === '+' || t === MINUS) sub.className = 'sgn';
      sub.textContent = t;
      el.appendChild(sub);
      last = re.lastIndex;
    }
    if (last < str.length) el.appendChild(document.createTextNode(str.slice(last)));
  }

  /** The same string as plain words, for aria-valuetext and titles. */
  function plainText(str) {
    return String(str).replace(/_\{([^}]*)\}|_(.)/g, function (a, g1, g2) {
      var t = g1 !== undefined ? g1 : g2;
      return t === '+' ? ' plus' : (t === MINUS ? ' minus' : t);
    });
  }

  // --- typed values ---------------------------------------------------------------

  var SI_IN = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
  // The prefix group is lazy, so "12.5mL" reads as millilitres, not milli-litres, and "10mM" as millimolar.
var VALUE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([pnuµμmkKMG]??)(?:mL|mmol|mol|M|L|Ω|ohms?|V|A|F|Hz|s|%|×|x|R|bits?)?$/;

  /** Read "4.7k", "12.5 mL", "10 mM", "−2.5" or "1e-4" as a number; NaN if it is not one. */
  function parseValue(text) {
    var s = String(text).trim().replace(/[−–‒]/g, '-').replace(/,/g, '').replace(/\s+/g, '');
    var m = VALUE_RE.exec(s);
    if (!m) return NaN;
    return parseFloat(m[1]) * (m[2] ? SI_IN[m[2]] : 1);
  }

  /** A value for a typing field: plain decimals, or an SI prefix for very large or small values. */
  function fmtEntry(v, o) {
    o = o || {};
    if (!isFinite(v)) return '';
    if (o.decimals !== undefined) return fmt(v, o.decimals).replace(MINUS, '-');
    var s = fmtSI(v, '', o.sig || 3, { trim: true }).replace(NB, '').replace(MINUS, '-');
    return s;
  }

  var fields = [];

  /**
   * Pair a range input with a text field so the value can also be typed.
   * o = { toReal(sliderValue) → value, toSlider(value) → slider value, format(value) → text,
   *       min, max (in value units), unit (for messages),
   *       read() → value and commit(value), both optional, for a page that keeps exact values }
   * Committing (Enter or leaving the field) calls o.commit, or else sets the slider and fires
   * its input event so the page's own slider handler does the rest. Escape abandons an edit.
   */
  function numberField(range, field, o) {
    var f = { range: range, field: field, o: o, msg: document.getElementById(field.getAttribute('aria-describedby') || '') };
    function show() {
      if (f.dirty) return;
      field.value = o.format(o.read ? o.read() : o.toReal(+range.value));
    }
    function say(text) {
      if (f.msg && f.msg.textContent !== text) f.msg.textContent = text;
      if (text) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    function commit() {
      if (!f.dirty) return;
      var v = parseValue(field.value);
      if (!isFinite(v)) {
        say('Type a number from ' + o.format(o.min) + ' to ' + o.format(o.max) + (o.unit ? ' ' + o.unit : '') + '.');
        return;
      }
      var c = Math.max(o.min, Math.min(o.max, v));
      f.dirty = false;
      if (o.commit) {
        o.commit(c);
      } else {
        range.value = o.toSlider(c);
        range.dispatchEvent(new Event('input', { bubbles: true }));
      }
      show();
      // After the slider's own update, which clears old messages.
      say('');
      if (c !== v && f.msg) f.msg.textContent = 'Set to ' + o.format(c) + (o.unit ? ' ' + o.unit : '') + ', the ' + (v > c ? 'largest' : 'smallest') + ' allowed.';
    }
    field.addEventListener('input', function () { f.dirty = true; });
    field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape' && f.dirty) {
        // The first Escape abandons the edit; it does not leave presentation mode.
        e.stopPropagation();
        f.dirty = false;
        say('');
        show();
      }
    });
    field.addEventListener('change', commit);
    range.addEventListener('input', function () { if (!f.dirty) say(''); show(); });
    f.show = show;
    fields.push(f);
    show();
    return f;
  }

  /** Re-read every typing field from its slider (after the page sets sliders itself). */
  function syncFields() {
    fields.forEach(function (f) { f.show(); });
  }

  function prefersReducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function param(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }

  // --- theme -----------------------------------------------------------------

  function refresh() { if (opts.refresh) opts.refresh(); }
  function layout() { if (opts.layout) opts.layout(); }

  function applyTheme(name) {
    if (name === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = name;
    els.theme.textContent = 'Theme: ' + name;
    try { localStorage.setItem(themeKey, name); } catch (e) { /* storage unavailable */ }
    refresh();
  }

  // --- presentation mode -------------------------------------------------------

  function isPresent() { return document.documentElement.hasAttribute('data-present'); }

  function setPresent(on) {
    document.documentElement.toggleAttribute('data-present', on);
    els.present.setAttribute('aria-pressed', String(on));
    els.presentStatus.textContent = on ? 'Presentation mode on. Press Escape to exit.' : 'Presentation mode off.';
    refresh();    // drawing code re-reads the --chart-* tokens and the presentation palette
    layout();     // visuals re-measure their new heights
    if (opts.onPresent) opts.onPresent(on);
    if (on && document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function () { /* refused: the mode still applies */ });
    } else if (!on && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () { /* already left */ });
    }
  }

  // --- layout ------------------------------------------------------------------

  var layoutQueued = false;
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(function () {
      layoutQueued = false;
      layout();
    });
  }

  /**
   * o = { themeKey, refresh(), layout(), escape() → true if it used the key, onPresent(on) }
   */
  function init(o) {
    opts = o || {};
    themeKey = opts.themeKey || 'theme';
    els.theme = $('theme');
    els.present = $('present');
    els.presentStatus = $('present-status');

    // The saved theme was applied by the inline script in <head>; show it on the button.
    els.theme.textContent = 'Theme: ' + (document.documentElement.dataset.theme || 'auto');
    els.theme.addEventListener('click', function () {
      var cur = document.documentElement.dataset.theme || 'auto';
      applyTheme(themes[(themes.indexOf(cur) + 1) % themes.length]);
    });

    els.present.addEventListener('click', function () { setPresent(!isPresent()); });

    document.addEventListener('keydown', function (e) {
      if (e.altKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        setPresent(!isPresent());
        return;
      }
      if (e.key === 'Escape') {
        // A tooltip or a drag takes the first Escape; the next one leaves presentation mode.
        if (opts.escape && opts.escape()) return;
        if (isPresent()) setPresent(false);
      }
    });

    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && isPresent()) setPresent(false);
    });

    if (root.matchMedia) {
      var dark = root.matchMedia('(prefers-color-scheme: dark)');
      if (dark.addEventListener) dark.addEventListener('change', refresh);
    }

    var main = document.querySelector('main');
    if ('ResizeObserver' in root && main) new ResizeObserver(queueLayout).observe(main);
    else root.addEventListener('resize', queueLayout);
  }

  /** Call once the page has drawn, so ?present=1 opens ready to present. */
  function start() {
    if (param('present') === '1') setPresent(true);
  }

  root.Page = {
    NB: NB, MINUS: MINUS,
    init: init, start: start,
    cssVar: cssVar, fmt: fmt, fmtSigned: fmtSigned, fmtSI: fmtSI, setRich: setRich, plainText: plainText,
    parseValue: parseValue, fmtEntry: fmtEntry, numberField: numberField, syncFields: syncFields,
    param: param, prefersReducedMotion: prefersReducedMotion,
    isPresent: isPresent, setPresent: setPresent, queueLayout: queueLayout
  };
})(window);
