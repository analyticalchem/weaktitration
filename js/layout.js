/* Titration Curve Explorer: how the page is arranged. Shows the instrument page or the results page
   (#instrument, #results, so Back and Forward work), switches the one-screen arrangement on when the window
   is large enough, runs the Settings drop-down and the results tabs (WAI-ARIA tabs pattern, automatic
   activation), and lays the charts out again when their space changes. Both pages are one document: the
   model and every readout keep up with the titration whichever page is shown. Begun as a copy of the FTIR
   Interferometer Explorer's layout script. */
(function (root) {
  'use strict';

  var html = document.documentElement;
  function $(id) { return document.getElementById(id); }

  // --- one screen ---

  function presenting() { return html.hasAttribute('data-present'); }
  // One screen needs the window to be large enough, and the curve to come out at least MIN_W × MIN_H px,
  // the size below which its tick labels and guide labels would crowd. If a window passes the first test
  // but fails the second (larger text settings, say), the page stacks and stays stacked until the window
  // grows.
  var MIN_W = 440, MIN_H = 240, tooSmall = null;
  function fits() {
    var w = root.innerWidth, h = root.innerHeight, p = presenting();
    if (tooSmall && tooSmall.p === p && w <= tooSmall.w && h <= tooSmall.h) return false;
    return p ? w >= 1280 && h >= 720 : w >= 1100 && h >= 680;
  }
  function oneScreen() { return html.classList.contains('one-screen'); }

  var curveBox = document.querySelector('.curve-wrap');
  function curveSmall() { return curveBox.clientWidth < MIN_W || curveBox.clientHeight < MIN_H; }

  // A curve too small for its labels is measured again after a pause, twice, a second apart, each time in
  // a drawn frame; only if it is too small both times does the page stack. A reading taken while the page
  // is still settling (as it loads, or mid-resize) never decides it.
  var checkTimer = 0, smallCount = 0;
  function queueCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () { requestAnimationFrame(checkSize); }, smallCount ? 1000 : 500);
  }
  function checkSize() {
    if (!oneScreen() || !curveBox.clientWidth || !curveSmall()) { smallCount = 0; return; }
    if (++smallCount < 2) { queueCheck(); return; }
    smallCount = 0;
    tooSmall = { p: presenting(), w: root.innerWidth, h: root.innerHeight };
    html.classList.remove('one-screen');
    Page.queueLayout();
  }

  html.classList.toggle('one-screen', fits());
  function update() {
    var on = fits();
    if (on !== oneScreen()) html.classList.toggle('one-screen', on);
    if (oneScreen() && curveBox.clientWidth && curveSmall()) queueCheck();
    Page.queueLayout();
  }
  root.addEventListener('resize', update);
  new MutationObserver(update).observe(html, { attributes: true, attributeFilter: ['data-present'] });

  // --- the Settings drop-down ---

  var settings = $('settings');
  // Escape closes it first (before a tooltip or presentation mode, but not while it is abandoning an edit
  // in a typing box), and focus goes back to its button; a click or tap anywhere outside it closes it.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !settings.open) return;
    if (e.target.dataset && e.target.dataset.dirty) return;
    e.stopPropagation();
    e.preventDefault();
    settings.open = false;
    settings.querySelector('summary').focus();
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (settings.open && !settings.contains(e.target)) settings.open = false;
  });

  // --- tabs ---

  var tabs = [].slice.call(document.querySelectorAll('[role="tab"]'));
  function selectedTab() { return document.querySelector('[role="tab"][aria-selected="true"]'); }

  function select(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    Page.queueLayout();
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(t, false); });
    t.addEventListener('keydown', function (e) {
      var j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      select(tabs[j], true);
    });
  });

  // --- the two pages ---

  var pages = { instrument: $('page-instrument'), results: $('page-results') };
  var navs = { instrument: $('nav-instrument'), results: $('nav-results') };
  var baseTitle = document.title, current = null;

  function pageFromHash() { return location.hash === '#results' ? 'results' : 'instrument'; }

  /** Show one page. Focus goes to the start of the page that opens (the open tab on the results page, the
      chosen titrand on the instrument page), so keyboard and screen-reader users land where it begins. */
  function show(name, focus) {
    if (name === current) return;
    current = name;
    Object.keys(pages).forEach(function (k) {
      pages[k].hidden = k !== name;
      if (k === name) navs[k].setAttribute('aria-current', 'page');
      else navs[k].removeAttribute('aria-current');
    });
    document.title = name === 'results' ? 'Results · ' + baseTitle : baseTitle;
    root.scrollTo(0, 0);
    if (focus) {
      (name === 'results' ? selectedTab() : document.querySelector('#page-instrument .chip[aria-pressed="true"]')).focus();
    }
    update();
  }

  // The links change the address; the page follows it, so Back and Forward move between the pages too.
  root.addEventListener('hashchange', function () { show(pageFromHash(), true); });

  // The page re-measures when <main> changes size (page.js); the charts' own boxes change size too (a page
  // opens, the number of bars changes), so watch them as well.
  show(pageFromHash(), false);
  if ('ResizeObserver' in root) {
    var ro = new ResizeObserver(update);
    ro.observe(html);
    document.querySelectorAll('.curve-wrap, .bars-wrap').forEach(function (el) { ro.observe(el); });
  }

  root.Layout = { oneScreen: oneScreen, show: show };
})(window);
