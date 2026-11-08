// Lumen Input: switches the TV's input. The Lumen launcher opens it with app-control data
// source=HDMI1, mode=viewer|exit|show and back=<app id to return to on Back>.
// Opened from the Apps list, it shows a test screen with every connected input
// and each switching method.
//
// Loaded by index.html, either from an exact commit on jsDelivr (self-update)
// or from the copy packaged with the app.
(function () {
  'use strict';
  if (window.__xdInputStarted) return; // never run twice
  window.__xdInputStarted = true;
  window.XD_INPUT_VERSION = '1.2.0';
  // On-screen name (the packaged page still says the old name until a reinstall).
  try {
    document.title = 'Lumen Input';
    var h1 = document.querySelector('#ui h1');
    if (h1) h1.textContent = 'Lumen Input';
    var sub = document.querySelector('#ui p.sub');
    if (sub) sub.textContent = 'Pick an input and a method to test switching. Back returns to where you came from.';
  } catch (e) { /* page layout changed */ }
  var app = tizen.application.getCurrentApplication();
  function $(id) { return document.getElementById(id); }
  function status(msg) { $('status').textContent = msg; }
  function exitSoon(ms) { setTimeout(function () { try { app.exit(); } catch (e) { /* already closing */ } }, ms || 300); }

  function readRequest() {
    var out = {};
    try {
      var req = app.getRequestedAppControl();
      var data = (req && req.appControl && req.appControl.data) || [];
      for (var i = 0; i < data.length; i++) out[data[i].key] = data[i].value && data[i].value[0];
    } catch (e) { /* launched without app control */ }
    return out;
  }

  function sources(cb) {
    tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (vs) {
      cb(null, (vs && vs.connected) || [], (vs && vs.disconnected) || []);
    }, function (e) { cb(e); });
  }

  function findSource(name, cb) {
    var m = /^([A-Z_]+?)(\d+)$/.exec(String(name || 'HDMI1').toUpperCase());
    if (!m) return cb(new Error('bad source ' + name));
    sources(function (err, on, off) {
      if (err) return cb(err);
      var all = on.concat(off);
      for (var i = 0; i < all.length; i++) {
        if (all[i].type === m[1] && String(all[i].number) === m[2]) return cb(null, all[i]);
      }
      cb(new Error(name + ' not found'));
    });
  }

  // mode: viewer = switch, then hand the screen to the TV viewer and exit
  //       exit   = switch and exit
  //       show   = switch and show the input inside this app (Back exits)
  function switchTo(name, mode, cb) {
    findSource(name, function (err, src) {
      if (err) return cb(err);
      tizen.tvwindow.setSource(src, function () {
        if (mode === 'show') {
          tizen.tvwindow.show(function () {
            document.body.classList.add('showing');
            cb(null, 'showing ' + name + ' here');
          }, function (e) { cb(e); }, ['0px', '0px', '1920px', '1080px'], 'MAIN');
          return;
        }
        if (mode === 'viewer') {
          tizen.application.launch('org.tizen.tv-viewer', function () {
            cb(null, 'switched to ' + name + ', TV viewer opened');
            exitSoon(500);
          }, function (e) { cb(new Error('switched, but TV viewer failed: ' + e.message)); });
          return;
        }
        cb(null, 'switched to ' + name);
        exitSoon(300);
      }, function (e) { cb(e); }, 'MAIN');
    });
  }

  // Back goes to the app that opened us (Lumen passes TizenBrew's id),
  // otherwise just closes, which lands on the TV's home screen.
  function goBack() {
    if (document.body.classList.contains('showing')) {
      try { tizen.tvwindow.hide(function () {}, function () {}, 'MAIN'); } catch (x) { /* ignore */ }
    }
    var back = req && req.back;
    if (back && /^[A-Za-z0-9_.-]{3,80}$/.test(back)) {
      try {
        tizen.application.launch(back, function () { exitSoon(150); }, function () { exitSoon(0); });
        return;
      } catch (x) { /* fall through */ }
    }
    exitSoon(0);
  }

  var req = readRequest();
  if (req.source) {
    // Silent run from the Lumen launcher.
    document.body.classList.add('silent');
    switchTo(req.source, req.mode || 'viewer', function (err, msg) {
      if (err) {
        document.body.classList.remove('silent');
        status('Could not switch to ' + req.source + ': ' + (err.message || err));
      }
    });
  } else {
    buildTestScreen();
  }

  // ---- Test screen ----
  var focus = 0;
  function buttons() { return Array.prototype.slice.call(document.querySelectorAll('.btn')); }
  function paint() { buttons().forEach(function (b, i) { b.classList.toggle('focused', i === focus); }); }

  function buildTestScreen() {
    sources(function (err, on) {
      if (err) { $('list').textContent = 'Could not read inputs: ' + err.message; return; }
      var methods = [
        ['viewer', 'Switch + TV viewer', 'then exits'],
        ['exit', 'Switch + exit', 'leaves the TV on that input'],
        ['show', 'Switch + show here', 'Back exits']
      ];
      $('list').innerHTML = on.map(function (s) {
        var name = s.type + s.number;
        return '<div class="src"><h2>' + s.type + ' ' + s.number + '</h2><div class="row">' +
          methods.map(function (m) {
            return '<div class="btn" data-src="' + name + '" data-mode="' + m[0] + '">' + m[1] + '<small>' + m[2] + '</small></div>';
          }).join('') + '</div></div>';
      }).join('') || 'No connected inputs.';
      paint();
      status('Current input: ' + (function () { try { var c = tizen.tvwindow.getSource('MAIN'); return c.type + ' ' + c.number; } catch (e) { return 'unknown'; } })());
    });
  }

  try { tizen.tvinputdevice.registerKey('ColorF0Red'); } catch (e) { /* optional */ }
  document.addEventListener('keydown', function (e) {
    var b = buttons();
    if (e.keyCode === 10009) { // Back: return to whoever opened us
      e.preventDefault();
      goBack();
      return;
    }
    if (!b.length || document.body.classList.contains('showing')) return;
    var cols = 3;
    if (e.keyCode === 39) focus = Math.min(b.length - 1, focus + 1);
    else if (e.keyCode === 37) focus = Math.max(0, focus - 1);
    else if (e.keyCode === 40) focus = Math.min(b.length - 1, focus + cols);
    else if (e.keyCode === 38) focus = Math.max(0, focus - cols);
    else if (e.keyCode === 13) {
      var el = b[focus];
      status('Working…');
      switchTo(el.getAttribute('data-src'), el.getAttribute('data-mode'), function (err, msg) {
        status(err ? 'FAILED: ' + (err.message || err) : 'OK: ' + msg);
      });
      return;
    }
    paint();
  });
})();
