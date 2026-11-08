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

var VERSION = '0.5.1';

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
  '/apps': function (req, res) {
    if (!hasTizen()) return send(res, 503, { error: 'tizen API not available in service' });
    try {
      tizen.application.getAppsInfo(function (list) {
        var self = '';
        try { self = tizen.application.getAppInfo().id; } catch (e) { /* no own id */ }
        allowedIcons = {};
        var apps = [];
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          if (a.id === self) continue;
          if (a.iconPath) allowedIcons[a.iconPath] = true;
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

  '/launch': function (req, res, query) {
    if (!hasTizen()) return send(res, 503, { error: 'tizen API not available in service' });
    if (!query.id) return send(res, 400, { error: 'missing id' });
    try {
      tizen.application.launch(String(query.id), function () {
        send(res, 200, { ok: true, id: query.id });
      }, function (e) { fail(res, e); });
    } catch (e) {
      fail(res, e);
    }
  },

  // Alternative launch path. Some system apps (e.g. source/input apps) only
  // respond to an app-control request, not a plain launch.
  '/appcontrol': function (req, res, query) {
    if (!hasTizen()) return send(res, 503, { error: 'tizen API not available in service' });
    if (!query.id) return send(res, 400, { error: 'missing id' });
    try {
      var op = String(query.op || 'http://tizen.org/appcontrol/operation/default');
      var ctl = new tizen.ApplicationControl(op, query.uri ? String(query.uri) : null);
      tizen.application.launchAppControl(ctl, String(query.id), function () {
        send(res, 200, { ok: true, id: query.id, op: op });
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
