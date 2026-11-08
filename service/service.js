// XD Launcher service bootstrap (TizenBrew "serviceFile").
//
// Why this exists: inside TizenBrew the launcher page is served from
// http://127.0.0.1:8081 and has no window.tizen. TizenBrew runs module services
// in a Node vm sandbox that DOES get the `tizen` object, so the service is a
// small local HTTP bridge the page calls with fetch().
//
// Self-updating: this bootstrap is pinned with the module's version tag and
// never needs to change. The page resolves the newest commit on GitHub and
// calls /boot?ref=<sha>; the bootstrap then downloads service/core.js from that
// exact commit on jsDelivr (immutable URL, so no stale caches) and swaps in its
// routes. If no ref arrives, the core from the pinned tag is used.
//
// Environment limits:
//  - Tizen's service Node is old (TizenBrew targets Node 4.4.3): ES5 only.
//    No let/const, arrow functions, template strings or destructuring.
//  - TizenBrew fetches this file from jsDelivr and evaluates it as one script,
//    so only built-in Node modules can be used.

var http = require('http');
var https = require('https');
var url = require('url');
var vm = require('vm');

var PORT = 8190; // TizenBrew uses 8081, TizenTube uses 8085/8095
var BOOT_VERSION = '1';
var REPO = 'giannecarlos-cmd/tizenbrew-launcher';
var CDN = 'https://cdn.jsdelivr.net/gh/' + REPO + '@';

var core = null;      // { version, routes }
var coreRef = null;   // commit sha or tag the core came from
var loading = {};     // ref -> [callbacks] while a download is in flight
var lastError = null;

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', // page lives on port 8081
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function errText(e) {
  if (!e) return 'unknown error';
  if (e.name || e.message) return (e.name || 'Error') + ': ' + (e.message || '');
  return String(e);
}

// Commit shas, tags like v0.3.0, or branch names only. Nothing that could
// change the CDN path.
function validRef(ref) {
  return typeof ref === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(ref);
}

function download(target, cb, redirects) {
  https.get(target, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 3) {
      res.resume();
      return download(url.resolve(target, res.headers.location), cb, (redirects || 0) + 1);
    }
    if (res.statusCode !== 200) {
      res.resume();
      return cb(new Error('HTTP ' + res.statusCode + ' for ' + target));
    }
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () { cb(null, Buffer.concat(chunks).toString('utf8')); });
  }).on('error', function (e) { cb(e); });
}

function loadCore(ref, cb) {
  if (core && coreRef === ref) return cb(null);
  if (loading[ref]) { loading[ref].push(cb); return; }
  loading[ref] = [cb];
  function done(err) {
    var cbs = loading[ref];
    delete loading[ref];
    if (err) lastError = errText(err);
    for (var i = 0; i < cbs.length; i++) cbs[i](err);
  }
  download(CDN + ref + '/service/core.js', function (err, script) {
    if (err) return done(err);
    try {
      // Only pass globals that exist here; TizenBrew's sandbox may omit some.
      var sandbox = { require: require, console: console, Buffer: Buffer, module: { exports: {} } };
      if (typeof tizen !== 'undefined') sandbox.tizen = tizen;
      if (typeof setTimeout !== 'undefined') sandbox.setTimeout = setTimeout;
      if (typeof clearTimeout !== 'undefined') sandbox.clearTimeout = clearTimeout;
      vm.runInNewContext(script, sandbox);
      var mod = sandbox.module.exports;
      if (!mod || !mod.routes) throw new Error('core.js did not export routes');
      core = mod;
      coreRef = ref;
      lastError = null;
      done(null);
    } catch (e) {
      done(e);
    }
  });
}

// Used only when the page could not resolve a commit (e.g. GitHub unreachable).
var FALLBACK_REF = 'main';

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var query = parsed.query || {};
  var path = parsed.pathname;

  if (path === '/boot') {
    var ref = validRef(query.ref) ? query.ref : FALLBACK_REF;
    return loadCore(ref, function (err) {
      if (err && !core) return send(res, 502, { error: errText(err), ref: ref });
      send(res, 200, {
        ok: !err, bootVersion: BOOT_VERSION, coreVersion: core && core.version,
        coreRef: coreRef, error: err ? errText(err) : null
      });
    });
  }

  if (path === '/ping') {
    return send(res, 200, {
      ok: true, bootVersion: BOOT_VERSION, version: core ? core.version : null,
      coreRef: coreRef, tizen: typeof tizen !== 'undefined' && !!tizen, lastError: lastError
    });
  }

  function dispatch() {
    var handler = core && core.routes[path];
    if (!handler) return send(res, 404, { error: 'unknown route' });
    try {
      handler(req, res, query);
    } catch (e) {
      send(res, 500, { error: errText(e) });
    }
  }

  // A request arrived before the page sent /boot: load the fallback core first.
  if (!core) {
    return loadCore(FALLBACK_REF, function (err) {
      if (err) return send(res, 503, { error: 'service core not loaded: ' + errText(err) });
      dispatch();
    });
  }
  dispatch();
});

// If a previous instance is still listening (module reopened), stay quiet.
server.on('error', function (e) {
  console.log('[xd-launcher-service] ' + (e && e.code));
});

// Loopback only: this API must not be reachable from other devices on the network.
server.listen(PORT, '127.0.0.1');
