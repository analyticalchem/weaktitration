/* Titration Curve Explorer: the chemistry. Pure functions, no DOM. Exposes window.Model.
 *
 * One model covers every mode: an n-protic system with acidity constants Ka[0..n-1] (ascending pKa).
 * Species j has lost j protons. z0 is the charge of the fully protonated form: 0 for an acid HnA,
 * +n for a base (NH3 → NH4+; CO3^2- counted from the base as zero, so H2CO3 is +2 relative to it).
 * Charge balance, with everything diluted into the total volume:
 *
 *     sT·Ct' + h + CA'·Σ_j (z0 − j)·α_j(h) − Kw/h = 0
 *
 * sT = +1 for a strong-base titrant (it adds Na+), −1 for a strong acid (it adds Cl−). Σ j·α_j falls
 * as h rises, so the left side is strictly increasing in h and a bisection in log h finds the single
 * root at every volume: the start, every buffer region, every equivalence point and the excess.
 */
(function (root) {
  'use strict';

  var KW = 1e-14, PKW = 14;

  /** α_0..α_n at [H+] = h for acidity constants Ka (ascending pKa). */
  function alphas(h, Ka) {
    var n = Ka.length, t = new Array(n + 1), prod = 1, D = 0, j;
    for (j = 0; j <= n; j++) {
      if (j > 0) prod *= Ka[j - 1];
      t[j] = Math.pow(h, n - j) * prod;
      D += t[j];
    }
    for (j = 0; j <= n; j++) t[j] /= D;
    return t;
  }

  /** [H+] for analytical concentrations CA (titrand) and Ct (titrant), both already diluted. */
  function solveH(CA, Ct, sys) {
    var Ka = sys.Ka, z0 = sys.z0, sT = sys.sT;
    function f(h) {
      var a = alphas(h, Ka), q = 0, j;
      for (j = 0; j < a.length; j++) q += (z0 - j) * a[j];
      return sT * Ct + h + CA * q - KW / h;
    }
    var lo = 1e-17, hi = 1e2, i, mid;
    for (i = 0; i < 140; i++) {
      mid = Math.sqrt(lo * hi);           // the geometric mean: bisection in log space
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    return Math.sqrt(lo * hi);
  }

  /**
   * The system from the page's settings. mode 'acid' or 'base'; n = 1..3 sites; pK = the pKa values
   * (acid) or pKb values (base, first protonation first). For a base the conjugate-acid pKa values,
   * ascending, are 14 − pKb_n … 14 − pKb_1.
   */
  function makeSystem(mode, n, pK) {
    var pKa = mode === 'acid' ? pK.slice(0, n) : pK.slice(0, n).map(function (b) { return PKW - b; }).reverse();
    return {
      mode: mode, n: n, pKa: pKa,
      pKb: mode === 'base' ? pK.slice(0, n) : null,
      Ka: pKa.map(function (v) { return Math.pow(10, -v); }),
      z0: mode === 'acid' ? 0 : n,
      sT: mode === 'acid' ? 1 : -1
    };
  }

  var SUB = ['', '₁', '₂', '₃'], H_ACID = ['', 'H', 'H₂', 'H₃'], CH_NEG = ['', '⁻', '²⁻', '³⁻'], CH_POS = ['', '⁺', '²⁺', '³⁺'];

  /**
   * The titrand's species in display order, starting form first. Each has j (protons removed, its
   * index in the alpha array), a plain label for drawn text and accessible names, and parts for
   * HTML: [{ t: 'H' }, { sub: '2' }, { t: 'A' }, { sup: '−' }].
   */
  function speciesList(sys) {
    var n = sys.n, out = [], j, m;
    if (sys.mode === 'acid') {
      for (j = 0; j <= n; j++) {
        var hs = n - j, parts = [];
        if (hs > 0) { parts.push({ t: 'H' }); if (hs > 1) parts.push({ sub: String(hs) }); }
        parts.push({ t: 'A' });
        if (j > 0) parts.push({ sup: (j > 1 ? String(j) : '') + '−' });
        out.push({ j: j, label: H_ACID[hs] + 'A' + CH_NEG[j], parts: parts });
      }
    } else {
      for (m = 0; m <= n; m++) {
        var p2 = [{ t: 'B' }];
        if (m > 0) { p2.push({ t: 'H' }); if (m > 1) p2.push({ sub: String(m) }); p2.push({ sup: (m > 1 ? String(m) : '') + '+' }); }
        out.push({ j: n - m, label: 'B' + H_ACID[m] + CH_POS[m], parts: p2 });
      }
    }
    return out;
  }

  /** Volume of titrant (mL) to the first equivalence point. */
  function eqVolume1(p) { return p.Ct > 0 ? p.Ca * p.Va / p.Ct : NaN; }

  /**
   * The full state after Vt mL of titrant. p = { Ca, Va, Ct } in M and mL. Moles in mol.
   * nFree is the titrant's own ion actually in solution; nH and nOH are both water ions.
   */
  function state(sys, p, Vt) {
    var Vtot = p.Va + Vt;
    var nA = p.Ca * p.Va / 1000, nT = p.Ct * Vt / 1000;
    var h = solveH(nA * 1000 / Vtot, nT * 1000 / Vtot, sys);   // mmol/mL = M
    var a = alphas(h, sys.Ka), L = Vtot / 1000;
    return {
      Vt: Vt, Vtot: Vtot, h: h, pH: -Math.log10(h), alpha: a,
      moles: a.map(function (x) { return nA * x; }),
      nA: nA, nT: nT,
      nOH: (KW / h) * L, nH: h * L,
      nFree: (sys.mode === 'acid' ? KW / h : h) * L,
      nExcess: Math.max(0, nT - sys.n * nA)
    };
  }

  /** Which part of the curve Vt is on: { kind, k, text }. */
  function region(sys, p, Vt) {
    var V1 = eqVolume1(p), n = sys.n, sp = speciesList(sys), k;
    if (Vt <= 0) return { kind: 'start', text: 'Start: no titrant added yet' };
    for (k = 1; k <= n; k++) {
      var Vk = k * V1;
      if (Math.abs(Vt - Vk) <= 1e-9 + 5e-4 * V1) {
        return { kind: 'eq', k: k, text: n === 1 ? 'Equivalence point' : 'Equivalence point ' + k + ' of ' + n };
      }
      if (Vt < Vk) return { kind: 'buffer', k: k, text: 'Buffer region: ' + sp[k - 1].label + ' / ' + sp[k].label };
    }
    return { kind: 'excess', text: sys.mode === 'acid' ? 'Excess strong base' : 'Excess strong acid' };
  }

  /** The curve from 0 to Vmax mL, densified around every equivalence point. */
  function curve(sys, p, Vmax) {
    var V1 = eqVolume1(p), pts = [], i, k, lo, hi;
    for (i = 0; i <= 900; i++) pts.push(Vmax * i / 900);
    if (isFinite(V1) && V1 > 0) {
      for (k = 1; k <= sys.n; k++) {
        lo = Math.max(0, k * V1 * 0.97); hi = Math.min(Vmax, k * V1 * 1.03);
        for (i = 0; i <= 300; i++) pts.push(lo + (hi - lo) * i / 300);
      }
    }
    pts.sort(function (a, b) { return a - b; });
    return pts.map(function (V) { return { V: V, pH: state(sys, p, V).pH }; });
  }

  /** Literature pK values (25 °C) for the Example menu, by mode and number of sites. */
  var PRESETS = {
    acid: {
      1: [['acetic acid', 4.76], ['formic acid', 3.75], ['lactic acid', 3.86], ['benzoic acid', 4.20], ['hydrofluoric acid', 3.17],
          ['hypochlorous acid', 7.53], ['ammonium ion', 9.25], ['phenol', 9.99]],
      2: [['carbonic acid', 6.35, 10.33], ['oxalic acid', 1.25, 4.14], ['malonic acid', 2.85, 5.70],
          ['sulfurous acid', 1.85, 7.20], ['tartaric acid', 3.04, 4.37], ['glycine, fully protonated', 2.35, 9.78]],
      3: [['phosphoric acid', 2.15, 7.20, 12.35], ['citric acid', 3.13, 4.76, 6.40], ['arsenic acid', 2.24, 6.96, 11.50]]
    },
    base: {
      1: [['ammonia', 4.75], ['methylamine', 3.36], ['Tris', 5.92], ['hydroxylamine', 8.04],
          ['pyridine', 8.77], ['acetate ion', 9.24], ['aniline', 9.40]],
      2: [['carbonate ion', 3.67, 7.65], ['ethylenediamine', 4.07, 7.15], ['piperazine', 4.27, 8.65]],
      3: [['phosphate ion', 1.65, 6.80, 11.85], ['citrate ion', 7.60, 9.24, 10.87]]
    }
  };

  /** The student guide's activities: the set-up each Load button applies. */
  var ACTIVITIES = [
    { id: 1, name: 'Four regions', mode: 'acid', n: 1, pK: [4.76], Ca: 0.1, Va: 25, Ct: 0.1, Vt: 0, preset: 'acetic acid' },
    { id: 2, name: 'What pKa controls', mode: 'acid', n: 1, pK: [4.76], Ca: 0.1, Va: 25, Ct: 0.1, Vt: 12.5, preset: 'acetic acid' },
    { id: 3, name: 'Dilution', mode: 'acid', n: 1, pK: [4.76], Ca: 0.001, Va: 25, Ct: 0.001, Vt: 12.5, preset: 'acetic acid' },
    { id: 4, name: 'Weak base', mode: 'base', n: 1, pK: [4.75], Ca: 0.1, Va: 25, Ct: 0.1, Vt: 0, preset: 'ammonia' },
    { id: 5, name: 'Triprotic acid', mode: 'acid', n: 3, pK: [2.15, 7.20, 12.35], Ca: 0.1, Va: 25, Ct: 0.1, Vt: 0, preset: 'phosphoric acid' },
    { id: 6, name: 'Carbonate', mode: 'base', n: 2, pK: [3.67, 7.65], Ca: 0.1, Va: 25, Ct: 0.1, Vt: 0, preset: 'carbonate ion' },
    { id: 7, name: 'Close pKa values', mode: 'acid', n: 3, pK: [3.13, 4.76, 6.40], Ca: 0.1, Va: 25, Ct: 0.1, Vt: 37.5, preset: 'citric acid' }
  ];

  root.Model = {
    KW: KW, PKW: PKW, SUB: SUB,
    alphas: alphas, solveH: solveH, makeSystem: makeSystem, speciesList: speciesList,
    eqVolume1: eqVolume1, state: state, region: region, curve: curve,
    PRESETS: PRESETS, ACTIVITIES: ACTIVITIES
  };
})(window);
