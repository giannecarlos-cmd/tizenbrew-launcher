# XD Launcher (TizenBrew module)

A clean, ad-free launcher for Samsung Tizen TVs, built as a [TizenBrew](https://github.com/reisxd/TizenBrew) app module.

Target TV: Samsung QN75Q8DTAFXZC (2024 Q80D), Tizen 8.0.

## Status

**v0.4.0 — diagnostics, self-updating.** Shows every matching app per launcher tile, keeps an on-screen launch log, and can test an alternative app-control launch (Red). Used to confirm app IDs and launch behavior before the real UI is built.

## Install on the TV

1. Open TizenBrew → Module Manager → Add GitHub module.
2. Enter `giannecarlos-cmd/tizenbrew-launcher@v0.4.0` (pinned tag; it updates itself from there).
3. Optional: Settings → Autolaunch → XD Launcher.

## How updates work

The pinned tag only holds two stable bootstraps. On each launch `app/launcher.html` asks GitHub for the newest commit on `main` and loads the screen from that exact commit on jsDelivr, then tells the service to load `service/core.js` from the same commit. Commit URLs are immutable, so caches can't serve stale code. If GitHub is unreachable it uses the last known commit, then the pinned copy.

## Layout

- `package.json` — TizenBrew module manifest (`packageType: app`).
- `app/launcher.html` — tiny stable loader, served by TizenBrew at `127.0.0.1:8081`. It never changes, so the TV's web cache can't hold back updates.
- `app/body.html`, `app/main.css`, `app/main.js` — the real screen, loaded with a unique query string on every launch.
- `service/service.js` — stable Node bootstrap (ES5, Node 4) on `127.0.0.1:8190`: `/ping`, `/boot?ref=<sha>`.
- `service/core.js` — the routes that bridge the page to the `tizen` API: `/info`, `/apps`, `/launch?id=`, `/appcontrol?id=`, `/icon?path=`.

## Remote keys (diagnostics screen)

- Arrows: move · OK: launch · Back: return to TizenBrew · Red: app-control launch · Yellow: show hidden apps · Blue: reload
