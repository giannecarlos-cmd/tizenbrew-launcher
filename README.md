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
- `service/core.js` — the routes that bridge the page to the `tizen` API: `/info`, `/apps`, `/launch?id=`, `/appcontrol?id=`, `/icon?path=`, `/sources` and `/setsource?type=HDMI&number=N` (input switching via tvwindow, when the service has it), and `/key?keys=KEY_HDMI` (remote button presses through the TV's local remote-control service; the first use shows an Allow prompt on the TV).

## Remote keys (diagnostics screen)

- Arrows: move · OK: launch · Back: return to TizenBrew · Red: app-control launch · Yellow: show hidden apps · Blue: reload

## XD Input helper (`helper/`)

TizenBrew's service can't switch inputs (the TV's `tvwindow` API needs an app with its own window and the `tv.window` privilege), and the TV refuses remote-control connections from on-device apps. `helper/xd-input` is a tiny packaged app that does only that: opened with app-control data `source=HDMI1` and `mode=viewer|exit|show` it switches and gets out of the way; opened from the Apps list it shows a test screen.

Build: pushing changes under `helper/xd-input/` runs `.github/workflows/sign-helper.yml`, which signs the app with Tizen Studio's CLI and the public Tizen developer and distributor certificates (as TizenBrew's own builds are) and commits `helper/dist/XDInput-signed.wgt` (old distributor cert) and `XDInput-signed-new.wgt` (new). This TV reports platform 5.5 to the installer, so the installer does not re-sign; an unsigned package fails with "Check certificate error". Install: TizenBrew Installer → Select file to install. Developer Mode's Host PC IP must point at the PC during the install, then back to `127.0.0.1`.
