(function () {
  'use strict';
  var API = 'http://127.0.0.1:8190';

  // What the real launcher needs. Matched by name, case-insensitive.
  var TARGETS = [
    { label: 'Samsung TV Plus', match: ['tv plus', 'tvplus'] },
    { label: 'TELUS box (HDMI input)', match: ['tv viewer', 'tv-viewer', 'source', 'input', 'hdmi', 'external'], ids: ['org.tizen.tv-viewer'] },
    { label: 'Netflix', match: ['netflix'] },
    { label: 'Disney+', match: ['disney'] },
    { label: 'Prime Video', match: ['prime video', 'amazon'] },
    { label: 'Crave', match: ['crave'] },
    { label: 'YouTube', match: ['youtube'] },
    { label: 'CosmoGO', match: ['cosmo', 'cineplex'] },
    { label: 'Free Games', match: ['free games', 'freegames'] }
  ];

  var state = { apps: [], sources: null, showHidden: false, focus: 0 };
  var $ = function (id) { return document.getElementById(id); };

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.className = ''; }, 3200);
  }

  function setStatus(kind, html) {
    $('status').innerHTML = '<span class="dot ' + kind + '"></span>' + html;
  }

  function get(path) {
    return fetch(API + path, { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : 'HTTP ' + r.status);
        return j;
      });
    });
  }

  // The service can take a few seconds to start after the module opens.
  function waitForService(tries) {
    return get('/ping').catch(function (e) {
      if (tries <= 0) throw e;
      return new Promise(function (res) { setTimeout(res, 1000); }).then(function () { return waitForService(tries - 1); });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function iconHtml(app) {
    if (app && app.iconPath) {
      return '<img src="' + API + '/icon?path=' + encodeURIComponent(app.iconPath) + '" alt="" onerror="this.outerHTML=\'<div class=ph>' +
        esc((app.name || '?').charAt(0)) + '</div>\'">';
    }
    return '<div class="ph">' + esc(((app && app.name) || '?').charAt(0)) + '</div>';
  }

  function findTarget(t) {
    var hits = [];
    state.apps.forEach(function (a) {
      var n = String(a.name || '').toLowerCase();
      var id = String(a.id || '').toLowerCase();
      var byId = t.ids && t.ids.indexOf(a.id) >= 0;
      var byName = t.match.some(function (m) { return n.indexOf(m) >= 0 || id.indexOf(m.replace(/ /g, '')) >= 0; });
      if (byId || byName) hits.push(a);
    });
    hits.sort(function (x, y) { return (y.show ? 1 : 0) - (x.show ? 1 : 0); });
    return hits;
  }

  function card(app, extraClass, tagHtml, labelOverride) {
    var cls = 'card focusable' + (extraClass ? ' ' + extraClass : '') + (app && !app.show ? ' hidden-app' : '');
    var name = labelOverride || (app ? app.name : '');
    return '<div class="' + cls + '" data-id="' + esc(app ? app.id : '') + '" data-name="' + esc(name) + '">' +
      iconHtml(app || { name: name }) +
      '<div class="meta"><div class="name">' + esc(name) + '</div>' +
      '<div class="id">' + esc(app ? app.id : 'not found on this TV') + '</div>' +
      (tagHtml || '') + '</div></div>';
  }

  // One row per target, showing every matching app so the right ID can be picked.
  // Test buttons that press remote keys through the TV's remote-control service.
  var REMOTE_TESTS = [
    { label: 'TV Box (HDMI)', keys: 'KEY_HDMI', note: 'switches to the HDMI input' },
    { label: 'Input list', keys: 'KEY_SOURCE', note: 'opens the Source menu' },
    { label: 'Live TV', keys: 'KEY_TV', note: 'TV / TV Plus channels' },
    { label: 'Channel up', keys: 'KEY_CHUP', note: 'next channel' }
  ];
  var TOKEN_KEY = 'xd.tvToken';
  function savedToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function saveToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* storage blocked */ } }

  // Inputs row: every source the TV reports. OK switches to it; Red switches
  // and then opens the TV viewer (some firmware needs that to show the picture).
  function inputsRow() {
    var s = state.sources;
    var head = '<h3>Inputs<small>';
    if (!s) return head + 'checking…</small></h3>';
    var helper = state.apps.some(function (a) { return a.id === HELPER_ID; });
    head += 'via input helper: ' + (helper ? 'installed' : 'NOT installed') +
      (s.current ? ' · now: ' + esc(s.current.type + ' ' + (s.current.number || '')) : '') +
      (s.error ? ' · ' + esc(s.error) : '') + '</small></h3>';
    var list = [];
    (s.connected || []).forEach(function (x) { list.push({ x: x, on: true }); });
    (s.disconnected || []).forEach(function (x) { list.push({ x: x, on: false }); });
    if (!list.length) return head + '<div class="row"><div id="empty">The TV reported no input list.</div></div>';
    return head + '<div class="row">' + list.map(function (it) {
      var label = it.x.type + ' ' + it.x.number;
      return '<div class="card focusable" data-src-type="' + esc(it.x.type) + '" data-src-num="' + esc(it.x.number) +
        '" data-name="' + esc(label) + '"><div class="ph">' + esc(String(it.x.number)) + '</div><div class="meta">' +
        '<div class="name">' + esc(it.x.name || label) + '</div><div class="id">' + esc(label) + '</div>' +
        '<span class="tag ' + (it.on ? 'found' : '') + '">' + (it.on ? 'connected' : 'nothing plugged in') + '</span></div></div>';
    }).join('') + '</div>';
  }

  // Inputs open the input helper app, which has the TV-window permission
  // the service lacks. "show" keeps the input on screen inside the helper;
  // Back closes it and returns here. Red uses "exit" mode instead.
  var HELPER_ID = 'XDInputApp.XDInput';
  // TizenBrew's visible app (it resumes this launcher when reopened).
  function tizenBrewId() {
    var best = null;
    state.apps.forEach(function (a) {
      if (!/tizenbrew/i.test(a.name || '') || /installer/i.test(a.name || '')) return;
      if (!best || (a.show && !best.show)) best = a;
    });
    return best && /^[A-Za-z0-9_.-]{3,80}$/.test(best.id) ? best.id : null;
  }
  function switchSource(type, num, name, alt) {
    var mode = alt ? 'exit' : 'show';
    var data = 'source:' + type + num + '|mode:' + mode;
    var tb = tizenBrewId();
    if (tb) data += '|back:' + tb; // Back in the helper returns to TizenBrew (this launcher)
    log('', 'Input helper: ' + name + ' (' + mode + ') …');
    get('/appcontrol?id=' + encodeURIComponent(HELPER_ID) + '&data=' + encodeURIComponent(data))
      .then(function () { log('ok', 'Input helper opened: ' + name + ' (' + mode + ')'); })
      .catch(function (e) { log('bad', 'Input helper FAILED: ' + name + ' ' + e.message); });
  }

  function remoteRow() {
    return '<h3>Remote buttons<small>first use shows an Allow prompt on the TV</small></h3><div class="row">' +
      REMOTE_TESTS.map(function (r) {
        return '<div class="card focusable" data-keys="' + esc(r.keys) + '" data-name="' + esc(r.label) + '">' +
          '<div class="ph">⌁</div><div class="meta"><div class="name">' + esc(r.label) + '</div>' +
          '<div class="id">' + esc(r.keys) + '</div><span class="tag">' + esc(r.note) + '</span></div></div>';
      }).join('') + '</div>';
  }

  function pressKeys(keys, name) {
    log('', 'keys ' + keys + ' … (answer Allow on the TV if asked)');
    var tok = savedToken();
    var via = '';
    try { via = localStorage.getItem('xd.tvVia') || ''; } catch (e) { /* storage blocked */ }
    get('/key?keys=' + encodeURIComponent(keys) + (tok ? '&token=' + encodeURIComponent(tok) : '') +
        (via ? '&via=' + via : ''))
      .then(function (r) {
        saveToken(r.token);
        try { if (r.via) localStorage.setItem('xd.tvVia', r.via); } catch (e) { /* storage blocked */ }
        log('ok', 'keys OK: ' + name + ' via ' + r.via + ' ' + r.host + ':' + r.port + (r.token ? ' (approved)' : ''));
      })
      .catch(function (e) { log('bad', 'keys FAILED: ' + name + ' ' + e.message); });
  }

  function render() {
    var t = TARGETS.map(function (tg) {
      var hits = findTarget(tg);
      var head = '<h3>' + esc(tg.label) + '<small>' + hits.length + ' match' + (hits.length === 1 ? '' : 'es') + '</small></h3>';
      if (!hits.length) return head + '<div class="row">' + card(null, 'target', '<span class="tag missing">Not found</span>', tg.label) + '</div>';
      return head + '<div class="row">' + hits.map(function (a) {
        return card(a, 'target', '<span class="tag found">' + (a.show ? 'visible' : 'hidden') + '</span>');
      }).join('') + '</div>';
    }).join('');
    $('targets').innerHTML = inputsRow() + t;

    var list = state.apps.filter(function (a) { return state.showHidden || a.show; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    $('allTitle').textContent = (state.showHidden ? 'All installed apps, including hidden' : 'All visible apps') +
      ' (' + list.length + ')';
    $('all').innerHTML = list.length ? list.map(function (a) {
      return card(a, '', a.show ? '' : '<span class="tag">hidden</span>');
    }).join('') : '<div id="empty">No apps returned.</div>';

    var items = focusables();
    if (state.focus >= items.length) state.focus = 0;
    applyFocus();
  }

  function focusables() { return Array.prototype.slice.call(document.querySelectorAll('.focusable')); }

  function applyFocus() {
    var items = focusables();
    items.forEach(function (el, i) { el.classList.toggle('focused', i === state.focus); });
    var el = items[state.focus];
    if (!el) return;
    var scroller = $('scroller');
    var content = $('content');
    var top = el.offsetTop;
    var view = scroller.clientHeight;
    var maxShift = Math.max(0, content.scrollHeight - view);
    var shift = Math.min(maxShift, Math.max(0, top - view / 3));
    content.style.transform = 'translateY(' + (-shift) + 'px)';
  }

  // Spatial navigation: pick the nearest card in the pressed direction.
  function move(dir) {
    var items = focusables();
    var cur = items[state.focus];
    if (!cur) return;
    var a = cur.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = -1, bestScore = Infinity;
    items.forEach(function (el, i) {
      if (i === state.focus) return;
      var b = el.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var dx = bx - ax, dy = by - ay;
      var ok = (dir === 'left' && dx < -5) || (dir === 'right' && dx > 5) || (dir === 'up' && dy < -5) || (dir === 'down' && dy > 5);
      if (!ok) return;
      var primary = (dir === 'left' || dir === 'right') ? Math.abs(dx) : Math.abs(dy);
      var cross = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx);
      var score = primary + cross * 3;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) { state.focus = best; applyFocus(); }
  }

  var logLines = [];
  function log(kind, msg) {
    var d = new Date();
    var ts = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    logLines.unshift('<div class="' + kind + '">' + ts + '  ' + esc(msg) + '</div>');
    logLines = logLines.slice(0, 5);
    $('log').innerHTML = logLines.join('');
  }

  // mode: 'launch' uses tizen.application.launch, 'control' uses launchAppControl.
  function launchFocused(mode) {
    var el = focusables()[state.focus];
    if (!el) return;
    var keys = el.getAttribute('data-keys');
    if (keys) { pressKeys(keys, el.getAttribute('data-name')); return; }
    var srcType = el.getAttribute('data-src-type');
    if (srcType) { switchSource(srcType, el.getAttribute('data-src-num'), el.getAttribute('data-name'), mode === 'control'); return; }
    var id = el.getAttribute('data-id');
    var name = el.getAttribute('data-name');
    if (!id) { log('bad', name + ': not installed on this TV'); return; }
    var path = mode === 'control' ? '/appcontrol?id=' : '/launch?id=';
    var how = mode === 'control' ? 'app-control' : 'launch';
    toast('Opening ' + name + '…');
    log('', how + ' ' + id + ' …');
    get(path + encodeURIComponent(id))
      .then(function () { log('ok', how + ' OK: ' + name + ' (' + id + ')'); })
      .catch(function (e) { log('bad', how + ' FAILED: ' + name + ' (' + id + ') ' + e.message); });
  }

  // Icon check: what the TV reports for the main apps, and where their icon
  // files actually are. Shown as text so a photo of it is enough to diagnose.
  function iconCheck() {
    var CHECK = [['Netflix', /netflix/i, 'netflix'], ['Prime Video', /prime video|primevideo/i, 'prime'],
      ['YouTube', /^youtube$/i, 'youtube'], ['Crave', /^crave/i, 'crave']];
    var ids = [], lines = [];
    CHECK.forEach(function (c) {
      var a = state.apps.filter(function (x) { return c[1].test(x.name || '') || c[1].test(x.id || ''); })[0];
      if (a) ids.push(a.id);
    });
    var box = $('iconcheck');
    // First: which app IDs the TV's own service recognizes (for return-to-Lumen).
    get('/restprobe?ids=' + encodeURIComponent(ids.join(','))).then(function (r) {
      (r.apps || []).forEach(function (a) { lines.push('<b>screen check ' + esc(a.id) + '</b>: ' + esc(a.tried.join(' | '))); });
      box.innerHTML = lines.join('<br>');
    }).catch(function (e) { lines.push('screen check failed: ' + esc(e.message)); })
    .then(function () { return get('/icondiag?ids=' + encodeURIComponent(ids.join(','))); }).then(function (d) {
      (d.apps || []).forEach(function (a) {
        lines.push('<b>' + esc(a.id) + '</b> pkg=' + esc(a.packageId) + ' reported=' + esc(a.reported || 'none') +
          (a.placeholder ? ' <span class="bad">(placeholder)</span>' : '') +
          ' found=' + (a.found ? '<span class="ok">' + esc(a.found) + '</span>' : '<span class="bad">none</span>'));
      });
      box.innerHTML = lines.join('<br>') + '<br>Searching shared folders…';
      // Also look for Samsung's home-bar tile art and app preview images.
      var terms = CHECK.map(function (c) { return c[2]; }).concat(['crave', 'cosmo', 'preview', 'smarthub', 'homebar']);
      return terms.reduce(function (p, term) {
        return p.then(function () {
          return get('/iconsearch?q=' + term).then(function (r) {
            lines.push('<b>search "' + term + '"</b> ' + r.hits.length + ' hits' + (r.timedOut ? ' (timed out)' : '') + ': ' +
              (r.hits.slice(0, 4).map(function (h) { return esc(h.path) + ' (' + Math.round(h.size / 1024) + 'KB)'; }).join(' | ') || 'none') +
              (r.denied.length ? ' <span class="bad">no access: ' + esc(r.denied.join(', ')) + '</span>' : ''));
          }).catch(function (e) { lines.push('search "' + term + '" failed: ' + esc(e.message)); });
        });
      }, Promise.resolve()).then(function () { box.innerHTML = lines.join('<br>'); });
    }).catch(function (e) { box.textContent = 'Icon check failed: ' + e.message; });
  }

  // What the return-to-Lumen watcher has been doing.
  function showWatch() {
    get('/watch').then(function (w) {
      (w.log || []).slice(0, 4).reverse().forEach(function (line) { log('', 'return-to-Lumen: ' + line); });
      if (!w.log || !w.log.length) log('', 'return-to-Lumen: nothing watched yet');
    }).catch(function () { /* older service */ });
  }

  function load() {
    setStatus('', 'Connecting to service…');
    var build = window.XD_BUILD || {};
    var bootInfo = {};
    return waitForService(15)
      // Ask the service to run the core from the same commit as this screen.
      .then(function () { return get('/boot?ref=' + encodeURIComponent(build.sha || 'main')); })
      .then(function (b) { bootInfo = b || {}; return get('/info'); })
      .then(function (info) {
        var ref = bootInfo.coreRef ? String(bootInfo.coreRef).slice(0, 7) : 'pinned';
        setStatus('ok', 'Service <b>v' + esc(info.serviceVersion) + '</b> · build <b>' + esc(ref) + '</b> · ' +
          esc(info.model || 'unknown model'));
        if (bootInfo.error) log('bad', 'service update failed, using previous core: ' + bootInfo.error);
        return get('/apps');
      })
      .then(function (data) { state.apps = data.apps || []; render();
        return get('/sources').catch(function (e) { return { tvwindow: false, error: e.message }; }); })
      .then(function (src) { state.sources = src; render(); iconCheck(); showWatch(); })
      .catch(function (e) {
        setStatus('bad', 'Service unavailable: ' + esc(e.message));
        $('all').innerHTML = '<div id="empty">The launcher service did not respond. Close TizenBrew fully and open it again.</div>';
      });
  }

  var KEY = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  document.addEventListener('keydown', function (e) {
    $('lastKey').textContent = 'Last key: ' + (e.key || '?') + ' (' + e.keyCode + ')';
    if (KEY[e.keyCode]) { e.preventDefault(); move(KEY[e.keyCode]); return; }
    if (e.keyCode === 13) { e.preventDefault(); launchFocused('launch'); return; }
    if (e.keyCode === 403) { launchFocused('control'); return; } // Red
    if (e.keyCode === 405) { state.showHidden = !state.showHidden; state.focus = 0; render(); return; } // Yellow
    if (e.keyCode === 406) { load(); return; } // Blue
    // Back: TizenBrew opened this page by navigating to it, so going back in
    // history returns to TizenBrew's own home screen and module list.
    if (e.keyCode === 10009 || e.keyCode === 8 || e.key === 'GoBack' || e.key === 'XF86Back') {
      e.preventDefault();
      if (history.length > 1) history.back();
      else log('bad', 'Back: no TizenBrew screen to return to. Press Home, then restart the TV.');
      return;
    }
  });

  load();
})();
