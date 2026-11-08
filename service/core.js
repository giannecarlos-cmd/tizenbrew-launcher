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

var VERSION = '0.4.0';

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
