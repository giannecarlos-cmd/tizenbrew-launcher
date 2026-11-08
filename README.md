# XD Launcher (TizenBrew module)

A clean, ad-free launcher for Samsung Tizen TVs, built as a [TizenBrew](https://github.com/reisxd/TizenBrew) app module.

Target TV: Samsung QN75Q8DTAFXZC (2024 Q80D), Tizen 8.0.

## Status

**v0.3.0 — diagnostics.** Shows every matching app per launcher tile, keeps an on-screen launch log, and can test an alternative app-control launch (Red). Used to confirm app IDs and launch behavior before the real UI is built.

## Install on the TV

1. Open TizenBrew → Module Manager → Add GitHub module.
2. Enter `giannecarlos-cmd/tizenbrew-launcher`.
3. Optional: Settings → Autolaunch → XD Launcher.

To load an update right away, purge the jsDelivr cache for the changed files (purge.jsdelivr.net/gh/giannecarlos-cmd/tizenbrew-launcher/<file>), then restart the TV if the service changed.

## Layout

- `package.json` — TizenBrew module manifest (`packageType: app`).
- `app/launcher.html` — tiny stable loader, served by TizenBrew at `127.0.0.1:8081`. It never changes, so the TV's web cache can't hold back updates.
- `app/body.html`, `app/main.css`, `app/main.js` — the real screen, loaded with a unique query string on every launch.
- `service/service.js` — Node service (ES5, Node 4) that bridges the page to the `tizen` API on `127.0.0.1:8190`: `/ping`, `/info`, `/apps`, `/launch?id=`, `/appcontrol?id=`, `/icon?path=`.

## Remote keys (diagnostics screen)

- Arrows: move · OK: launch · Red: app-control launch · Yellow: show hidden apps · Blue: reload
