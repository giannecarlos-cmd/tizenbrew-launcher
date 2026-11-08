// XD Launcher service (TizenBrew "serviceFile").
//
// Why this exists: inside TizenBrew the launcher page is served from
// http://127.0.0.1:8081 and has no window.tizen. TizenBrew runs module services
// in a Node vm sandbox that DOES get the `tizen` object, so this file is a small
// local HTTP bridge the page calls with fetch().
//
// Environment limits:
//  - Tizen's service Node is old (TizenBrew targets Node 4.4.3): ES5 only.
//    No let/const, arrow functions, template strings or destructuring.
//  - TizenBrew fetches this file from jsDelivr and evaluates it as one script,
//    so only built-in Node modules (http, fs, url) can be used.

var http = require('http');
var fs = require('fs');
var url = require('url');

var PORT = 8190; // TizenBrew uses 8081, TizenTube uses 8085/8095
var VERSION = '0.1.0';

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

var routes = {
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

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var handler = routes[parsed.pathname];
  if (!handler) return send(res, 404, { error: 'unknown route' });
  try {
    handler(req, res, parsed.query || {});
  } catch (e) {
    fail(res, e);
  }
});

// If a previous instance is still listening (module reopened), stay quiet.
server.on('error', function (e) {
  console.log('[xd-launcher-service] ' + (e && e.code));
});

// Loopback only: this API must not be reachable from other devices on the network.
server.listen(PORT, '127.0.0.1');
