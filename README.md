# XD Launcher (TizenBrew module)

A clean, ad-free launcher for Samsung Tizen TVs, built as a [TizenBrew](https://github.com/reisxd/TizenBrew) app module.

Target TV: Samsung QN75Q8DTAFXZC (2024 Q80D), Tizen 8.0.

## Status

**v0.1.0 — diagnostics.** Lists every installed app with its ID and icon, highlights the apps the launcher will use, and launches any app with OK. Used to confirm app IDs and launch permissions before the real UI is built.

## Install on the TV

1. Open TizenBrew → Module Manager → Add GitHub module.
2. Enter `giannecarlos-cmd/tizenbrew-launcher@v0.1.0`.
3. Optional: Settings → Autolaunch → XD Launcher.

Pin a version tag: jsDelivr caches branches for hours, so new releases get a new tag.

## Layout

- `package.json` — TizenBrew module manifest (`packageType: app`).
- `app/index.html` — launcher page, served by TizenBrew at `127.0.0.1:8081`.
- `service/service.js` — Node service (ES5, Node 4) that bridges the page to the `tizen` API on `127.0.0.1:8190`: `/ping`, `/info`, `/apps`, `/launch?id=`, `/icon?path=`.

## Remote keys (diagnostics screen)

- Arrows: move · OK: launch · Yellow: show hidden apps · Blue: reload
