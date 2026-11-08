// Lumen home screen.
//
// Loaded by launcher.html from the newest commit. Talks to the service bridge
// on 127.0.0.1:8190 (see service/core.js) to list apps, fetch icons and launch.
// Remote: arrows move, OK opens, Back returns to the top row.
(function () {
  'use strict';

  var API = 'http://127.0.0.1:8190';
  var HELPER_ID = 'XDInputApp.XDInput';
  var TV_VIEWER = 'org.tizen.tv-viewer';
  var BEDTIME = { h: 19, m: 30 }; // Ocean Vibes takes over the hero from here
  var build = window.XD_BUILD || {};

  // ---- What the launcher shows ----
  // kind: app (launch by id/name), viewer (live TV, resumes the TV Plus channel),
  // input (input helper app), soon (placeholder), action (built-in).
  var TILES = {
    tvbox:      { label: 'TV box', kind: 'input', source: 'HDMI1', color: '#3f6fa8', glyph: 'hdmi' },
    netflix:    { label: 'Netflix', kind: 'app', ids: ['org.tizen.netflix-app'], names: [/^netflix$/i], color: '#e50914' },
    disney:     { label: 'Disney+', kind: 'app', names: [/^disney\s*\+?$/i, /disney/i], exclude: /service|preview|widget/i, color: '#1a3fd1' },
    prime:      { label: 'Prime Video', kind: 'app', ids: ['org.tizen.primevideo'], names: [/prime video/i], exclude: /service/i, color: '#00a8e1' },
    crave:      { label: 'Crave', kind: 'app', ids: ['SKvHIMBcln.CraveTV'], names: [/^crave/i], color: '#1f5bff' },
    youtube:    { label: 'YouTube', kind: 'app', ids: ['9Ur5IzDKqV.TizenYouTube'], names: [/^youtube$/i], color: '#ff2a2a' },
    cosmogo:    { label: 'CosmoGO', kind: 'app', ids: ['CDMPWSBGDH.cineplex'], names: [/cosmo/i, /cineplex/i], color: '#6b46d6' },
    tvplus:     { label: 'Samsung TV Plus', kind: 'viewer', iconFrom: ['com.samsung.tv.tvPlusDeeplinker'], color: '#2a9bd6' },
    oceanvibes: { label: 'Ocean Vibes', kind: 'viewer', color: '#2a9bd6' },
    freegames:  { label: 'Free Games', kind: 'app', ids: ['FDLMApISUt.PlayWorks'], names: [/free games/i], color: '#e2559c' },
    grove:      { label: 'Grove Guardians', kind: 'soon', note: 'Coming soon', color: '#3e8e5a', glyph: 'leaf' },
    diag:       { label: 'Diagnostics', kind: 'action', color: '#5b6b82', glyph: 'pulse' },
    modules:    { label: 'TizenBrew modules', kind: 'action', color: '#5b6b82', glyph: 'grid' }
  };
  var RAILS = {
    railWatch: ['tvbox', 'netflix', 'disney', 'prime', 'crave', 'youtube', 'cosmogo', 'tvplus'],
    railPlay: ['freegames', 'grove'],
    railMore: ['diag', 'modules']
  };

  var GLYPHS = {
    hdmi: '<svg viewBox="0 0 96 96" fill="none" stroke="#e8eef5" stroke-width="6" stroke-linejoin="round"><path d="M14 34h68v16l-10 12H24L14 50z"/><path d="M30 46h36" stroke-linecap="round"/></svg>',
    leaf: '<svg viewBox="0 0 96 96" fill="none" stroke="#e8eef5" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M24 72c0-30 18-46 50-50 0 32-16 50-46 50"/><path d="M24 72l26-26"/></svg>',
    pulse: '<svg viewBox="0 0 96 96" fill="none" stroke="#e8eef5" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 50h18l8-20 12 38 10-26 6 8h22"/></svg>',
    grid: '<svg viewBox="0 0 96 96" fill="#e8eef5"><rect x="18" y="18" width="24" height="24" rx="6"/><rect x="54" y="18" width="24" height="24" rx="6"/><rect x="18" y="54" width="24" height="24" rx="6"/><rect x="54" y="54" width="24" height="24" rx="6"/></svg>'
  };

  var state = { apps: [], resolved: {}, row: 0, col: 0, lastCol: {} };
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  }

  // ---- Colour helpers (Tizen 8's engine predates CSS color-mix) ----
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { var c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function shade(hex, t) { // t>0 toward white, t<0 toward black
    var c = rgb(hex).map(function (v) { return Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t)); });
    return 'rgb(' + c.join(',') + ')';
  }
  function colorVars(hex) {
    return '--c:' + hex + ';--c-wash:' + rgba(hex, 0.55) + ';--c-glow:' + rgba(hex, 0.45) +
      ';--c-light:' + shade(hex, 0.12) + ';--c-dark:' + shade(hex, -0.3);
  }

  // ---- Service ----
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

  // ---- Resolve tiles to installed apps ----
  function findApp(t) {
    var apps = state.apps, i, j;
    for (i = 0; t.ids && i < t.ids.length; i++) {
      for (j = 0; j < apps.length; j++) if (apps[j].id === t.ids[i]) return apps[j];
    }
    for (i = 0; t.names && i < t.names.length; i++) {
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
  function appById(id) {
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === id) return state.apps[i];
    return null;
  }
  function tizenBrewId() {
    var best = null;
    state.apps.forEach(function (a) {
      if (!/tizenbrew/i.test(a.name || '') || /installer/i.test(a.name || '')) return;
      if (!best || (a.show && !best.show)) best = a;
    });
    return best && /^[A-Za-z0-9_.-]{3,80}$/.test(best.id) ? best.id : null;
  }

  function iconFor(key) {
    var t = TILES[key];
    if (t.glyph) return '<div class="glyph">' + GLYPHS[t.glyph] + '</div>';
    var app = state.resolved[key];
    if (!app && t.iconFrom) app = appById(t.iconFrom[0]);
    if (app && app.iconPath) {
      return '<img alt="" src="' + API + '/icon?path=' + encodeURIComponent(app.iconPath) + '" ' +
        'onerror="this.outerHTML=\'<div class=mono>' + esc(t.label.charAt(0)) + '</div>\'">';
    }
    return '<div class="mono">' + esc(t.label.charAt(0)) + '</div>';
  }

  function tileHtml(key) {
    var t = TILES[key];
    var missing = t.kind === 'app' && !state.resolved[key];
    var cls = 'tile focusable' + (t.kind === 'soon' ? ' soon' : '') + (missing ? ' missing' : '');
    return '<div class="' + cls + '" data-tile="' + key + '" style="' + colorVars(t.color) + '">' +
      '<div class="face">' + iconFor(key) + '</div>' +
      '<div class="label">' + esc(t.label) + '</div>' +
      (t.note ? '<div class="note">' + esc(t.note) + '</div>' : '') + '</div>';
  }

  function renderRails() {
    Object.keys(RAILS).forEach(function (railId) {
      RAILS[railId].forEach(function (key) {
        if (TILES[key].kind === 'app') state.resolved[key] = findApp(TILES[key]);
      });
      $(railId).innerHTML = RAILS[railId].map(tileHtml).join('');
    });
  }

  // ---- Focus and navigation ----
  function rows() {
    var out = [Array.prototype.slice.call(document.querySelectorAll('.hero-actions .focusable'))];
    ['railWatch', 'railPlay', 'railMore'].forEach(function (id) {
      out.push(Array.prototype.slice.call($(id).querySelectorAll('.focusable')));
    });
    return out;
  }

  function applyFocus(save) {
    var all = rows();
    if (!all[state.row] || !all[state.row].length) { state.row = 0; state.col = 0; }
    state.col = Math.max(0, Math.min(state.col, all[state.row].length - 1));
    document.querySelectorAll('.focused').forEach(function (el) { el.classList.remove('focused'); });
    var el = all[state.row][state.col];
    if (!el) return;
    el.classList.add('focused');

    // Vertical: the hero stays put for the top row, then the shelves slide up.
    var shift = 0;
    if (state.row > 0) {
      var shelf = el.closest('.shelf');
      shift = Math.max(0, shelf.offsetTop - 250);
    }
    $('home').style.transform = 'translateY(' + (-shift) + 'px)';
    document.body.classList.toggle('browsing', state.row > 0);

    // Horizontal: keep the focused tile inside the safe area.
    if (state.row > 0) {
      var rail = el.parentNode;
      var step = el.offsetWidth + 28;
      var visible = Math.floor((1920 - 160) / step);
      var first = Math.max(0, state.col - visible + 2);
      rail.style.transform = 'translateX(' + (-first * step) + 'px)';
    }

    // The wallpaper's soft light glides to the focused tile, in its colour.
    var key = el.getAttribute('data-tile');
    var t = TILES[key];
    document.documentElement.style.setProperty('--focus-c', t ? rgba(t.color, 0.30) : 'var(--light)');
    followLight(el);

    state.lastCol[state.row] = state.col;
    if (save !== false) store('xd.focus', state.row + ',' + state.col);
  }

  // Track the element while the page and rail slide into place.
  var lightTimers = [];
  function followLight(el) {
    lightTimers.forEach(clearTimeout);
    function place() {
      var r = el.getBoundingClientRect();
      var root = document.documentElement.style;
      root.setProperty('--focus-x', Math.round(r.left + r.width / 2) + 'px');
      root.setProperty('--focus-y', Math.round(r.top + r.height / 2) + 'px');
    }
    place();
    lightTimers = [180, 400].map(function (ms) { return setTimeout(place, ms); });
  }

  // ---- Living wallpaper: the light through the day ----
  // Each phase is [minute of day, sky top, sky middle, sky low, light, accent].
  // Everything stays dark; the temperature and brightness of the light change.
  var PHASES = [
    [0,    '#04060d', '#0a1330', '#0d1b3a', [170, 190, 230, 0.26], '#b3c3ee'], // deep night, moonlight
    [330,  '#0a0b1a', '#1a1b38', '#33284a', [228, 172, 196, 0.28], '#e7aec0'], // first light
    [480,  '#06131f', '#0c2a44', '#103d5a', [170, 222, 240, 0.34], '#9fd3e6'], // morning
    [780,  '#051726', '#0a3149', '#0e4762', [192, 236, 246, 0.38], '#a6e3ee'], // midday
    [1020, '#0c111f', '#272035', '#45303f', [240, 192, 132, 0.34], '#f0bf86'], // golden hour
    [1170, '#130d1d', '#2a1b32', '#2b3150', [232, 168, 103, 0.40], '#e8a867'], // bedtime, 7:30
    [1320, '#060914', '#0f1832', '#132443', [160, 182, 232, 0.28], '#b3c3ee'], // night
    [1440, '#04060d', '#0a1330', '#0d1b3a', [170, 190, 230, 0.26], '#b3c3ee']
  ];
  function mixHex(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); }).join(',') + ')';
  }
  function mixRgba(a, b, t) {
    return 'rgba(' + [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }).join(',') + ',' +
      (a[3] + (b[3] - a[3]) * t).toFixed(3) + ')';
  }
  function applyPhase(d) {
    var mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    var i = 0;
    while (i < PHASES.length - 2 && mins >= PHASES[i + 1][0]) i++;
    var a = PHASES[i], b = PHASES[i + 1];
    var t = (mins - a[0]) / (b[0] - a[0]);
    t = t * t * (3 - 2 * t); // ease between phases
    var root = document.documentElement.style;
    var sky3 = mixHex(a[3], b[3], t);
    root.setProperty('--sky-1', mixHex(a[1], b[1], t));
    root.setProperty('--sky-2', mixHex(a[2], b[2], t));
    root.setProperty('--sky-3', sky3);
    root.setProperty('--light', mixRgba(a[4], b[4], t));
    root.setProperty('--accent', mixHex(a[5], b[5], t));
    var low = sky3.match(/\d+/g).map(Number);
    root.setProperty('--swell-1', 'rgba(' + low.map(function (v) { return Math.round(v * 1.1); }).join(',') + ',.55)');
    root.setProperty('--swell-2', 'rgba(' + low.map(function (v) { return Math.round(v * .6); }).join(',') + ',.8)');
    // The light travels across the top like a sun by day and a moon by night.
    var dayT = Math.max(0, Math.min(1, (mins - 360) / (1260 - 360)));     // 6:00 to 21:00
    var nightT = mins >= 1260 ? (mins - 1260) / 540 : mins < 360 ? (mins + 180) / 540 : null;
    var p = nightT == null ? dayT : nightT;
    var x = 260 + p * 1400;
    var y = 260 - Math.sin(p * Math.PI) * 170;
    root.setProperty('--light-x', Math.round(x) + 'px');
    root.setProperty('--light-y', Math.round(y) + 'px');
    root.setProperty('--glow-x', Math.round((p - 0.5) * 500) + 'px');
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

  // ---- Opening things ----
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3200);
  }

  function open(key) {
    var t = TILES[key];
    if (!t) return;
    if (t.kind === 'soon') return toast(t.label + ' is coming soon.');
    if (t.kind === 'action') return runAction(key);
    if (t.kind === 'viewer') {
      return get('/launch?id=' + encodeURIComponent(TV_VIEWER))
        .catch(function () { toast('Live TV did not open. Try again in a moment.'); });
    }
    if (t.kind === 'input') {
      var data = 'source:' + t.source + '|mode:show';
      var tb = tizenBrewId();
      if (tb) data += '|back:' + tb;
      return get('/appcontrol?id=' + encodeURIComponent(HELPER_ID) + '&data=' + encodeURIComponent(data))
        .catch(function () { toast('The TV box needs the input helper. Open Diagnostics to check it.'); });
    }
    var app = state.resolved[key];
    if (!app) return toast(t.label + ' is not installed on this TV.');
    get('/launch?id=' + encodeURIComponent(app.id))
      .catch(function () { toast(t.label + ' did not open. Try again in a moment.'); });
  }

  function runAction(key) {
    if (key === 'modules') { if (history.length > 1) history.back(); return; }
    if (key === 'diag') openDiagnostics();
  }

  // Swap this screen for the diagnostics screen from the same build.
  function openDiagnostics() {
    window.XD_MODE = 'diag';
    var base = build.base || '';
    var bust = build.sha ? '' : '?v=' + Date.now();
    fetch(base + 'diag.html' + bust).then(function (r) { return r.text(); }).then(function (html) {
      Array.prototype.slice.call(document.querySelectorAll('link[rel=stylesheet]')).forEach(function (l) {
        if (/main\.css/.test(l.href)) l.parentNode.removeChild(l);
      });
      document.body.className = '';
      document.body.removeAttribute('style');
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = base + 'diag.css' + bust;
      document.head.appendChild(css);
      $('root').innerHTML = html;
      var s = document.createElement('script');
      s.src = base + 'diag.js' + bust;
      document.body.appendChild(s);
    }).catch(function () { toast('Diagnostics could not load.'); });
  }

  // ---- Clock and evening mode ----
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function tick() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    var h12 = h % 12 || 12;
    $('time').textContent = h12 + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
    $('day').textContent = DAYS[d.getDay()];
    var mins = h * 60 + m, bed = BEDTIME.h * 60 + BEDTIME.m;
    var evening = mins >= bed || h < 5;
    applyPhase(d);
    document.body.classList.toggle('evening', evening);
    $('heroKicker').textContent = evening ? 'Wind-down time' : 'Tonight at ' + (BEDTIME.h % 12 || 12) + ':' + (BEDTIME.m < 10 ? '0' : '') + BEDTIME.m;
    $('heroSub').textContent = evening
      ? 'Waves on Samsung TV Plus. Lights low, volume down.'
      : 'Your bedtime channel on Samsung TV Plus, ready when you are.';
  }

  // ---- Keys ----
  document.addEventListener('keydown', function (e) {
    if (window.XD_MODE === 'diag') return;
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
      case 10009: case 8: // Back: this is home, so just return to the top.
        e.preventDefault();
        if (state.row !== 0) { state.row = 0; state.col = state.lastCol[0] || 0; applyFocus(); }
        break;
    }
  });

  // ---- Start ----
  window.XD_MODE = 'home';
  document.title = 'Lumen';
  tick();
  setInterval(tick, 15000);
  renderRails();
  var saved = String(store('xd.focus') || '').split(',');
  if (saved.length === 2) { state.row = parseInt(saved[0], 10) || 0; state.col = parseInt(saved[1], 10) || 0; }
  applyFocus(false);

  waitForService(20)
    .then(function () { return get('/boot?ref=' + encodeURIComponent(build.sha || 'main')); })
    .then(function () { return get('/apps'); })
    .then(function (data) { state.apps = data.apps || []; renderRails(); applyFocus(false); })
    .catch(function () { toast('Apps are still loading. Press OK on a tile to try again.'); });
})();
