// XD Launcher service core: the app-facing routes.
//
// Loaded by service/service.js (the stable bootstrap) from an exact commit on
// jsDelivr, so service updates ship without re-adding the module in TizenBrew.
// Runs in a Node vm sandbox with `tizen`, `require`, `console`, `Buffer` and
// `module` provided by the bootstrap.
//
// Environment limits: Tizen's service Node is old (Node 4.4.3), so ES5 only
// (no let/const, arrow functions, template strings or destructuring), one file,
// and only built-in Node modules.

var fs = require('fs');

var VERSION = '0.12.0';

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', // page lives on port 8081
    'Cache-Control': 'no-store'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function errText(e) {
  if (!e) return 'unknown error';
  if (e.name || e.message) return (e.name || 'Error') + ': ' + (e.message || '');
  return String(e);
}

function fail(res, e) {
  send(res, 500, { error: errText(e) });
}

function hasTizen() {
  return typeof tizen !== 'undefined' && tizen && tizen.application;
}

// Only icon paths that getAppsInfo returned may be read, never arbitrary files.
var allowedIcons = {};

function capability(key) {
  try { return tizen.systeminfo.getCapability(key); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Remote keys through Samsung's built-in remote-control service.
//
// The TV accepts remote button presses on a local WebSocket
// (wss://127.0.0.1:8002, older firmware ws://127.0.0.1:8001). The first
// connection makes the TV show an "Allow" prompt; after that it returns a token
// that the page stores and sends back. Node 4 has no WebSocket client, so this
// is a minimal one: handshake, masked text frames out, unmasked frames in.
// ---------------------------------------------------------------------------
var net = require('net');
var tls = require('tls');
var crypto = require('crypto');
// Timers from the built-in module: sandbox globals can't be relied on.
var timers = require('timers');
var later = timers.setTimeout;
var cancel = timers.clearTimeout;

// Run a callback so that a thrown error can never escape into TizenBrew's
// shared service process (an uncaught throw there would take TizenBrew down).
function guard(fn, onError) {
  return function () {
    try { return fn.apply(this, arguments); } catch (e) { if (onError) { try { onError(e); } catch (e2) { /* ignore */ } } }
  };
}

var REMOTE_NAME = new Buffer('XD Launcher').toString('base64');
var remoteToken = null;

function wsFrame(text) {
  var payload = new Buffer(text, 'utf8');
  var len = payload.length;
  var header;
  if (len < 126) {
    header = new Buffer(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = new Buffer(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = new Buffer(10);
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x81; // FIN + text
  var mask = crypto.randomBytes(4);
  for (var i = 0; i < len; i++) payload[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, payload]);
}

// Pull complete frames off the buffer. Returns { frames: [{op, text}], rest }.
function wsParse(buf) {
  var frames = [];
  while (buf.length >= 2) {
    var op = buf[0] & 0x0f;
    var masked = (buf[1] & 0x80) !== 0;
    var len = buf[1] & 0x7f;
    var off = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) break; len = buf.readUInt32BE(6); off = 10; }
    var maskKey = null;
    if (masked) { if (buf.length < off + 4) break; maskKey = buf.slice(off, off + 4); off += 4; }
    if (buf.length < off + len) break;
    var data = buf.slice(off, off + len);
    if (maskKey) for (var i = 0; i < data.length; i++) data[i] = data[i] ^ maskKey[i % 4];
    frames.push({ op: op, text: data.toString('utf8') });
    buf = buf.slice(off + len);
  }
  return { frames: frames, rest: buf };
}

function remoteSend(host, secure, keys, token, cb) {
  var port = secure ? 8002 : 8001;
  var path = '/api/v2/channels/samsung.remote.control?name=' + encodeURIComponent(REMOTE_NAME) +
    (token ? '&token=' + encodeURIComponent(token) : '');
  var finished = false;
  var sock;
  var timer = later(guard(function () { finish(new Error('timed out waiting for the TV (was the Allow prompt answered?)')); }), 35000);

  function finish(err, result) {
    if (finished) return;
    finished = true;
    cancel(timer);
    try { if (sock) sock.destroy(); } catch (e) { /* closed */ }
    try { cb(err, result); } catch (e) { /* never throw into the socket */ }
  }

  function onConnect() {
    sock.write('GET ' + path + ' HTTP/1.1\r\n' +
      'Host: ' + host + ':' + port + '\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n');
  }

  var safeConnect = guard(onConnect, finish);
  try {
    sock = secure
      ? tls.connect({ host: host, port: port, rejectUnauthorized: false }, safeConnect) // the TV's own self-signed cert; only ever this TV
      : net.connect({ host: host, port: port }, safeConnect);
  } catch (e) {
    return finish(e);
  }

  var buf = new Buffer(0);
  var upgraded = false;

  function sendKeys(newToken) {
    var i = 0;
    (function next() {
      if (finished) return;
      if (i >= keys.length) {
        return later(guard(function () { finish(null, { token: newToken || token || null, port: port, host: host, sent: keys }); }, finish), 300);
      }
      sock.write(wsFrame(JSON.stringify({
        method: 'ms.remote.control',
        params: { Cmd: 'Click', DataOfCmd: keys[i], Option: 'false', TypeOfRemote: 'SendRemoteKey' }
      })));
      i++;
      later(guard(next, finish), 350);
    })();
  }

  sock.on('data', guard(function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      var end = buf.toString('binary').indexOf('\r\n\r\n');
      if (end < 0) return;
      var head = buf.slice(0, end).toString('utf8');
      if (!/^HTTP\/1\.1 101/.test(head)) return finish(new Error('handshake refused: ' + head.split('\r\n')[0]));
      upgraded = true;
      buf = buf.slice(end + 4);
    }
    var parsed = wsParse(buf);
    buf = parsed.rest;
    for (var f = 0; f < parsed.frames.length; f++) {
      var fr = parsed.frames[f];
      if (fr.op === 0x8) return finish(new Error('TV closed the connection'));
      if (fr.op !== 0x1) continue;
      var msg;
      try { msg = JSON.parse(fr.text); } catch (e) { continue; }
      if (msg.event === 'ms.channel.connect') {
        var t = msg.data && msg.data.token ? String(msg.data.token) : null;
        if (t) remoteToken = t;
        sendKeys(t);
      } else if (msg.event === 'ms.channel.unauthorized') {
        var denied = new Error('the TV denied access (choose Allow when the prompt appears)'); denied.kind = 'denied'; return finish(denied);
      } else if (msg.event === 'ms.channel.timeOut') {
        var to = new Error('the TV timed out waiting for approval'); to.kind = 'timeout'; return finish(to);
      }
    }
  }, finish));
  sock.on('error', guard(function (e) { finish(e); }));
  sock.on('close', guard(function () { finish(new Error('connection closed before keys were sent')); }));
}

// The TV's own Wi-Fi/Ethernet address. Samsung's local REST API reports it;
// os.networkInterfaces() is the fallback.
var lanIpCache = null;
function lanAddress(cb) {
  if (lanIpCache) return cb(lanIpCache);
  var done = false;
  function finish(ip) { if (done) return; done = true; if (ip) lanIpCache = ip; cb(ip || null); }
  function fromOs() {
    try {
      var ifs = require('os').networkInterfaces();
      for (var name in ifs) {
        for (var i = 0; i < ifs[name].length; i++) {
          var a = ifs[name][i];
          if (a.family === 'IPv4' && !a.internal) return a.address;
        }
      }
    } catch (e) { /* not available */ }
    return null;
  }
  var t = later(guard(function () { finish(fromOs()); }), 3000);
  try {
    require('http').get('http://127.0.0.1:8001/api/v2/', guard(function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', guard(function () {
        cancel(t);
        var ip = null;
        try { ip = JSON.parse(body).device.ip; } catch (e) { /* not JSON */ }
        finish(/^\d{1,3}(\.\d{1,3}){3}$/.test(ip || '') ? ip : fromOs());
      }, function () { finish(fromOs()); }));
    }, function () { cancel(t); finish(fromOs()); })).on('error', guard(function () { cancel(t); finish(fromOs()); }));
  } catch (e) {
    cancel(t);
    finish(fromOs());
  }
}

function validKeys(list) {
  var keys = String(list || '').split(',');
  if (!keys.length || keys.length > 12) return null;
  for (var i = 0; i < keys.length; i++) if (!/^KEY_[A-Z0-9_]{1,24}$/.test(keys[i])) return null;
  return keys;
}

// ---------------------------------------------------------------------------
// App icons: the developer's own icon as installed on the TV. Uses the icon
// path the TV reports; when that is missing or unreadable, looks inside the
// app's own install folder for its icon image. Only image files inside known
// app folders of apps the TV listed are ever read.
// ---------------------------------------------------------------------------
var appIndex = {};     // app id -> { iconPath, packageId }
var iconCache = {};    // app id -> resolved file path (or '' when none found)
var placeholderPaths = {}; // icon files shared by several apps
var APP_ROOTS = ['/opt/usr/globalapps/', '/usr/apps/', '/opt/usr/apps/', '/opt/usr/home/owner/apps_rw/'];

function isImage(name) { return /\.(png|jpe?g|webp)$/i.test(name); }

function findIconFile(pkg, cb) {
  if (!pkg || !/^[A-Za-z0-9_.-]{2,80}$/.test(pkg)) return cb(null);
  var best = null, bestScore = -1, pending = 0, finished = false;
  function score(path, size) {
    var n = path.toLowerCase();
    var s = Math.min(size, 400000) / 1000;           // bigger is usually sharper
    if (/icon|logo/.test(n)) s += 500;               // named like an icon
    if (/splash|background|bg_|banner|preview|screenshot/.test(n)) s -= 800;
    if (placeholderPaths[path]) s -= 5000;          // never the generic pinwheel
    if (/\/shared\/res\//.test(n)) s += 200;      // where Tizen apps keep icons
    return s;
  }
  function done() { if (!finished && pending === 0) { finished = true; cb(best); } }
  function walk(dir, depth) {
    pending++;
    fs.readdir(dir, guard(function (err, names) {
      if (!err && names) {
        names.forEach(function (name) {
          if (name.charAt(0) === '.') return;
          var full = dir + '/' + name;
          pending++;
          fs.stat(full, guard(function (e2, st) {
            if (!e2 && st) {
              if (st.isDirectory() && depth < 4 && !/node_modules|locale|lib$/i.test(name)) walk(full, depth + 1);
              else if (st.isFile() && isImage(name) && st.size > 1500 && st.size < 2000000) {
                var sc = score(full, st.size);
                if (sc > bestScore) { bestScore = sc; best = full; }
              }
            }
            pending--; done();
          }, function () { pending--; done(); }));
        });
      }
      pending--; done();
    }, function () { pending--; done(); }));
  }
  var roots = APP_ROOTS.slice(), i = 0;
  (function nextRoot() {
    if (i >= roots.length) { if (pending === 0 && !finished) { finished = true; cb(best); } return; }
    var dir = roots[i++] + pkg;
    fs.stat(dir, guard(function (e, st) {
      if (!e && st && st.isDirectory()) { walk(dir, 0); return; }
      nextRoot();
    }, function () { nextRoot(); }));
  })();
}

function sendImage(res, path) {
  fs.readFile(path, guard(function (e, data) {
    if (e) return send(res, 404, { error: 'not found' });
    var type = /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.webp$/i.test(path) ? 'image/webp' : 'image/png';
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=86400' });
    res.end(data);
  }, function () { send(res, 500, { error: 'read failed' }); }));
}

// ---------------------------------------------------------------------------
// Return to Lumen. When an app opened from Lumen closes, the TV would normally
// go to Samsung's home screen. The service keeps running in the background, so
// it watches that app and reopens TizenBrew (which resumes Lumen) as soon as
// the app is no longer running. Pressing Home inside the app leaves it running
// in the background, so it does not trigger a return.
// ---------------------------------------------------------------------------
var watch = null;        // { id, back, seen, since }
var watchTimer = null;
// A self-update loads a fresh copy of this file while the old one may still
// be watching. Both copies share Node's timers module, so the handle lives
// there and a new copy stops the old one's watch.
if (timers.__lumenWatchTimer) { try { timers.clearInterval(timers.__lumenWatchTimer); } catch (e) { /* gone */ } timers.__lumenWatchTimer = null; }
var WATCH_EVERY = 1200;  // ms
var WATCH_MAX = 8 * 3600 * 1000;
var watchLog = [];

function noteWatch(msg) {
  watchLog.unshift(new Date().toISOString().slice(11, 19) + ' ' + msg);
  watchLog = watchLog.slice(0, 12);
}

function stopWatch(reason) {
  if (watchTimer) { timers.clearInterval(watchTimer); watchTimer = null; }
  if (timers.__lumenWatchTimer) { timers.clearInterval(timers.__lumenWatchTimer); timers.__lumenWatchTimer = null; }
  if (watch) noteWatch('stop ' + watch.id + ': ' + reason);
  watch = null;
}

function startWatch(id, back) {
  stopWatch('replaced');
  if (!back || !/^[A-Za-z0-9_.-]{3,80}$/.test(back)) return;
  watch = { id: id, back: back, seen: false, since: Date.now(), misses: 0 };
  noteWatch('watch ' + id);
  watchTimer = timers.setInterval(guard(checkWatch, function (e) { noteWatch('check error ' + errText(e)); }), WATCH_EVERY);
  timers.__lumenWatchTimer = watchTimer;
}

// Ask the TV's local REST service whether an app is on screen. Samsung TVs
// answer GET /api/v2/applications/<id> with { running, visible }, but often
// under the app's numeric store ID rather than its Tizen ID, so each app gets
// a list of candidate IDs; the first one the TV recognizes is remembered.
var STORE_IDS = {
  'org.tizen.netflix-app': ['3201907018807', '11101200001'],
  '9Ur5IzDKqV.TizenYouTube': ['111299001912'],
  'org.tizen.primevideo': ['3201910019365', '3201512006785'],
  'MCmYXNxgcu.DisneyPlus': ['3201901017640'],
  'SKvHIMBcln.CraveTV': ['3201703012079'],
  'CDMPWSBGDH.cineplex': ['3201707014347'],
  'com.samsung.tv.tvplus': ['3201710015037']
};
var restId = {};      // tizen app id -> REST id that works ('' = none)

function restCandidates(id) {
  var list = [id];
  var info = appIndex[id];
  if (info && info.packageId && list.indexOf(info.packageId) < 0) list.push(info.packageId);
  (STORE_IDS[id] || []).forEach(function (x) { if (list.indexOf(x) < 0) list.push(x); });
  return list;
}

function restGet(rid, cb) {
  var done = false;
  function finish(status, j, body) { if (!done) { done = true; cb(status, j, body); } }
  var t = later(guard(function () { finish(0, null, 'timeout'); }), 1500);
  try {
    var req = require('http').get('http://127.0.0.1:8001/api/v2/applications/' + encodeURIComponent(rid), guard(function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', guard(function () {
        cancel(t);
        var j = null;
        try { j = JSON.parse(body); } catch (e) { /* not JSON */ }
        finish(res.statusCode, j, body);
      }, function () { finish(0, null, 'parse'); }));
    }, function () { finish(0, null, 'error'); }));
    req.on('error', guard(function (e) { cancel(t); finish(0, null, (e && e.code) || 'error'); }));
  } catch (e) {
    cancel(t);
    finish(0, null, errText(e));
  }
}

// Calls back with true/false, or null when the TV doesn't say (then we fall back).
function appVisible(id, cb) {
  if (restId[id] === '') return cb(null);
  if (restId[id]) {
    return restGet(restId[id], function (status, j) {
      cb(status === 200 && j && typeof j.visible === 'boolean' ? j.visible : null);
    });
  }
  var cands = restCandidates(id), notes = [];
  (function next(i) {
    if (i >= cands.length) {
      restId[id] = '';
      noteWatch('screen check: no ID recognized (' + notes.join(', ') + ')');
      return cb(null);
    }
    restGet(cands[i], function (status, j) {
      notes.push(cands[i] + '=' + status);
      if (status === 200 && j && typeof j.visible === 'boolean') {
        restId[id] = cands[i];
        noteWatch('screen check: TV knows ' + id + ' as ' + cands[i]);
        return cb(j.visible);
      }
      next(i + 1);
    });
  })(0);
}

// Called with true when the watched app is on screen (or running), false when not.
function onWatchState(present) {
  if (!watch) return;
  if (present) { watch.seen = true; watch.misses = 0; return; }
  if (!watch.seen) {
    // The app may take a moment to appear; give up quietly after ~20 s.
    if (Date.now() - watch.since > 20000) stopWatch('never started');
    return;
  }
  // Two misses in a row, so a brief blip inside the app doesn't count.
  watch.misses++;
  if (watch.misses < 2) return;
  var back = watch.back, id = watch.id, how = watch.how;
  stopWatch(how === 'screen' ? 'left the screen' : 'closed');
  noteWatch('return to Lumen after ' + id);
  try { tizen.application.launch(back, function () {}, function (e) { noteWatch('return failed ' + errText(e)); }); }
  catch (e) { noteWatch('return failed ' + errText(e)); }
}

function checkWatch() {
  if (!watch) return stopWatch('none');
  if (Date.now() - watch.since > WATCH_MAX) return stopWatch('expired');
  if (watch.busy) return;        // previous check still waiting on the TV
  watch.busy = true;
  var w = watch;
  function idle() { w.busy = false; }
  // Prefer "is it on screen?" (exiting many apps only hides them); fall back
  // to "is it still running?" when the TV won't say.
  appVisible(watch.id, guard(function (visible) {
    if (!watch) return;
    idle();
    if (visible !== null) {
      if (watch.how !== 'screen') { watch.how = 'screen'; noteWatch('watching ' + watch.id + ' on screen'); }
      return onWatchState(visible);
    }
    if (watch.how !== 'running') { watch.how = 'running'; noteWatch('watching ' + watch.id + ' running (screen check unavailable)'); }
    tizen.application.getAppsContext(guard(function (contexts) {
      var running = false;
      for (var i = 0; i < contexts.length; i++) if (contexts[i].appId === watch.id) { running = true; break; }
      onWatchState(running);
    }, function (e) { noteWatch('context error ' + errText(e)); }), guard(function (e) { noteWatch('context error ' + errText(e)); }));
  }, function (e) { idle(); noteWatch('check error ' + errText(e)); }));
}

var routes = {
  // /key?keys=KEY_HDMI or KEY_1,KEY_2,KEY_ENTER, optional &token=<saved token>
  // and &via=lan|lo (the route that worked last time, remembered by the page).
  '/key': function (req, res, query) {
    var keys = validKeys(query.keys);
    if (!keys) return send(res, 400, { error: 'keys must be KEY_* names, comma separated' });
    var token = query.token ? String(query.token).slice(0, 64) : remoteToken;
    var via = query.via === 'lo' || query.via === 'lan' ? query.via : null;
    lanAddress(guard(function (lanIp) {
      var routesToTry = [];
      function add(kind, host, secure) { if (host && (!via || via === kind)) routesToTry.push({ via: kind, host: host, secure: secure }); }
      // Newer TVs may ignore requests from their own loopback address, so the
      // TV's Wi-Fi address goes first; loopback stays as a fallback.
      add('lan', lanIp, true); add('lo', '127.0.0.1', true); add('lan', lanIp, false); add('lo', '127.0.0.1', false);
      if (via && !routesToTry.length) { via = null; add('lan', lanIp, true); add('lo', '127.0.0.1', true); add('lan', lanIp, false); add('lo', '127.0.0.1', false); }
      var errors = [];
      (function attempt(i) {
        if (i >= routesToTry.length) return send(res, 502, { error: errors.join(' | '), lanIp: lanIp || null });
        var r = routesToTry[i];
        remoteSend(r.host, r.secure, keys, token, guard(function (err, result) {
          if (!err) return send(res, 200, { ok: true, token: result.token, via: r.via, host: result.host, port: result.port, sent: result.sent });
          errors.push(r.via + ':' + (r.secure ? 8002 : 8001) + ' ' + errText(err));
          if (err.kind === 'denied') return send(res, 502, { error: errors.join(' | '), lanIp: lanIp || null });
          attempt(i + 1);
        }, function (e) { send(res, 500, { error: errText(e) }); }));
      })(0);
    }, function (e) { send(res, 500, { error: errText(e) }); }));
  },

  '/ping': function (req, res) {
    send(res, 200, { ok: true, version: VERSION, tizen: !!hasTizen() });
  },

  '/info': function (req, res) {
    if (!hasTizen()) return send(res, 200, { tizen: false });
    send(res, 200, {
      tizen: true,
      model: capability('http://tizen.org/system/model_name'),
      platformVersion: capability('http://tizen.org/feature/platform.version'),
      webApiVersion: capability('http://tizen.org/feature/platform.web.api.version'),
      serviceVersion: VERSION
    });
  },

  // Every installed app, including hidden ones, so we can find system apps
  // such as the TV viewer (inputs) and Samsung TV Plus.
  // /icondiag?ids=a,b: how each app's icon was resolved (for troubleshooting).
  // /iconsearch?q=netflix: image files whose path mentions q, in the TV's
  // shared app and resource folders. Read-only, depth- and time-limited.
  '/iconsearch': function (req, res, query) {
    var q = String(query.q || '').toLowerCase();
    if (!/^[a-z0-9_.-]{3,40}$/.test(q)) return send(res, 400, { error: 'q must be 3-40 letters, digits, . _ -' });
    var roots = ['/opt/usr/globalapps', '/usr/apps', '/opt/usr/apps', '/opt/share', '/opt/usr/share', '/usr/share', '/opt/usr/home/owner/share', '/opt/usr/home/owner/apps_rw'];
    var hits = [], visited = 0, pending = 0, finished = false, denied = [];
    var deadline = Date.now() + 6000;
    function done() {
      if (finished || pending > 0) return;
      finished = true;
      hits.sort(function (a, b) { return b.size - a.size; });
      send(res, 200, { q: q, visited: visited, hits: hits.slice(0, 25), denied: denied.slice(0, 10), timedOut: Date.now() > deadline });
    }
    function walk(dir, depth, matched) {
      if (visited > 40000 || Date.now() > deadline) return;
      pending++;
      fs.readdir(dir, guard(function (err, names) {
        if (err) { if (depth <= 1) denied.push(dir + ' (' + (err.code || 'error') + ')'); }
        else {
          names.forEach(function (name) {
            visited++;
            var full = dir + '/' + name;
            var hit = matched || full.toLowerCase().indexOf(q) >= 0;
            pending++;
            fs.stat(full, guard(function (e2, st) {
              if (!e2 && st) {
                if (st.isDirectory() && depth < 6) walk(full, depth + 1, hit);
                else if (st.isFile() && hit && isImage(name) && st.size > 400) hits.push({ path: full, size: st.size });
              }
              pending--; done();
            }, function () { pending--; done(); }));
          });
        }
        pending--; done();
      }, function () { pending--; done(); }));
    }
    roots.forEach(function (r) { walk(r, 0, false); });
    done();
  },

  '/icondiag': function (req, res, query) {
    var ids = String(query.ids || '').split(',').slice(0, 20);
    var out = [], pending = ids.length;
    if (!pending) return send(res, 200, { apps: out });
    ids.forEach(function (id, idx) {
      var info = appIndex[id];
      if (!info) { out[idx] = { id: id, error: 'unknown app' }; if (--pending === 0) send(res, 200, { apps: out }); return; }
      findIconFile(info.packageId || id.split('.')[0], function (found) {
        out[idx] = { id: id, packageId: info.packageId, reported: info.iconPath, placeholder: info.placeholder, found: found || null };
        if (--pending === 0) send(res, 200, { apps: out });
      });
    });
  },

  // /appicon?id=<app id>[,<another id>]: the app's own icon, found as
  // described above. With several ids, the first one that has an icon wins.
  '/appicon': function (req, res, query) {
    var ids = String(query.id || '').split(',').slice(0, 4);
    function resolve(id, cb) {
      var info = appIndex[id];
      if (!info) return cb(null);
      if (iconCache[id] !== undefined) return cb(iconCache[id] || null);
      var reported = info.iconPath ? String(info.iconPath).replace(/^file:\/\//, '') : '';
      function fallback() {
        findIconFile(info.packageId || id.split('.')[0], function (found) { iconCache[id] = found || ''; cb(found || null); });
      }
      if (!reported || info.placeholder) return fallback();
      fs.stat(reported, guard(function (e, st) {
        if (!e && st && st.isFile() && st.size > 200) { iconCache[id] = reported; return cb(reported); }
        fallback();
      }, function () { fallback(); }));
    }
    var known = false;
    for (var k = 0; k < ids.length; k++) if (appIndex[ids[k]]) known = true;
    if (!known) return send(res, 404, { error: 'unknown app (load /apps first)' });
    (function next(i) {
      if (i >= ids.length) return send(res, 404, { error: 'no icon found' });
      resolve(ids[i], guard(function (path) { if (path) sendImage(res, path); else next(i + 1); }, function () { next(i + 1); }));
    })(0);
  },

  '/apps': function (req, res) {
    if (!hasTizen()) return send(res, 503, { error: 'tizen API not available in service' });
    try {
      tizen.application.getAppsInfo(function (list) {
        var self = '';
        try { self = tizen.application.getAppInfo().id; } catch (e) { /* no own id */ }
        allowedIcons = {};
        appIndex = {};
        iconCache = {};
        // An icon file shared by several apps is Samsung's generic placeholder
        // (the pinwheel), not the app's own artwork.
        var iconUse = {};
        for (var k = 0; k < list.length; k++) if (list[k].iconPath) iconUse[list[k].iconPath] = (iconUse[list[k].iconPath] || 0) + 1;
        placeholderPaths = {};
        for (var pth in iconUse) if (iconUse[pth] > 1) placeholderPaths[String(pth).replace(/^file:\/\//, '')] = true;
        var apps = [];
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          if (a.id === self) continue;
          if (a.iconPath) allowedIcons[a.iconPath] = true;
          appIndex[a.id] = { iconPath: a.iconPath || null, packageId: a.packageId || null,
            placeholder: !!(a.iconPath && iconUse[a.iconPath] > 1) };
          apps.push({
            id: a.id,
            name: a.name,
            show: !!a.show,
            packageId: a.packageId || null,
            iconPath: a.iconPath || null,
            categories: a.categories || []
          });
        }
        send(res, 200, { count: apps.length, apps: apps });
      }, function (e) { fail(res, e); });
    } catch (e) {
      fail(res, e);
    }
  },

  // /restprobe?ids=a,b: which IDs the TV's REST service recognizes, per app.
  '/restprobe': function (req, res, query) {
    var ids = String(query.ids || '').split(',').filter(function (x) { return /^[A-Za-z0-9_.-]{2,80}$/.test(x); }).slice(0, 8);
    var out = [];
    (function nextApp(a) {
      if (a >= ids.length) return send(res, 200, { apps: out });
      var cands = restCandidates(ids[a]), row = { id: ids[a], tried: [] };
      (function next(i) {
        if (i >= cands.length) { out.push(row); return nextApp(a + 1); }
        restGet(cands[i], function (status, j) {
          row.tried.push(cands[i] + '=' + status + (j && typeof j.visible === 'boolean' ? (j.visible ? ' visible' : ' hidden') : ''));
          next(i + 1);
        });
      })(0);
    })(0);
  },

  // Return-to-Lumen status, for Diagnostics.
  '/watch': function (req, res) {
    send(res, 200, { watching: watch ? { id: watch.id, seen: watch.seen } : null, log: watchLog });
  },

  '/launch': function (req, res, query) {
    if (!hasTizen()) return send(res, 503, { error: 'tizen API not available in service' });
    if (!query.id) return send(res, 400, { error: 'missing id' });
    try {
      tizen.application.launch(String(query.id), function () {
        // ?back=<TizenBrew id>: come back to Lumen when this app closes.
        if (query.back) startWatch(String(query.id), String(query.back));
        send(res, 200, { ok: true, id: query.id, watching: !!watch });
      }, function (e) { fail(res, e); });
    } catch (e) {
      fail(res, e);
    }
  },

  // Alternative launch path. Some system apps (e.g. source/input apps) only
  // respond to an app-control request, not a plain launch.
  // Input sources (HDMI etc.) via the TV's own APIs. tvwindow needs a privilege
  // TizenBrew's service may not have; this route reports what's available.
  '/sources': function (req, res) {
    if (!hasTizen()) return send(res, 503, { error: 'tizen API not available in service' });
    var out = {
      tvwindow: !!(tizen.tvwindow && tizen.tvwindow.setSource),
      systeminfo: !!(tizen.systeminfo && tizen.systeminfo.getPropertyValue),
      current: null, connected: [], disconnected: [], error: null
    };
    try { if (out.tvwindow) out.current = tizen.tvwindow.getSource('MAIN'); } catch (e) { out.currentError = errText(e); }
    if (!out.systeminfo) return send(res, 200, out);
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', guard(function (vs) {
        function pick(list) {
          var r = [];
          for (var i = 0; list && i < list.length; i++) r.push({ type: list[i].type, number: list[i].number, name: list[i].editName || null });
          return r;
        }
        out.connected = pick(vs && vs.connected);
        out.disconnected = pick(vs && vs.disconnected);
        send(res, 200, out);
      }, function (e) { out.error = errText(e); send(res, 200, out); }), guard(function (e) {
        out.error = errText(e);
        send(res, 200, out);
      }));
    } catch (e) {
      out.error = errText(e);
      send(res, 200, out);
    }
  },

  // /setsource?type=HDMI&number=1[&viewer=1]
  '/setsource': function (req, res, query) {
    if (!hasTizen()) return send(res, 503, { error: 'tizen API not available in service' });
    if (!(tizen.tvwindow && tizen.tvwindow.setSource)) return send(res, 501, { error: 'tvwindow API not available in the service' });
    var type = String(query.type || 'HDMI').toUpperCase();
    var number = parseInt(query.number, 10);
    if (!/^[A-Z_]{2,16}$/.test(type) || !(number >= 1 && number <= 8)) return send(res, 400, { error: 'bad type or number' });
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', guard(function (vs) {
        var all = [].concat((vs && vs.connected) || [], (vs && vs.disconnected) || []);
        var src = null;
        for (var i = 0; i < all.length; i++) if (all[i].type === type && all[i].number === number) src = all[i];
        if (!src) return send(res, 404, { error: type + ' ' + number + ' not found on this TV' });
        tizen.tvwindow.setSource(src, guard(function () {
          if (query.viewer !== '1') return send(res, 200, { ok: true, type: type, number: number });
          tizen.application.launch('org.tizen.tv-viewer', function () {
            send(res, 200, { ok: true, type: type, number: number, viewer: true });
          }, function (e) { send(res, 200, { ok: true, type: type, number: number, viewerError: errText(e) }); });
        }, function (e) { send(res, 500, { error: errText(e) }); }), guard(function (e) {
          send(res, 500, { error: 'setSource: ' + errText(e) });
        }), 'MAIN');
      }, function (e) { send(res, 500, { error: errText(e) }); }), guard(function (e) {
        send(res, 500, { error: 'VIDEOSOURCE: ' + errText(e) });
      }));
    } catch (e) {
      fail(res, e);
    }
  },

  '/appcontrol': function (req, res, query) {
    if (!hasTizen()) return send(res, 503, { error: 'tizen API not available in service' });
    if (!query.id) return send(res, 400, { error: 'missing id' });
    try {
      var op = String(query.op || 'http://tizen.org/appcontrol/operation/default');
      // Optional data, e.g. data=source:HDMI1|mode:show for the XD Input helper.
      var data = [];
      if (query.data) {
        var pairs = String(query.data).split('|');
        if (pairs.length > 8) return send(res, 400, { error: 'too many data pairs' });
        for (var i = 0; i < pairs.length; i++) {
          var kv = /^([A-Za-z0-9_]{1,32}):([A-Za-z0-9_.-]{0,64})$/.exec(pairs[i]);
          if (!kv) return send(res, 400, { error: 'bad data pair: ' + pairs[i] });
          data.push(new tizen.ApplicationControlData(kv[1], [kv[2]]));
        }
      }
      var ctl = new tizen.ApplicationControl(op, query.uri ? String(query.uri) : null, null, null, data.length ? data : null);
      tizen.application.launchAppControl(ctl, String(query.id), function () {
        send(res, 200, { ok: true, id: query.id, op: op, data: query.data || null });
      }, function (e) { fail(res, e); }, null);
    } catch (e) {
      fail(res, e);
    }
  },

  '/icon': function (req, res, query) {
    var raw = String(query.path || '');
    var path = raw.replace(/^file:\/\//, '');
    if (!allowedIcons[raw] && !allowedIcons[path] && !allowedIcons['file://' + path]) {
      return send(res, 403, { error: 'icon not allowed' });
    }
    fs.readFile(path, function (e, data) {
      if (e) return send(res, 404, { error: 'not found' });
      var type = /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';
      res.writeHead(200, {
        'Content-Type': type,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=86400'
      });
      res.end(data);
    });
  }
};

module.exports = { version: VERSION, routes: routes };
