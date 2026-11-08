# XD Launcher (TizenBrew module)

A clean, ad-free launcher for Samsung Tizen TVs, built as a [TizenBrew](https://github.com/reisxd/TizenBrew) app module.

Target TV: Samsung QN75Q8DTAFXZC (2024 Q80D), Tizen 8.0.

## Status

**v0.2.0 — diagnostics.** Shows every matching app per launcher tile, keeps an on-screen launch log, and can test an alternative app-control launch (Red). Used to confirm app IDs and launch behavior before the real UI is built.

## Install on the TV

1. Open TizenBrew → Module Manager → Add GitHub module.
2. Enter `giannecarlos-cmd/tizenbrew-launcher`.
3. Optional: Settings → Autolaunch → XD Launcher.

To load an update right away, purge the jsDelivr cache for package.json, app/index.html and service/service.js.

## Layout

- `package.json` — TizenBrew module manifest (`packageType: app`).
- `app/index.html` — launcher page, served by TizenBrew at `127.0.0.1:8081`.
- `service/service.js` — Node service (ES5, Node 4) that bridges the page to the `tizen` API on `127.0.0.1:8190`: `/ping`, `/info`, `/apps`, `/launch?id=`, `/icon?path=`.

## Remote keys (diagnostics screen)

- Arrows: move · OK: launch · Red: app-control launch · Yellow: show hidden apps · Blue: reload
