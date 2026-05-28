# Developer guide

## Requirements

- Node.js 18+
- npm 9+
- `yt-dlp.exe` and `ffmpeg.exe` either bundled in `resources/` (preferred) or on `PATH`
- Windows for full build target (`electron-builder --win` produces NSIS installer)

## Setup

```bash
git clone https://github.com/Botify-Network/soundsync.git
cd soundsync
npm install
npm start
```

`npm start` launches Electron with `src/main.js` as the entry point. The settings window appears when you click the tray icon (default startup hides the window).

## Repo layout

```
soundsync/
├── src/
│   ├── main.js                       # Electron main process (lifecycle, tray, IPC, updater)
│   ├── preload.js                    # contextIsolation IPC bridge
│   ├── preload-input.js              # tiny preload for the one-off URL input dialog
│   ├── settings.html                 # Renderer markup + CSS + inline script
│   ├── services/
│   │   ├── downloader.js             # Download queue, rate-limit handling, MP3 encode
│   │   ├── soundcloud-monitor.js     # Periodic sync loop + URL validation
│   │   └── paths.js                  # yt-dlp / ffmpeg path resolution (bundled → PATH)
│   └── assets/brand/                 # Renderer-resolvable runtime PNGs (mirror)
├── cli.js                            # Standalone CLI (separate config store)
├── scripts/
│   ├── bump-version.js               # Patch/minor/major version bumper
│   └── verify-release-artifacts.js   # Pre-release artifact sanity check
├── assets/brand/                     # Brand pack + source masters
├── design/soundsync-template-review/ # ZIP-derived design boards + contact sheet
├── resources/                        # Bundled yt-dlp.exe / ffmpeg.exe (gitignored)
├── dist/                             # electron-builder output (gitignored)
├── electron-builder.yml              # NSIS / updater config
├── docs/                             # This documentation set
├── package.json
├── README.md
├── CHANGELOG.md
├── SECURITY.md
└── CONTRIBUTING.md
```

## Syntax checks

There is no formal test suite yet (tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2)). Use:

```bash
node --check src/main.js
node --check src/preload.js
node --check cli.js
node --check src/services/downloader.js
node --check src/services/soundcloud-monitor.js
```

For the inline renderer script:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('src/settings.html','utf8');const m=h.match(/<script[^>]*>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('OK')"
```

## Build

```bash
npm run build:win
```

This runs:

1. `prebuild` → `scripts/bump-version.js` (patch bump, updates `package.json` + version display in `src/settings.html`).
2. `electron-builder --win` → produces `dist/SoundSync Setup <version>.exe` + `dist/latest.yml`.

To build without bumping, run `npx electron-builder --win` directly.

## Version bump

```bash
npm run bump            # patch:  2.0.7 → 2.0.8
npm run bump:minor      # 2.0.7 → 2.1.0
npm run bump:major      # 2.0.7 → 3.0.0
```

## IPC contract

The preload bridge (`src/preload.js`) exposes a whitelist on `window.api`. All IPC channels:

| Channel | Direction | Purpose |
|---|---|---|
| `get-settings` | renderer → main | Request current settings |
| `settings-data` | main → renderer | Settings payload |
| `save-settings` | renderer → main | Persist updated settings |
| `settings-saved` | main → renderer | Save acknowledgment |
| `get-status` | renderer → main | Request status snapshot |
| `status-data` | main → renderer | Status payload (counters + activity) |
| `choose-folder` | renderer → main | Open folder picker |
| `folder-chosen` | main → renderer | Selected path |
| `test-sync` | renderer → main | Trigger sync |
| `test-sync-complete` | main → renderer | Sync result |
| `fetch-playlist-metadata` | renderer → main | Resolve playlist title/uploader |
| `playlist-metadata-result` | main → renderer | Metadata or error |
| `run-diagnostics` | renderer → main | Run system tests |
| `diagnostic-update` | main → renderer | Per-test progress |
| `diagnostic-complete` | main → renderer | Final pass/fail tally |
| `check-app-update` | renderer → main | Manual update check |
| `download-app-update` | renderer → main | Force download of available update |
| `install-app-update` | renderer → main | Trigger `quitAndInstall()` |
| `app-update-info` | main → renderer | Update info (version, available, error) |
| `app-update-download-started` | main → renderer | Download start confirmation |
| `check-ytdlp-update` | renderer → main | Check bundled yt-dlp version |
| `ytdlp-update-info` | main → renderer | Version + update-available |
| `update-ytdlp` | renderer → main | Trigger yt-dlp update |
| `ytdlp-update-progress` | main → renderer | Progress text |
| `ytdlp-update-result` | main → renderer | Final result |

Channels not in this list **must not** be added without a security review (see [`security.md`](security.md)).

## Brand asset pipeline

Sources: 1254×1254 PNG masters in [`design/soundsync-template-review/`](../design/soundsync-template-review/) (extracted from `SoundSync Template.zip`).

Generated runtime sizes via `System.Drawing` (Windows PowerShell):

- App icon: 64 / 128 / 256 / 512
- Badge orb: 512
- Sidebar logo: 128 / 256 / 512 (sharpened from minimal master)
- Favicon: 16 / 32
- Taskbar: 256 PNG + multi-size `.ico` (16/32/48/64/128/256)

Runtime PNGs are mirrored into `src/assets/brand/` so renderer file:// resolution works in both Electron `loadFile` and Launch preview.

Contact sheet: [`design/soundsync-template-review/runtime-icon-contact-sheet.png`](../design/soundsync-template-review/runtime-icon-contact-sheet.png).

## Common pitfalls

- **Forgetting to upload `latest.yml`** to the GitHub Release → installed clients never auto-update. See [`deployment.md`](deployment.md).
- **Adding `child_process` calls with shell interpolation** → reject in review. Use argv arrays via `spawn` / `execFile`.
- **Setting `innerHTML` from user-supplied strings** → reject in review. Use `createElement` + `textContent`.
- **Adding remote font/asset URLs** → reject. Everything must be local.
- **Breaking IPC channel names** → renderer + preload + main share literal strings; changes need all three sites updated.

See [`governance.md`](governance.md) for project-wide rules.
