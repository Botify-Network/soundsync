# SoundSync by Botify

<p align="center">
  <img src="assets/brand/SoundSync_transparent_banner_trimmed.png" alt="SoundSync by Botify" width="640"/>
</p>

<p align="center">
  <a href="https://github.com/Botify-Network/soundsync/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Botify-Network/soundsync?display_name=tag&sort=semver"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20x64-0078d6">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-Electron%2028-2b2e3a">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-22c55e">
  <img alt="Governance" src="https://img.shields.io/badge/governed%20by-Botify-8a5cff">
</p>

**SoundSync by Botify** — Windows Electron tray app that auto-syncs SoundCloud likes and playlists to a local folder using **yt-dlp** + **ffmpeg**.

> Previously released as *SoundCloud Auto Sync / SC Auto Downloader*. Rebranded to **SoundSync** in v2.0.6.

**Current version:** v2.0.7

---

## Contents

- [What it does](#what-it-does)
- [Install / update](#install--update)
- [Basic usage](#basic-usage)
- [Update controls](#update-controls)
- [Architecture](#architecture)
- [Security](#security)
- [Developer setup](#developer-setup)
- [Troubleshooting](#troubleshooting)
- [CLI](#cli)
- [Brand assets](#brand-assets)
- [Project links](#project-links)
- [License](#license)

---

## What it does

- Runs in the system tray; no foreground window required.
- Monitors a list of SoundCloud usernames (their public likes) and playlist URLs.
- On an interval, fetches new tracks and downloads them as MP3 with embedded metadata + artwork.
- One-off **Download URL...** entry point for any SoundCloud track or playlist.
- Tray menu surfaces status (Syncing / Idle / Error), last-sync time, and download count.
- Auto-update via GitHub Releases through `electron-updater` (configurable — see [Update controls](#update-controls)).

## Install / update

Install via the released NSIS installer published on GitHub:

- Releases: https://github.com/Botify-Network/soundsync/releases
- Latest release: see the **Latest release** badge above.

### Auto-updater artifact requirement

`electron-updater` only detects an update when the target GitHub Release has **both** the packaged installer **and** the manifest attached:

- `SoundSync Setup <version>.exe` — NSIS installer produced by `electron-builder`
- `latest.yml` — manifest `electron-updater` reads

A notes-only release (tag + body, no binaries) **will not be detected** by installed clients. See [`docs/deployment.md`](docs/deployment.md) for the full release flow.

## Basic usage

1. Launch the app (it minimizes to the tray; double-click the tray icon to open Settings).
2. **Downloads** page → choose a download folder.
3. **Monitoring** page → add SoundCloud usernames (their `/likes` are followed) and/or full playlist URLs (must contain `/sets/`).
4. Toggle **Auto-sync on launch** in **Startup** to begin monitoring immediately on app start.
5. Set **Sync interval** (default 15 min).
6. **Sync Now** from the tray menu or footer button forces an immediate sync.

See [`docs/operator.md`](docs/operator.md) for the full tray + settings walkthrough.

## Update controls

Settings → Startup / App Updates card:

| Setting | Default | Effect |
|---|---|---|
| **Check for updates automatically** | on | Startup check + background download via `electron-updater` |
| **Install updates on next restart** | on | Apply downloaded update silently when app quits. Off = wait for explicit "Install now" |
| **Check for updates** (button) | n/a | Manual on-demand check; works regardless of the auto-check toggle |
| **Install now** (button) | n/a | Triggers `quitAndInstall()` when a downloaded update is pending |

Update errors surface as tray balloons.

## Architecture

```
┌─ Tray menu ────────┐    ┌─ Settings window (Electron renderer) ─┐
│ Status / Sync Now  │    │  Dashboard · Downloads · Monitoring   │
│ Pause / Auto-Sync  │    │  Engine · Diagnostics                 │
└─────────┬──────────┘    └────────────────┬──────────────────────┘
          │                                │
          │   IPC (contextIsolation: true) │
          └────────────────┬───────────────┘
                           │
                  ┌────────▼──────────────────────────────────────┐
                  │ Electron main (src/main.js)                   │
                  │ · Lifecycle · Tray · IPC handlers · Updater   │
                  │ · electron-store settings                     │
                  └──┬──────────────┬─────────────────┬───────────┘
                     │              │                 │
        ┌────────────▼──┐  ┌────────▼─────────┐  ┌────▼──────────────────┐
        │ services/     │  │ services/        │  │ services/paths.js      │
        │ downloader.js │  │ soundcloud-      │  │ (yt-dlp / ffmpeg path  │
        │ (queue +      │  │ monitor.js       │  │  resolution: bundled   │
        │  rate-limit + │  │ (sync loop +     │  │  resources/ → PATH     │
        │  encode)      │  │  URL validation) │  │  fallback)             │
        └────────┬──────┘  └────────┬─────────┘  └────┬───────────────────┘
                 │                  │                 │
                 └──────────────────┴─────┬───────────┘
                                          │
                              ┌───────────▼──────────────┐
                              │ Bundled tools            │
                              │ resources/yt-dlp.exe     │
                              │ resources/ffmpeg.exe     │
                              └──────────────────────────┘
```

Full architecture details: [`docs/architecture.md`](docs/architecture.md).

## Security

Highlights (full policy in [`SECURITY.md`](SECURITY.md), full hardening notes in [`docs/security.md`](docs/security.md)):

- **Renderer XSS fix** — settings UI never injects user-supplied usernames / playlist URLs / titles via `innerHTML`. All list-item construction uses `createElement` + `textContent`.
- **Safer process execution** — main-process diagnostics and `fetch-playlist-metadata` (which receives a user-controlled URL) do not shell-interpolate. All `yt-dlp` and `ffmpeg` invocations use argv arrays via `spawn` / `execFile`.
- **CLI hardening** — `cli.js` shell-interpolated calls converted to `execFileSync` with argv arrays.
- **Rate-limit / network hardening** — `yt-dlp` calls pass `--retries 10`, `--retry-sleep http:exp=1:30`, `--socket-timeout 30`, `--sleep-requests 1`; 3-attempt app-level retry with 15s/30s/60s backoff; 90s queue cooldown on 429.
- **Configurable auto-updater** — checks, downloads, and install-on-quit can each be disabled.
- **Electron security** — `contextIsolation: true`, `nodeIntegration: false`, whitelisted preload bridge.

## Developer setup

```bash
npm install
npm start                  # launches Electron pointing at src/main.js
```

Requires `yt-dlp` and `ffmpeg` either bundled in `resources/` (preferred — picked up by `getYtDlpPath()` / `getFfmpegPath()`) or on `PATH`.

### Syntax checks (no test suite yet — see [#2](https://github.com/Botify-Network/soundsync/issues/2))

```bash
node --check src/main.js
node --check src/preload.js
node --check cli.js
node --check src/services/downloader.js
node --check src/services/soundcloud-monitor.js
```

### Build (Windows installer)

```bash
npm run build:win
```

- `prebuild` / `prebuild:win` auto-run `scripts/bump-version.js` (patch bump). To build without bumping, run `electron-builder --win` directly.
- Output goes to `dist/`. Both `SoundSync Setup <version>.exe` and `latest.yml` must be uploaded to the GitHub Release for the auto-updater to detect the new version.

### Version bump (manual)

```bash
npm run bump            # patch:  2.0.7 → 2.0.8
npm run bump:minor      # minor:  2.0.7 → 2.1.0
npm run bump:major      # major:  2.0.7 → 3.0.0
```

Full developer guide: [`docs/developer.md`](docs/developer.md).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sync stalls, no new downloads | SoundCloud rate-limit (429) | App auto-applies 90s queue cooldown + 3-attempt backoff. Wait or reduce monitored sources. |
| `yt-dlp not found` in diagnostics | Bundled `resources/yt-dlp.exe` missing and not on `PATH` | Install yt-dlp globally or restore the bundled binary. |
| `ffmpeg not found` in diagnostics | Same as above for ffmpeg. | Install ffmpeg globally or restore the bundled binary. |
| Auto-updater never finds new version | Release missing `latest.yml` or `SoundSync Setup <version>.exe` | Re-upload both artifacts to the release; see [auto-updater artifact requirement](#auto-updater-artifact-requirement). |
| Google Drive File Stream download path errors | Drive virtual mount not present | Diagnostics now hints when `My Drive` is unavailable; mount Drive or pick a local folder. |
| Tray icon missing after install | App didn't acquire single-instance lock | Quit any existing SoundSync process, relaunch. |

Full guide: [`docs/troubleshooting.md`](docs/troubleshooting.md).

## CLI

`cli.js` provides a console interface independent of the Electron app:

```bash
node cli.js test        # diagnostics
node cli.js config      # interactive configure
node cli.js settings    # show current config
node cli.js sync        # run a sync now
node cli.js install     # install deps + check bundled tools
node cli.js gui         # launch the Electron app
```

> ⚠️ The CLI maintains its own config at `%APPDATA%\soundsync\config.json` (separate from the Electron app's `electron-store`). It reads the legacy `%APPDATA%\soundcloud-auto-sync\config.json` if the new path doesn't exist. **The CLI's `sync` path does not yet share the rate-limit hardening that the Electron sync uses** — tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2).

## Brand assets

Local brand pack lives in [`assets/brand/`](assets/brand/) and is governed by the Botify design tokens. Runtime assets used by the app:

- `SoundSync_app_icon_{64,128,256,512}.png` — app icon (rounded-square master with radar rings)
- `SoundSync_badge_orb_512.png` — circular badge variant
- `SoundSync_sidebar_logo_{128,256,512}.png` — sharpened sidebar mark (minimal style, optimized for small render)
- `SoundSync_favicon_{16,32}.png` — favicon set
- `SoundSync_taskbar_icon.ico` — multi-size Windows .ico (16/32/48/64/128/256)
- `SoundSync_transparent_banner_{2048x682,trimmed}.png` — README / about banner

Source 1254×1254 masters and the runtime contact sheet live in [`design/soundsync-template-review/`](design/soundsync-template-review/).

## Project links

- **Repository:** https://github.com/Botify-Network/soundsync
- **Releases:** https://github.com/Botify-Network/soundsync/releases
- **Issues:** https://github.com/Botify-Network/soundsync/issues
- **Docs initiative:** [#1](https://github.com/Botify-Network/soundsync/issues/1)
- **Engineering cleanup initiative:** [#2](https://github.com/Botify-Network/soundsync/issues/2)
- **Governance hub (parent org):** Botify-Network/botify-network-site

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). All PRs require operator approval before merge. No deploys without explicit operator approval. No secrets in any commit, issue, comment, or attachment.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT — see [`package.json`](package.json).
