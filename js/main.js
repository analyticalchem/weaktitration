/* Titration Curve Explorer: wiring. Reads the controls, runs the model, and writes the readouts,
 * the status line, both visuals and both tables. Exposes window.app for console checks.
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
  var sys = null, st = null, els = {}, fields = {}, lastStatus = '';

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
      o.textContent = row[0] + ' (' + row.slice(1).join(', ') + ')';
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
    $('titrand-title').textContent = acid ? 'Titrand: Weak Acid' : 'Titrand: Weak Base';
    $('titrant-title').textContent = acid ? 'Titrant: Strong Base' : 'Titrant: Strong Acid';
    for (i = 0; i < 3; i++) {
      var ctl = $('pk' + (i + 1) + '-control');
      ctl.hidden = i >= ui.n;
      var lab = $('pk' + (i + 1) + '-label');
      lab.textContent = '';
      lab.appendChild(document.createTextNode('p'));
      var K = document.createElement('i');
      K.textContent = 'K';
      lab.appendChild(K);
      var sub = document.createElement('sub');
      sub.textContent = (acid ? 'a' : 'b') + (ui.n > 1 ? String(i + 1) : '');
      lab.appendChild(sub);
      $('pk' + (i + 1) + '-num').setAttribute('aria-label', 'p K ' + (acid ? 'a' : 'b') + (ui.n > 1 ? ' ' + (i + 1) : ''));
      $('pk' + (i + 1) + '-sub').textContent = acid
        ? (ui.n > 1 ? 'Step ' + (i + 1) + ' of the acid; values should increase from step to step' : 'Lower values mean a stronger acid; −2 to 16')
        : (ui.n > 1 ? 'Protonation ' + (i + 1) + ' of the base; values should increase from step to step' : 'Lower values mean a stronger base; −2 to 16');
    }
    $('vt-label').textContent = acid ? 'Strong base added' : 'Strong acid added';
    $('vt-num').setAttribute('aria-label', (acid ? 'Strong base added' : 'Strong acid added') + ' in millilitres');
    $('ions-check-text').textContent = 'Show free H₃O⁺ and OH⁻';
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
    els.vt.setAttribute('aria-valuetext', fmtVol(ui.Vt) + ' mL');
    $('vt-sub').textContent = '0 to ' + fmtVol(sMax) + ' mL; the first equivalence point is at ' + fmtVol(V1) + ' mL';
    P.syncFields();

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

    // Captions and labels that name the titrant.
    $('curve-title').textContent = 'Titration Curve';
    $('bars-caption').textContent = 'Moles of each form of the titrand' + (ui.showIons ? ', and of the free OH⁻ and H₃O⁺,' : '') + ' at ' + fmtVol(ui.Vt) + ' mL.';
    $('bars-note').textContent = ui.showIons
      ? 'Hatched bars are the water ions, plain bars the forms of the titrand; each bar is named at its left. The ' + (acid ? 'OH⁻' : 'H₃O⁺') + ' bar is what is actually in solution, not the amount delivered: before equivalence nearly all of it has reacted.'
      : 'Each bar is named at its left. Tick "Show free H₃O⁺ and OH⁻" to add the water ions, which the table lists in any case.';

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
    var n = ui.n, body = $('key-body'), rows = [['Start', 0]], k;
    body.textContent = '';
    for (k = 1; k <= n; k++) {
      rows.push([n === 1 ? 'Half-equivalence' : 'Half-way to equivalence ' + k, (k - 0.5) * V1]);
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
    els.actChips.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
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
    els.actChips.forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.act === id)); });
    var msg = 'Activity ' + id + ' loaded: ' + a.name + '.';
    if ($('load-status').textContent === msg) $('load-status').textContent = '';
    $('load-status').textContent = msg;
  }

  function init() {
    els.preset = $('preset');
    els.modeChips = Array.prototype.slice.call(document.querySelectorAll('#mode-chips .chip'));
    els.siteChips = Array.prototype.slice.call(document.querySelectorAll('#sites-chips .chip'));
    els.scaleChips = Array.prototype.slice.call(document.querySelectorAll('#scale-chips .chip'));
    els.actChips = Array.prototype.slice.call(document.querySelectorAll('#act-chips .chip'));
    els.ca = $('ca'); els.va = $('va'); els.ct = $('ct'); els.vt = $('vt');
    els.ions = $('ions');

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
    els.actChips.forEach(function (b) { b.addEventListener('click', function () { loadActivity(+b.dataset.act); }); });
    Array.prototype.forEach.call(document.querySelectorAll('.load'), function (b) {
      b.addEventListener('click', function () {
        loadActivity(+b.dataset.act);
        document.querySelector('main').scrollIntoView({ behavior: P.prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      });
    });

    render();
    P.start();
  }

  init();
  root.app = { ui: ui, state: function () { return st; }, sys: function () { return sys; }, render: render, load: loadActivity };
})(window);
