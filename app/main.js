// Lumen home screen.
//
// Loaded by launcher.html from the newest commit. Reads app/config.json for
// tiles and shelves, and talks to the service bridge on 127.0.0.1:8190 (see
// service/core.js) to list apps, fetch icons and launch.
// Remote: arrows move, OK opens, Back returns to the top row.
(function () {
  'use strict';

  var API = 'http://127.0.0.1:8190';
  var HELPER_ID = 'XDInputApp.XDInput';
  var TV_VIEWER = 'org.tizen.tv-viewer';
  var build = window.XD_BUILD || {};
  var BASE = build.base || '';
  var BUST = build.sha ? '' : '?v=' + Date.now();

  var CFG = null;          // app/config.json
  var TILES = {};          // compiled tile definitions
  var state = { apps: [], resolved: {}, sources: null, row: 0, col: 0, lastCol: {} };

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  }
  function rgb(hex) { var n = parseInt(String(hex).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function toHex(c) { return '#' + c.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(''); }
  function rgba(hex, a) { var c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function shade(hex, t) {
    var c = rgb(hex).map(function (v) { return Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t)); });
    return 'rgb(' + c.join(',') + ')';
  }
  function colorVars(hex) {
    return '--c:' + hex + ';--c-wash:' + rgba(hex, 0.55) + ';--c-glow:' + rgba(hex, 0.45) +
      ';--c-light:' + shade(hex, 0.12) + ';--c-dark:' + shade(hex, -0.3);
  }
  function get(path) {
    return fetch(API + path, { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error ? j.error : 'HTTP ' + r.status); return j; });
    });
  }
  function waitForService(tries) {
    return get('/ping').catch(function (e) {
      if (tries <= 0) throw e;
      return new Promise(function (res) { setTimeout(res, 800); }).then(function () { return waitForService(tries - 1); });
    });
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3200);
  }

  var GLYPHS = {
    hdmi: '<svg viewBox="0 0 96 96" fill="none" stroke="#e8eef5" stroke-width="6" stroke-linejoin="round"><path d="M14 34h68v16l-10 12H24L14 50z"/><path d="M30 46h36" stroke-linecap="round"/></svg>',
    wave: '<svg viewBox="0 0 96 96" fill="none" stroke="#e8eef5" stroke-width="6" stroke-linecap="round"><path d="M10 40c8-8 16-8 24 0s16 8 24 0 16-8 24 0"/><path d="M10 58c8-8 16-8 24 0s16 8 24 0 16-8 24 0" opacity=".6"/></svg>',
    play: '<svg viewBox="0 0 96 96" fill="#fff"><path d="M30 18l50 30-50 30z"/></svg>',
    live: '<svg viewBox="0 0 96 96" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"><circle cx="48" cy="48" r="9" fill="#fff" stroke="none"/><path d="M28 28a28 28 0 0 0 0 40M68 28a28 28 0 0 1 0 40"/><path d="M16 16a45 45 0 0 0 0 64M80 16a45 45 0 0 1 0 64" opacity=".6"/></svg>',
    game: '<svg viewBox="0 0 96 96" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 32h52c8 0 14 8 14 20v6c0 8-8 12-14 6l-8-8H30l-8 8c-6 6-14 2-14-6v-6c0-12 6-20 14-20z"/><path d="M30 44v12M24 50h12"/><circle cx="64" cy="46" r="3" fill="#fff"/><circle cx="72" cy="54" r="3" fill="#fff"/></svg>',
    ticket: '<svg viewBox="0 0 96 96" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"><path d="M14 28h68v12a8 8 0 0 0 0 16v12H14V56a8 8 0 0 0 0-16z"/><path d="M58 30v36" stroke-dasharray="6 6"/></svg>',
    leaf: '<svg viewBox="0 0 96 96" fill="none" stroke="#e8eef5" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M24 72c0-30 18-46 50-50 0 32-16 50-46 50"/><path d="M24 72l26-26"/></svg>',
    pulse: '<svg viewBox="0 0 96 96" fill="none" stroke="#e8eef5" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 50h18l8-20 12 38 10-26 6 8h22"/></svg>',
    grid: '<svg viewBox="0 0 96 96" fill="#e8eef5"><rect x="18" y="18" width="24" height="24" rx="6"/><rect x="54" y="18" width="24" height="24" rx="6"/><rect x="18" y="54" width="24" height="24" rx="6"/><rect x="54" y="54" width="24" height="24" rx="6"/></svg>'
  };

  // ---------------------------------------------------------------- config
  function compile(cfg) {
    Object.keys(cfg.tiles).forEach(function (key) {
      var t = cfg.tiles[key];
      TILES[key] = {
        key: key, label: t.label, kind: t.kind, color: t.color || '#3a4b66', base: t.base || '#0c1726', line: t.line || '', glyph: t.glyph || 'play',
        source: t.source, pinned: !!t.pinned, ids: t.ids || [], iconFrom: t.iconFrom || [],
        names: (t.names || []).map(function (n) { return new RegExp(n, 'i'); }),
        exclude: t.exclude ? new RegExp(t.exclude, 'i') : null
      };
    });
  }
  function minutesOf(hhmm) { var p = String(hhmm || '19:30').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }

  // ---------------------------------------------------------------- apps
  function findApp(t) {
    var apps = state.apps, i, j;
    for (i = 0; i < t.ids.length; i++) for (j = 0; j < apps.length; j++) if (apps[j].id === t.ids[i]) return apps[j];
    for (i = 0; i < t.names.length; i++) {
      var best = null;
      for (j = 0; j < apps.length; j++) {
        var a = apps[j];
        if (!t.names[i].test(a.name || '')) continue;
        if (t.exclude && (t.exclude.test(a.name || '') || t.exclude.test(a.id || ''))) continue;
        if (!best || (a.show && !best.show)) best = a;
      }
      if (best) return best;
    }
    return null;
  }
  function appById(id) { for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === id) return state.apps[i]; return null; }
  function resolveAll() {
    Object.keys(TILES).forEach(function (k) { if (TILES[k].kind === 'app') state.resolved[k] = findApp(TILES[k]); });
  }
  function tizenBrewId() {
    var best = null;
    state.apps.forEach(function (a) {
      if (!/tizenbrew/i.test(a.name || '') || /installer/i.test(a.name || '')) return;
      if (!best || (a.show && !best.show)) best = a;
    });
    return best && /^[A-Za-z0-9_.-]{3,80}$/.test(best.id) ? best.id : null;
  }

  // ---------------------------------------------------------------- usage
  // Favorites learn from what gets opened: count with a gentle 2-week decay.
  function usage() { try { return JSON.parse(store('lumen.usage') || '{}'); } catch (e) { return {}; } }
  function recordUse(key) {
    var u = usage(), now = Date.now();
    var e = u[key] || { n: 0, last: 0 };
    var days = e.last ? (now - e.last) / 864e5 : 0;
    e.n = e.n * Math.pow(0.5, days / 14) + 1;
    e.last = now;
    u[key] = e;
    store('lumen.usage', JSON.stringify(u));
  }
  function favorites(shelf) {
    var u = usage(), now = Date.now();
    var pinned = shelf.from.filter(function (k) { return TILES[k] && TILES[k].pinned; });
    var rest = shelf.from.filter(function (k) { return TILES[k] && !TILES[k].pinned; });
    function score(k) { var e = u[k]; return e ? e.n * Math.pow(0.5, (now - e.last) / 864e5 / 14) : 0; }
    rest.sort(function (a, b) { return score(b) - score(a) || shelf.from.indexOf(a) - shelf.from.indexOf(b); });
    return pinned.concat(rest).slice(0, shelf.max || 6);
  }
  function lastUsed() {
    var u = usage(), best = null;
    Object.keys(u).forEach(function (k) {
      if (!TILES[k] || k === 'tvbox' || k === 'oceanvibes') return; // those two always have Stage buttons
      if (!best || u[k].last > u[best].last) best = k;
    });
    return best ? { key: best, at: u[best].last } : null;
  }

  // ---------------------------------------------------------------- tiles
  // Signature cards: one design for every tile. The app's colour lit over its
  // base, its name in Lumen's typeface, a short line, and a Lumen symbol.
  function cardStyle(t) {
    return colorVars(t.color) + ';--base:' + t.base;
  }
  function cardInner(t) {
    return '<div class="sig-light"></div>' +
      '<div class="sig-glyph">' + (GLYPHS[t.glyph] || GLYPHS.play) + '</div>' +
      '<div class="sig-name">' + esc(t.label) + '</div>' +
      (t.line ? '<div class="sig-line">' + esc(t.line) + '</div>' : '');
  }
  function tileHtml(key, size) {
    var t = TILES[key];
    if (!t) return '';
    var missing = t.kind === 'app' && !state.resolved[key];
    var cls = 'tile focusable size-' + (size || 'normal') + (t.kind === 'soon' ? ' soon' : '') + (missing ? ' missing' : '');
    return '<div class="' + cls + '" data-tile="' + key + '" style="' + cardStyle(t) + '">' +
      '<div class="face sig">' + cardInner(t) + '</div></div>';
  }

  function renderShelves() {
    resolveAll();
    var shown = {};
    $('shelves').innerHTML = CFG.shelves.map(function (sh) {
      var keys = sh.auto ? favorites(sh) : sh.tiles;
      // A shelf can skip tiles that an earlier shelf already shows.
      if (sh.skipShown) keys = keys.filter(function (k) { return !shown[k]; });
      keys.forEach(function (k) { shown[k] = true; });
      if (!keys.length) return '';
      return '<section class="shelf size-' + (sh.size || 'normal') + '" data-shelf="' + sh.id + '">' +
        '<h2>' + esc(sh.title) + '</h2><div class="rail" id="rail-' + sh.id + '">' +
        keys.map(function (k) { return tileHtml(k, sh.size); }).join('') + '</div></section>';
    }).join('');
    rowCache = null;
    focusedEl = null;
    railShift = {};
  }

  // ---------------------------------------------------------------- stage
  // One context-aware moment, picked from the time of day and recent use.
  var stageKey = null;
  function chooseMoment(now) {
    var mins = now.getHours() * 60 + now.getMinutes();
    var bed = minutesOf(CFG.bedtime);
    var lead = bed - mins;
    if (mins >= bed || now.getHours() < 5) {
      return { id: 'winddown', scene: 'tide', kicker: 'Wind-down time', title: 'Ocean Vibes',
        sub: 'Waves on Samsung TV Plus. Lights low, volume down.',
        actions: [['oceanvibes', 'Watch Ocean Vibes', true], ['tvbox', 'Open TV box']] };
    }
    if (lead <= 120) {
      return { id: 'soon', scene: 'tide', kicker: 'Ocean Vibes in ' + countdown(lead), title: 'Ocean Vibes',
        sub: 'Your bedtime channel on Samsung TV Plus starts the wind-down at ' + clock12(bed) + '.',
        actions: [['oceanvibes', 'Watch now', true], ['tvbox', 'Open TV box']] };
    }
    var last = lastUsed();
    if (last && last.key !== 'oceanvibes' && last.key !== 'tvbox' && Date.now() - last.at < 36e5 * 24) {
      var t = TILES[last.key];
      return { id: 'resume', scene: 'art', art: last.key, kicker: 'Pick up where you left off', title: t.label,
        sub: 'Opened ' + ago(last.at) + '.', actions: [[last.key, 'Open ' + t.label, true], ['oceanvibes', 'Ocean Vibes'], ['tvbox', 'TV box']] };
    }
    var box = state.sources && (state.sources.connected || []).some(function (s) { return s.type === 'HDMI' && s.number === 1; });
    if (box) {
      return { id: 'tvbox', scene: 'art', art: 'tvbox', kicker: 'Ready on HDMI 1', title: 'TV box',
        sub: 'Your IPTV box is connected and one press away.', actions: [['tvbox', 'Open TV box', true], ['oceanvibes', 'Ocean Vibes']] };
    }
    return { id: 'tonight', scene: 'tide', kicker: 'Tonight at ' + clock12(bed), title: 'Ocean Vibes',
      sub: 'Your bedtime channel on Samsung TV Plus, ready when you are.',
      actions: [['oceanvibes', 'Watch Ocean Vibes', true], ['tvbox', 'Open TV box']] };
  }
  function countdown(m) { return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'; }
  function clock12(mins) { var h = Math.floor(mins / 60), m = mins % 60; return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m; }
  function ago(t) {
    var m = Math.round((Date.now() - t) / 6e4);
    if (m < 2) return 'just now';
    if (m < 60) return m + ' minutes ago';
    var h = Math.round(m / 60);
    return h === 1 ? 'an hour ago' : h + ' hours ago';
  }

  function renderStage(force) {
    var mo = chooseMoment(new Date());
    var sig = mo.id + '|' + mo.kicker + '|' + (mo.art || '');
    if (!force && sig === stageKey) return;
    stageKey = sig;
    var stage = $('stage');
    stage.className = 'stage scene-is-' + mo.scene;
    $('stageKicker').textContent = mo.kicker;
    $('stageTitle').textContent = mo.title;
    $('stageSub').textContent = mo.sub;
    $('stageActions').innerHTML = mo.actions.map(function (a) {
      return '<button class="btn focusable' + (a[2] ? ' primary' : '') + '" data-tile="' + a[0] + '">' + esc(a[1]) + '</button>';
    }).join('');
    if (mo.scene === 'art') paintArtScene(mo.art);
    rowCache = null;
    if (state.row === 0) { focusedEl = null; applyFocus(false); }
  }

  function paintArtScene(key) {
    var t = TILES[key];
    var stage = $('stage');
    stage.setAttribute('style', cardStyle(t));
    var card = document.querySelector('.art-card');
    card.innerHTML = cardInner(t);
  }

  // ---------------------------------------------------------------- focus
  var rowCache = null, focusedEl = null, railShift = {}, homeShift = 0, wallLight = null, lastGlow = '';
  function rows() {
    if (rowCache) return rowCache;
    var out = [Array.prototype.slice.call(document.querySelectorAll('#stageActions .focusable'))];
    Array.prototype.forEach.call(document.querySelectorAll('.rail'), function (r) {
      out.push(Array.prototype.slice.call(r.querySelectorAll('.focusable')));
    });
    rowCache = out;
    return out;
  }
  function offsetIn(el) {
    var x = 0, y = 0, home = $('home');
    while (el && el !== home && el !== document.body) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    return { x: x, y: y };
  }

  function applyFocus(save) {
    var all = rows();
    if (!all[state.row] || !all[state.row].length) { state.row = 0; state.col = 0; }
    state.col = Math.max(0, Math.min(state.col, all[state.row].length - 1));
    var el = all[state.row][state.col];
    if (!el) return;

    // Read layout first.
    var shift = 0, rail = null, railX = 0;
    if (state.row > 0) {
      shift = Math.max(0, el.closest('.shelf').offsetTop - 230);
      rail = el.parentNode;
      var step = el.offsetWidth + 28;
      var visible = Math.floor((1920 - 160) / step);
      railX = -Math.max(0, state.col - visible + 2) * step;
    }
    var pos = offsetIn(el);
    var face = el.querySelector('.face') || el;
    var cx = pos.x + (rail ? railX : 0) + face.offsetWidth / 2;
    var cy = pos.y - shift + face.offsetHeight / 2;

    // Then write.
    if (focusedEl && focusedEl !== el) focusedEl.classList.remove('focused');
    el.classList.add('focused');
    focusedEl = el;
    if (shift !== homeShift) { $('home').style.transform = 'translateY(' + (-shift) + 'px)'; homeShift = shift; }
    document.body.classList.toggle('browsing', state.row > 0);
    if (rail && railShift[rail.id] !== railX) { rail.style.transform = 'translateX(' + railX + 'px)'; railShift[rail.id] = railX; }

    // The wallpaper's soft light glides to the focused tile, in its colour.
    var key = el.getAttribute('data-tile');
    var color = (TILES[key] && TILES[key].color) || '#9fd3e6';
    if (!wallLight) wallLight = document.querySelector('#wall .focuslight');
    if (wallLight) {
      wallLight.style.transform = 'translate(' + Math.round(cx) + 'px,' + Math.round(cy) + 'px)';
      var glow = rgba(color, 0.30);
      if (glow !== lastGlow) { wallLight.style.background = 'radial-gradient(closest-side, ' + glow + ', transparent)'; lastGlow = glow; }
    }

    state.lastCol[state.row] = state.col;
    if (save !== false) store('xd.focus', state.row + ',' + state.col);
  }

  function move(dx, dy) {
    var all = rows();
    if (dy) {
      var next = state.row + dy;
      while (next >= 0 && next < all.length && !all[next].length) next += dy;
      if (next < 0 || next >= all.length) return;
      state.row = next;
      state.col = state.lastCol[next] != null ? state.lastCol[next] : 0;
    } else {
      var c = state.col + dx;
      if (c < 0 || c >= all[state.row].length) return;
      state.col = c;
    }
    applyFocus();
  }

  // ---------------------------------------------------------------- opening
  function open(key) {
    var t = TILES[key];
    if (!t) return;
    if (t.kind === 'soon') return toast(t.label + ' is coming soon.');
    if (t.kind === 'action') return runAction(key);
    if (t.kind === 'viewer') {
      recordUse(key);
      return get('/launch?id=' + encodeURIComponent(TV_VIEWER)).catch(function () { toast('Live TV did not open. Try again in a moment.'); });
    }
    if (t.kind === 'input') {
      recordUse(key);
      var data = 'source:' + t.source + '|mode:show';
      var tb = tizenBrewId();
      if (tb) data += '|back:' + tb;
      return get('/appcontrol?id=' + encodeURIComponent(HELPER_ID) + '&data=' + encodeURIComponent(data))
        .catch(function () { toast('The TV box needs the input helper. Open Diagnostics to check it.'); });
    }
    var app = state.resolved[key];
    if (!app) return toast(t.label + ' is not installed on this TV.');
    recordUse(key);
    get('/launch?id=' + encodeURIComponent(app.id)).catch(function () { toast(t.label + ' did not open. Try again in a moment.'); });
  }
  function runAction(key) {
    if (key === 'modules') { if (history.length > 1) history.back(); return; }
    if (key === 'diag') openDiagnostics();
  }
  function openDiagnostics() {
    window.XD_MODE = 'diag';
    fetch(BASE + 'diag.html' + BUST).then(function (r) { return r.text(); }).then(function (html) {
      Array.prototype.slice.call(document.querySelectorAll('link[rel=stylesheet]')).forEach(function (l) {
        if (/main\.css/.test(l.href)) l.parentNode.removeChild(l);
      });
      document.body.className = '';
      document.body.removeAttribute('style');
      document.documentElement.removeAttribute('style');
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = BASE + 'diag.css' + BUST;
      document.head.appendChild(css);
      $('root').innerHTML = html;
      var s = document.createElement('script');
      s.src = BASE + 'diag.js' + BUST;
      document.body.appendChild(s);
    }).catch(function () { toast('Diagnostics could not load.'); });
  }

  // ---------------------------------------------------------------- the light through the day
  var PHASES = [
    [0,    '#04060d', '#0a1330', '#0d1b3a', [170, 190, 230, 0.26], '#b3c3ee'],
    [330,  '#0a0b1a', '#1a1b38', '#33284a', [228, 172, 196, 0.28], '#e7aec0'],
    [480,  '#06131f', '#0c2a44', '#103d5a', [170, 222, 240, 0.34], '#9fd3e6'],
    [780,  '#051726', '#0a3149', '#0e4762', [192, 236, 246, 0.38], '#a6e3ee'],
    [1020, '#0c111f', '#272035', '#45303f', [240, 192, 132, 0.34], '#f0bf86'],
    [1170, '#130d1d', '#2a1b32', '#2b3150', [232, 168, 103, 0.40], '#e8a867'],
    [1320, '#060914', '#0f1832', '#132443', [160, 182, 232, 0.28], '#b3c3ee'],
    [1440, '#04060d', '#0a1330', '#0d1b3a', [170, 190, 230, 0.26], '#b3c3ee']
  ];
  var lastVars = {};
  function setVar(name, value) {
    if (lastVars[name] === value) return;
    lastVars[name] = value;
    document.documentElement.style.setProperty(name, value);
  }
  function mixHex(a, b, t) { var x = rgb(a), y = rgb(b); return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); }).join(',') + ')'; }
  function mixRgba(a, b, t) {
    return 'rgba(' + [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }).join(',') + ',' + (a[3] + (b[3] - a[3]) * t).toFixed(3) + ')';
  }
  function applyPhase(d) {
    var mins = d.getHours() * 60 + d.getMinutes();
    var i = 0;
    while (i < PHASES.length - 2 && mins >= PHASES[i + 1][0]) i++;
    var a = PHASES[i], b = PHASES[i + 1];
    var t = (mins - a[0]) / (b[0] - a[0]);
    t = t * t * (3 - 2 * t);
    var sky3 = mixHex(a[3], b[3], t);
    setVar('--sky-1', mixHex(a[1], b[1], t));
    setVar('--sky-2', mixHex(a[2], b[2], t));
    setVar('--sky-3', sky3);
    setVar('--light', mixRgba(a[4], b[4], t));
    setVar('--accent', mixHex(a[5], b[5], t));
    var low = sky3.match(/\d+/g).map(Number);
    setVar('--swell-1', 'rgba(' + low.map(function (v) { return Math.round(v * 1.1); }).join(',') + ',.4)');
    setVar('--swell-2', 'rgba(' + low.map(function (v) { return Math.round(v * .6); }).join(',') + ',.35)');
    var dayT = Math.max(0, Math.min(1, (mins - 360) / 900));
    var nightT = mins >= 1260 ? (mins - 1260) / 540 : mins < 360 ? (mins + 180) / 540 : null;
    var p = nightT == null ? dayT : nightT;
    setVar('--light-x', Math.round(260 + p * 1400) + 'px');
    setVar('--light-y', Math.round(260 - Math.sin(p * Math.PI) * 170) + 'px');
    setVar('--glow-x', Math.round((p - 0.5) * 500) + 'px');
  }

  // ---------------------------------------------------------------- glance
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var lastMinute = -1;
  function tick() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    if (m === lastMinute) return;
    lastMinute = m;
    $('time').textContent = (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
    $('day').textContent = DAYS[d.getDay()];
    applyPhase(d);
    var bed = minutesOf(CFG.bedtime), mins = h * 60 + m;
    var chip = $('chipBedtime');
    var lead = bed - mins;
    if (lead > 0 && lead <= 180) { chip.hidden = false; chip.textContent = 'Ocean Vibes in ' + countdown(lead); }
    else chip.hidden = true;
    document.body.classList.toggle('evening', mins >= bed || h < 5);
    renderStage(false);
  }

  // Weather from Open-Meteo (free, no key) once a city is set in config.json.
  var WX = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
    61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Snow', 73: 'Snow', 75: 'Heavy snow',
    77: 'Snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Storms', 96: 'Storms', 99: 'Storms' };
  function weather() {
    var w = CFG.weather || {};
    if (w.lat == null || w.lon == null) return;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + w.lat + '&longitude=' + w.lon +
      '&current=temperature_2m,weather_code&temperature_unit=' + (w.units === 'fahrenheit' ? 'fahrenheit' : 'celsius');
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var c = j.current || {};
      if (c.temperature_2m == null) return;
      var chip = $('chipWeather');
      chip.hidden = false;
      chip.textContent = Math.round(c.temperature_2m) + '°  ' + (WX[c.weather_code] || '');
    }).catch(function () { /* offline: hide quietly */ });
  }

  // ---------------------------------------------------------------- keys
  document.addEventListener('keydown', function (e) {
    if (window.XD_MODE !== 'home') return;
    switch (e.keyCode) {
      case 37: e.preventDefault(); move(-1, 0); break;
      case 39: e.preventDefault(); move(1, 0); break;
      case 38: e.preventDefault(); move(0, -1); break;
      case 40: e.preventDefault(); move(0, 1); break;
      case 13: {
        e.preventDefault();
        var el = rows()[state.row][state.col];
        if (el) open(el.getAttribute('data-tile'));
        break;
      }
      case 10009: case 8:
        e.preventDefault();
        if (state.row !== 0) { state.row = 0; state.col = state.lastCol[0] || 0; applyFocus(); }
        break;
    }
  });

  // ---------------------------------------------------------------- start
  function start(cfg) {
    CFG = cfg;
    compile(cfg);
    if (cfg.ambience === 'lite') document.body.classList.add('lite');
    window.XD_MODE = 'home';
    document.title = 'Lumen';
    renderShelves();
    tick();
    renderStage(true);
    setInterval(tick, 5000);
    var saved = String(store('xd.focus') || '').split(',');
    if (saved.length === 2) { state.row = parseInt(saved[0], 10) || 0; state.col = parseInt(saved[1], 10) || 0; }
    applyFocus(false);
    weather();
    setInterval(weather, 20 * 6e4);

    waitForService(20)
      .then(function () { return get('/boot?ref=' + encodeURIComponent(build.sha || 'main')); })
      .then(function () { return get('/apps'); })
      .then(function (data) {
        state.apps = data.apps || [];
        renderShelves();
        renderStage(true);
        applyFocus(false);
        return get('/sources').then(function (s) { state.sources = s; renderStage(true); }).catch(function () { /* optional */ });
      })
      .catch(function () { toast('Apps are still loading. Press OK on a tile to try again.'); });
  }

  fetch(BASE + 'config.json' + BUST, { cache: build.sha ? 'default' : 'no-store' })
    .then(function (r) { return r.json(); })
    .then(start)
    .catch(function () { toast('Lumen could not read its settings.'); });
})();
