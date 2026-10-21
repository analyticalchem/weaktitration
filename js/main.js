/* Titration Curve Explorer: wiring. Reads the controls, runs the model, and writes the status line,
 * both visuals, the readouts, both tables and the results page's summary line. Exposes window.app for
 * console checks.
 */
(function (root) {
  'use strict';

  var M = root.Model, P = root.Page, Chart = root.Chart, Bars = root.Bars;
  var NB = P.NB;

  function $(id) { return document.getElementById(id); }

  var ui = {
    mode: 'acid', n: 1, scale: 'linear', showIons: false,
    Ca: 0.1, Va: 25, Ct: 0.1, Vt: 12.5, pK: [4.76, 7.20, 12.35]
  };
  var sys = null, st = null, els = {}, fields = {}, lastStatus = '', lastNow = '';

  // --- species names as HTML (sub and sup elements, never innerHTML) -----------------

  function setSpecies(el, parts) {
    el.textContent = '';
    parts.forEach(function (p) {
      if (p.t !== undefined) el.appendChild(document.createTextNode(p.t));
      else {
        var e = document.createElement(p.sub !== undefined ? 'sub' : 'sup');
        e.textContent = p.sub !== undefined ? p.sub : p.sup;
        el.appendChild(e);
      }
    });
  }

  function ionParts(ion) {
    return ion === 'OH' ? [{ t: 'OH' }, { sup: '−' }] : [{ t: 'H' }, { sub: '3' }, { t: 'O' }, { sup: '+' }];
  }

  // --- number formats ------------------------------------------------------------------

  function fmtConc(v) { return Number(v.toPrecision(3)).toString(); }
  function fmtVol(v) { return Number(v.toPrecision(4)).toString(); }
  function fmtPK(v) { return v.toFixed(2); }
  function fmtMol(v) { return Bars.sci(v, 3) + NB + 'mol'; }

  function fmtV(v) {
    var a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }

  // --- the Example menu ---------------------------------------------------------------

  function fillPresets(selectName) {
    var list = M.PRESETS[ui.mode][ui.n], sel = els.preset;
    sel.textContent = '';
    var custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'custom';
    sel.appendChild(custom);
    list.forEach(function (row) {
      var o = document.createElement('option');
      o.value = row.slice(1).join(',');
      // Names only: the pK boxes beside the menu show the values, and the toolbar stays on one row.
      o.dataset.name = row[0];
      o.textContent = row[0];
      if (row[0] === selectName) o.selected = true;
      sel.appendChild(o);
    });
    if (!selectName) sel.value = '';
  }

  function matchPreset() {
    var list = M.PRESETS[ui.mode][ui.n], k;
    for (k = 0; k < list.length; k++) {
      var ok = true, i;
      for (i = 0; i < ui.n; i++) if (Math.abs(list[k][i + 1] - ui.pK[i]) > 1e-9) ok = false;
      if (ok) { els.preset.value = list[k].slice(1).join(','); return; }
    }
    els.preset.value = '';
  }

  // --- mode and site chips -------------------------------------------------------------

  function syncModeUI() {
    var acid = ui.mode === 'acid', i;
    els.modeChips.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === ui.mode)); });
    els.siteChips.forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.n === ui.n)); });
    $('mode-sub').textContent = acid
      ? 'A weak acid in the flask, titrated with a strong base such as NaOH'
      : 'A weak base in the flask, titrated with a strong acid such as HCl';
    $('sites-sub').textContent = acid
      ? ['', 'One acidic proton (HA)', 'Two acidic protons (H₂A)', 'Three acidic protons (H₃A)'][ui.n]
      : ['', 'Accepts one proton (B → BH⁺)', 'Accepts two protons (B → BH₂²⁺)', 'Accepts three protons (B → BH₃³⁺)'][ui.n];
    $('titrand-title').textContent = acid ? 'Titrand: weak acid' : 'Titrand: weak base';
    $('titrant-title').textContent = acid ? 'Titrant: strong base' : 'Titrant: strong acid';
    for (i = 0; i < 3; i++) {
      // A step the titrand does not have stays in place, switched off, so the toolbar keeps its size.
      var off = i >= ui.n, why = off ? 'Used with ' + (i === 1 ? 'two or three' : 'three') + ' proton sites' : '';
      [$('pk' + (i + 1) + '-num'), $('pk' + (i + 1))].forEach(function (el) {
        el.disabled = off;
        if (off) el.title = why; else el.removeAttribute('title');
      });
      // pKa for a single site; pKa1, pKa2, pKa3 once there is more than one (or the step is switched off).
      var name = (acid ? 'a' : 'b') + (ui.n > 1 || i > 0 ? String(i + 1) : '');
      setPK($('pk' + (i + 1) + '-label'), name);
      setPK($('pk' + (i + 1) + '-num-label'), name);
      $('pk' + (i + 1) + '-sub').textContent = off
        ? why
        : acid
          ? (ui.n > 1 ? 'Step ' + (i + 1) + ' of the acid; values should increase from step to step' : 'Lower values mean a stronger acid; −2 to 16')
          : (ui.n > 1 ? 'Protonation ' + (i + 1) + ' of the base; values should increase from step to step' : 'Lower values mean a stronger base; −2 to 16');
    }
    $('vt-label').textContent = acid ? 'Strong base added' : 'Strong acid added';
    $('vt-num').setAttribute('aria-label', (acid ? 'Strong base added' : 'Strong acid added') + ' in millilitres');
  }

  /** "pKa1" as p, an italic K and a subscript; append keeps what the element already holds. */
  function setPK(el, sub, append) {
    if (!append) el.textContent = '';
    el.appendChild(document.createTextNode('p'));
    var K = document.createElement('i');
    K.textContent = 'K';
    el.appendChild(K);
    var s = document.createElement('sub');
    s.textContent = sub;
    el.appendChild(s);
  }

  // --- the model -----------------------------------------------------------------------

  function compute() {
    sys = M.makeSystem(ui.mode, ui.n, ui.pK);
    st = M.state(sys, ui, ui.Vt);
  }

  function render() {
    compute();
    var V1 = M.eqVolume1(ui), n = ui.n, acid = ui.mode === 'acid', i;

    // The titrant slider spans 0 to (n + 1) equivalence volumes, or further if a larger volume was typed.
    var sMax = Math.max(V1 * (n + 1), ui.Vt, 1);
    if (Math.abs(parseFloat(els.vt.max) - sMax) > 1e-9) {
      els.vt.max = sMax.toFixed(4);
      els.vt.step = (sMax / 2000).toPrecision(2);
      fields.vt.o.max = sMax;
    }
    els.vt.value = Math.min(ui.Vt, sMax);
    // The slider says the pH too, so the curve can be followed by ear as the titrant goes in.
    els.vt.setAttribute('aria-valuetext', fmtVol(ui.Vt) + ' mL, pH ' + st.pH.toFixed(2));
    $('vt-sub').textContent = '0 to ' + fmtVol(sMax) + ' mL; ' + (n === 1 ? '' : 'first ') + 'equivalence at ' + fmtVol(V1) + ' mL';
    P.syncFields();
    for (i = 0; i < 3; i++) $('pk' + (i + 1) + '-out').textContent = i < n ? fmtPK(ui.pK[i]) : '';

    // pK ordering warning.
    var warn = '';
    for (i = 1; i < n; i++) {
      if (ui.pK[i] <= ui.pK[i - 1]) { warn = 'p' + (acid ? 'Ka' : 'Kb') + ' values should increase: step ' + i + ' should be smaller than step ' + (i + 1) + '.'; break; }
    }
    if ($('warn').textContent !== warn) $('warn').textContent = warn;

    // Readouts.
    var reg = M.region(sys, ui, ui.Vt);
    if (reg.text !== lastStatus) { lastStatus = reg.text; $('status').textContent = reg.text; }
    $('r-ph').textContent = st.pH.toFixed(2);
    $('r-ph-sub').textContent = '[H₃O⁺] = ' + Bars.sci(st.h, 3) + NB + 'M at ' + fmtVol(ui.Vt) + NB + 'mL';
    var eqVs = [], eqPH = [];
    for (i = 1; i <= n; i++) { eqVs.push(fmtVol(i * V1)); eqPH.push(M.state(sys, ui, i * V1).pH.toFixed(2)); }
    $('r-veq-label').textContent = n === 1 ? 'Equivalence volume' : 'Equivalence volumes';
    $('r-veq').textContent = eqVs.join(' · ') + NB + 'mL';
    $('r-veq-sub').textContent = 'pH there: ' + eqPH.join(' · ');
    var sp = M.speciesList(sys), dom = sp[0];
    sp.forEach(function (s) { if (st.alpha[s.j] > st.alpha[dom.j]) dom = s; });
    setSpecies($('r-dom'), dom.parts);
    $('r-dom-sub').textContent = (st.alpha[dom.j] * 100).toFixed(1) + '% of the titrand';
    $('r-added').textContent = fmtMol(st.nT);
    $('r-added-sub').textContent = st.nExcess > 0
      ? Bars.sci(st.nExcess, 3) + NB + 'mol beyond the ' + (n === 1 ? '' : 'final ') + 'equivalence point'
      : 'None yet beyond the ' + (n === 1 ? '' : 'final ') + 'equivalence point';
    setSpecies($('r-ion-label'), ionParts(acid ? 'OH' : 'H3O'));
    $('r-ion-label').appendChild(document.createTextNode(' present'));
    $('r-ion').textContent = fmtMol(st.nFree);
    $('r-ion-sub').textContent = 'Free in solution, ' + Bars.sci(st.nFree * 1000 / st.Vtot, 3) + NB + 'M';
    setSpecies($('r-ion2-label'), ionParts(acid ? 'H3O' : 'OH'));
    $('r-ion2-label').appendChild(document.createTextNode(' present'));
    $('r-ion2').textContent = fmtMol(acid ? st.nH : st.nOH);
    $('r-ion2-sub').textContent = 'Free in solution, ' + Bars.sci((acid ? st.nH : st.nOH) * 1000 / st.Vtot, 3) + NB + 'M';

    // Captions, and the visuals' labels, which carry the current point for screen readers. Neither is a
    // live region: they change on every step of the slider.
    $('bars-caption').textContent = 'Moles of each species at ' + fmtVol(ui.Vt) + NB + 'mL';
    $('bars-note').textContent = ui.showIons
      ? 'Each bar is labelled with its species and its amount. Hatched bars are the water ions actually in solution.'
      : 'Each bar is labelled with its species and its amount.';
    var titrant = acid ? 'strong base' : 'strong acid';
    els.curve.setAttribute('aria-label', 'Titration curve: pH against the volume of ' + titrant + ' added, with a dashed line at each equivalence volume. Current point: ' +
      fmtVol(ui.Vt) + ' mL, pH ' + st.pH.toFixed(2) + ', ' + reg.text.charAt(0).toLowerCase() + reg.text.slice(1) + '. The key points are in the Key Points table on the Results page.');
    var said = sp.map(function (s) { return s.label + ' ' + Bars.sci(st.moles[s.j], 3); });
    // The water ions in the order the bars draw them: the titrant's own ion first.
    var ohSaid = 'free OH⁻ ' + Bars.sci(st.nOH, 3), hSaid = 'free H₃O⁺ ' + Bars.sci(st.nH, 3);
    if (ui.showIons) { if (acid) said.push(ohSaid, hSaid); else said.push(hSaid, ohSaid); }
    els.bars.setAttribute('aria-label', 'Bar chart of the moles in the flask at ' + fmtVol(ui.Vt) + ' mL: ' + said.join(', ') +
      ' mol. The same numbers are in the Species in the Flask table on the Results page.');
    $('species-sub').textContent = 'At ' + fmtVol(ui.Vt) + NB + 'mL of ' + titrant + ' added (pH ' + st.pH.toFixed(2) + '): the moles, fraction of the titrand and molarity of each species, the free water ions, and the titrant added.';

    // The results page's line: what is being titrated and where the current point is. A status region,
    // written only when its text changes; it is heard only while the results page is shown.
    var opt = els.preset.options[els.preset.selectedIndex];
    var what = els.preset.value && opt ? opt.dataset.name
      : (acid ? 'weak acid' : 'weak base') + ' with p' + (acid ? 'Ka' : 'Kb') + ' ' + ui.pK.slice(0, n).map(fmtPK).join(', ');
    var now = 'Titrating ' + fmtVol(ui.Va) + ' mL of ' + fmtConc(ui.Ca) + ' M ' + what + ' with ' + fmtConc(ui.Ct) + ' M ' + titrant +
      '. At ' + fmtVol(ui.Vt) + ' mL, pH ' + st.pH.toFixed(2) + '. ' + reg.text + '.';
    if (now !== lastNow) { lastNow = now; $('results-now').textContent = now; }

    // Visuals and tables.
    Chart.set(sys, ui, st);
    Bars.set(sys, st, { scale: ui.scale, showIons: ui.showIons });
    fillTables(V1, sp);
  }

  function cell(tr, text, isHead, parts) {
    var el = document.createElement(isHead ? 'th' : 'td');
    if (isHead) { el.setAttribute('scope', 'row'); el.className = 'text'; }
    if (parts) setSpecies(el, parts); else el.textContent = text;
    tr.appendChild(el);
    return el;
  }

  function fillTables(V1, sp) {
    var n = ui.n, body = $('key-body'), rows = [['Start', 0]], k, acid = ui.mode === 'acid';
    var steps = Chart.steps(), last = steps.length ? Chart.lastVolume() : 0;
    body.textContent = '';
    // The guides' pK level for each step (pKa, or 14 − pKb for a base) and where the curve reaches it.
    var pkName = acid ? 'a' : 'b', lvl = $('kp-pk-head'), cross = $('kp-x-head');
    lvl.textContent = ''; cross.textContent = '';
    if (!acid) lvl.appendChild(document.createTextNode('14 − '));
    setPK(lvl, pkName, true);
    lvl.appendChild(document.createTextNode(' of the step'));
    cross.appendChild(document.createTextNode('Curve reaches pH = ' + (acid ? '' : '14 − ')));
    setPK(cross, pkName, true);
    cross.appendChild(document.createTextNode(' at (mL)'));
    for (k = 1; k <= n; k++) {
      rows.push([n === 1 ? 'Half-equivalence' : 'Half-way to equivalence ' + k, (k - 0.5) * V1, steps[k - 1]]);
      rows.push([n === 1 ? 'Equivalence' : 'Equivalence ' + k, k * V1]);
    }
    rows.push([(n + 1) + ' × the first equivalence volume', (n + 1) * V1]);
    rows.push(['Current point', ui.Vt]);
    rows.forEach(function (r, i) {
      var tr = document.createElement('tr');
      if (i === rows.length - 1) tr.className = 'now';
      cell(tr, r[0], true);
      cell(tr, fmtVol(r[1]));
      cell(tr, M.state(sys, ui, r[1]).pH.toFixed(2));
      var g = r[2];
      cell(tr, g ? fmtPK(g.pK) : '—');
      cell(tr, g ? (g.Vx === null ? 'not by ' + fmtVol(last) : fmtVol(g.Vx)) : '—');
      body.appendChild(tr);
    });

    var sb = $('species-body'), acid = ui.mode === 'acid';
    sb.textContent = '';
    sp.forEach(function (s) {
      var tr = document.createElement('tr');
      cell(tr, '', true, s.parts);
      cell(tr, Bars.sci(st.moles[s.j], 4));
      cell(tr, (st.alpha[s.j] * 100).toFixed(2) + '%');
      cell(tr, Bars.sci(st.moles[s.j] * 1000 / st.Vtot, 3));
      sb.appendChild(tr);
    });
    var ions = acid ? [['OH', st.nOH], ['H3O', st.nH]] : [['H3O', st.nH], ['OH', st.nOH]];
    ions.forEach(function (row, i) {
      var tr = document.createElement('tr');
      if (i === 0) tr.className = 'sep';
      var th = cell(tr, '', true, ionParts(row[0]));
      th.appendChild(document.createTextNode(' present, free'));
      cell(tr, Bars.sci(row[1], 4));
      cell(tr, '—');
      cell(tr, Bars.sci(row[1] * 1000 / st.Vtot, 3));
      sb.appendChild(tr);
    });
    var tr2 = document.createElement('tr');
    var th2 = cell(tr2, '', true, ionParts(acid ? 'OH' : 'H3O'));
    th2.appendChild(document.createTextNode(' added, total'));
    cell(tr2, Bars.sci(st.nT, 4));
    cell(tr2, '—');
    cell(tr2, Bars.sci(st.nT * 1000 / st.Vtot, 3));
    sb.appendChild(tr2);
    var tr3 = document.createElement('tr');
    cell(tr3, 'of which beyond the ' + (n === 1 ? '' : 'final ') + 'equivalence point', true);
    cell(tr3, Bars.sci(st.nExcess, 4));
    cell(tr3, '—');
    cell(tr3, Bars.sci(st.nExcess * 1000 / st.Vtot, 3));
    sb.appendChild(tr3);
  }

  // --- controls ------------------------------------------------------------------------

  function clearActivity() {
    els.activity.value = '';
  }

  function logField(range, num, key, unit) {
    // Concentration sliders run in log10(M); the box shows molarity.
    fields[key] = P.numberField(range, num, {
      toReal: function (s) { return Math.pow(10, s); },
      toSlider: function (v) { return Math.log10(v).toFixed(2); },
      format: fmtConc,
      min: 1e-4, max: 1, unit: unit,
      read: function () { return ui[key]; },
      commit: function (v) { ui[key] = v; range.value = Math.log10(v); clearActivity(); render(); }
    });
    range.addEventListener('input', function () {
      ui[key] = Math.pow(10, +range.value);
      range.setAttribute('aria-valuetext', fmtConc(ui[key]) + ' ' + unit);
      clearActivity();
      render();
    });
    range.setAttribute('aria-valuetext', fmtConc(ui[key]) + ' ' + unit);
  }

  function linField(range, num, key, unit, min, max, format) {
    fields[key] = P.numberField(range, num, {
      toReal: function (s) { return +s; },
      toSlider: function (v) { return v; },
      format: format,
      min: min, max: max, unit: unit,
      read: function () { return get(key); },
      commit: function (v) { put(key, v); range.value = v; clearActivity(); render(); }
    });
    range.addEventListener('input', function () {
      put(key, +range.value);
      range.setAttribute('aria-valuetext', format(get(key)) + (unit ? ' ' + unit : ''));
      clearActivity();
      render();
    });
    range.setAttribute('aria-valuetext', format(get(key)) + (unit ? ' ' + unit : ''));
  }

  function get(key) {
    var m = /^pK(\d)$/.exec(key);
    return m ? ui.pK[+m[1] - 1] : ui[key];
  }
  function put(key, v) {
    var m = /^pK(\d)$/.exec(key);
    if (m) { ui.pK[+m[1] - 1] = v; matchPreset(); } else ui[key] = v;
  }

  function applySetup(s) {
    ui.mode = s.mode; ui.n = s.n;
    s.pK.forEach(function (v, i) { ui.pK[i] = v; });
    ui.Ca = s.Ca; ui.Va = s.Va; ui.Ct = s.Ct; ui.Vt = s.Vt;
    syncModeUI();
    fillPresets(s.preset);
    els.ca.value = Math.log10(ui.Ca);
    els.ct.value = Math.log10(ui.Ct);
    els.va.value = ui.Va;
    [1, 2, 3].forEach(function (i) { $('pk' + i).value = ui.pK[i - 1]; });
    els.ca.setAttribute('aria-valuetext', fmtConc(ui.Ca) + ' M');
    els.ct.setAttribute('aria-valuetext', fmtConc(ui.Ct) + ' M');
    els.va.setAttribute('aria-valuetext', fmtVol(ui.Va) + ' mL');
    [1, 2, 3].forEach(function (i) { $('pk' + i).setAttribute('aria-valuetext', fmtPK(ui.pK[i - 1])); });
    render();
  }

  function loadActivity(id) {
    var a = M.ACTIVITIES[id - 1];
    if (!a) return;
    applySetup(a);
    els.activity.value = String(id);
    var msg = 'Activity ' + id + ' loaded: ' + a.name + '.';
    if ($('load-status').textContent === msg) $('load-status').textContent = '';
    $('load-status').textContent = msg;
  }

  function init() {
    els.preset = $('preset');
    els.modeChips = Array.prototype.slice.call(document.querySelectorAll('#mode-chips .chip'));
    els.siteChips = Array.prototype.slice.call(document.querySelectorAll('#sites-chips .chip'));
    els.scaleChips = Array.prototype.slice.call(document.querySelectorAll('#scale-chips .chip'));
    els.activity = $('activity');
    els.ca = $('ca'); els.va = $('va'); els.ct = $('ct'); els.vt = $('vt');
    els.ions = $('ions');
    els.curve = $('curve'); els.bars = $('bars');

    Chart.init($('curve'), $('curve-tip'), {
      onPick: function (V) {
        ui.Vt = Math.round(V * 1000) / 1000;
        clearActivity();
        render();
      }
    });
    Bars.init($('bars'), $('bars-tip'));

    P.init({
      themeKey: 'titration-curve-explorer-theme',
      refresh: function () { Chart.refresh(); Bars.refresh(); Chart.draw(); Bars.draw(); },
      layout: function () { Chart.layout(); Bars.layout(); Chart.draw(); Bars.draw(); },
      escape: function () { var a = Chart.closeTip(), b = Bars.closeTip(); return a || b; }
    });

    syncModeUI();
    fillPresets('acetic acid');

    logField(els.ca, $('ca-num'), 'Ca', 'M');
    logField(els.ct, $('ct-num'), 'Ct', 'M');
    linField(els.va, $('va-num'), 'Va', 'mL', 1, 100, fmtVol);
    [1, 2, 3].forEach(function (i) { linField($('pk' + i), $('pk' + i + '-num'), 'pK' + i, '', -2, 16, fmtPK); });
    linField(els.vt, $('vt-num'), 'Vt', 'mL', 0, 1e9, fmtVol);
    fields.vt = fields.Vt;

    els.modeChips.forEach(function (b) {
      b.addEventListener('click', function () {
        if (ui.mode === b.dataset.mode) return;
        ui.mode = b.dataset.mode;
        var first = M.PRESETS[ui.mode][ui.n][0];
        first.slice(1).forEach(function (v, i) { ui.pK[i] = v; $('pk' + (i + 1)).value = v; });
        syncModeUI(); fillPresets(first[0]); clearActivity(); render();
      });
    });
    els.siteChips.forEach(function (b) {
      b.addEventListener('click', function () {
        if (ui.n === +b.dataset.n) return;
        ui.n = +b.dataset.n;
        var first = M.PRESETS[ui.mode][ui.n][0];
        first.slice(1).forEach(function (v, i) { ui.pK[i] = v; $('pk' + (i + 1)).value = v; });
        syncModeUI(); fillPresets(first[0]); clearActivity(); render();
      });
    });
    els.preset.addEventListener('change', function () {
      if (!els.preset.value) return;
      els.preset.value.split(',').forEach(function (v, i) { ui.pK[i] = +v; $('pk' + (i + 1)).value = +v; });
      clearActivity();
      render();
    });
    els.scaleChips.forEach(function (b) {
      b.addEventListener('click', function () {
        ui.scale = b.dataset.scale;
        els.scaleChips.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        render();
      });
    });
    els.ions.addEventListener('change', function () { ui.showIons = els.ions.checked; render(); });
    els.activity.addEventListener('change', function () { if (els.activity.value) loadActivity(+els.activity.value); });
    // The student guide's Load buttons set the activity up and go to the instrument page to do it.
    Array.prototype.forEach.call(document.querySelectorAll('.load'), function (b) {
      b.addEventListener('click', function () {
        loadActivity(+b.dataset.act);
        location.hash = 'instrument';
      });
    });

    render();
    P.start();
  }

  init();
  root.app = { ui: ui, state: function () { return st; }, sys: function () { return sys; }, render: render, load: loadActivity };
})(window);
