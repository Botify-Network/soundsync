# Architecture

## Process model

```
┌────────────────────────────────────────────────────────────────┐
│                        Electron App                            │
│                                                                │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │ Tray (main)      │ ◄────►  │ Settings window (renderer)   │ │
│  │ - menu           │         │ - settings.html              │ │
│  │ - status         │         │ - inline <script>            │ │
│  │ - notifications  │         │ - contextIsolation: true     │ │
│  └────────┬─────────┘         └────────┬─────────────────────┘ │
│           │                            │                       │
│           │   IPC via preload bridge   │                       │
│           ▼                            ▼                       │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Main process (src/main.js)                             │    │
│  │ - Lifecycle, single-instance lock                      │    │
│  │ - electron-store (settings + sync history)             │    │
│  │ - electron-updater (GitHub Releases via broker)        │    │
│  │ - powerSaveBlocker during active operations            │    │
│  │ - SoundCloudMonitor + Downloader orchestration         │    │
│  │ - userData migration from legacy folder                │    │
│  └─────┬──────────────┬──────────────────────┬────────────┘    │
│        │              │                      │                 │
│        ▼              ▼                      ▼                 │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────┐       │
│  │ services │  │ services     │  │ services/paths.js   │       │
│  │ downloader│  │ soundcloud  │  │ resolve bundled →   │       │
│  │ .js      │  │ -monitor.js  │  │ PATH fallback       │       │
│  └────┬─────┘  └──────┬───────┘  └─────────┬───────────┘       │
│       │               │                    │                   │
│       └───────────────┴─────┬──────────────┘                   │
│                             ▼                                  │
│              ┌──────────────────────────────┐                  │
│              │ resources/yt-dlp.exe         │                  │
│              │ resources/ffmpeg.exe         │                  │
│              │ (or system PATH equivalents) │                  │
│              └─────────────┬────────────────┘                  │
│                            │                                   │
└────────────────────────────┼───────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ SoundCloud (HTTPS)   │
                  └──────────────────────┘
```

## Components

### Main process — `src/main.js`

- `app.setName('SoundSync')` runs **before** `app.whenReady()` so Windows uses the SoundSync name for taskbar grouping and userData. `app.setAppUserModelId('com.botify.soundsync')` for Win32 notification grouping.
- One-time userData migration from `%APPDATA%\soundcloud-auto-sync` → `%APPDATA%\SoundSync` on first launch after rebrand.
- Single-instance lock via `app.requestSingleInstanceLock()`. Second-instance launches focus the existing settings window.
- `runCmd(file, args, timeoutMs)` — argv-array spawn helper with timeout + stdout/stderr capture. Used for all `yt-dlp`/`ffmpeg` calls in the main process.
- `applyAutoUpdaterSettings()` — pulls current `autoUpdate` / `autoInstallOnQuit` toggles from `electron-store` onto the `electron-updater` singleton. Safe to call repeatedly.
- `appStatus` — runtime state object (operational flag, current activity, sync status, last sync, download count, pending update info). Surfaced to renderer via `status-data` IPC.
- Tray menu rebuilt on every status change via `updateTrayMenu()`.

### Renderer — `src/settings.html`

- Markup + CSS + inline `<script>` (the inline script extraction is tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2)).
- Uses Botify governance CSS token system (`--botify-*` vars in `:root`).
- All user-supplied strings inserted via `createElement` + `textContent`. Hardcoded HTML entities only for diagnostic icons.
- Communicates with main via `window.api.send/on/removeListener` whitelist exposed by `src/preload.js`.

### Preload — `src/preload.js`

- `contextIsolation: true` + `nodeIntegration: false`.
- Exposes only: `window.api.send(channel, payload)`, `window.api.on(channel, handler)`, `window.api.removeListener(channel, handler)`, `window.api.openPath(p)`, `window.api.getAppVersion()`.
- No `require`, no Node globals, no arbitrary IPC.

### Preload (input dialog) — `src/preload-input.js`

- Minimal preload for the one-off URL input window opened by the tray "Download URL..." action.

### Services

#### `src/services/downloader.js`

- Maintains a download queue with rate-limit detection.
- Every `yt-dlp` invocation passes the hardened argv set (`--retries 10`, `--retry-sleep`, `--socket-timeout`, `--sleep-requests`, `--sleep-interval`, `--max-sleep-interval`).
- App-level retry: 3 attempts with 15s / 30s / 60s backoff when a 429 is detected.
- Queue cooldown: 90s pause after detected rate-limit before next batch.
- `getFullMetadata` paces calls at 1.5s per track to avoid extractor throttling.
- MP3 encode + ID3 tag + artwork embed via `ffmpeg`.

#### `src/services/soundcloud-monitor.js`

- Periodic sync loop on configurable interval (default 15 min, range 5–1440).
- URL validation: usernames stripped to bare slug; playlist URLs must contain `/sets/`.
- Batch enqueues new tracks not present in the local sync history (tracked in `electron-store`).
- Emits status events consumed by `main.js` for tray + renderer updates.

#### `src/services/paths.js`

- `getYtDlpPath()` / `getFfmpegPath()` — resolve bundled `resources/*.exe` first, fall back to `PATH` lookup. Returns the absolute path or `null` if not found.

### CLI — `cli.js`

- Standalone Node CLI. Subcommands: `test`, `config`, `settings`, `sync`, `install`, `gui`.
- Maintains its own config at `%APPDATA%\soundsync\config.json` (reads legacy `%APPDATA%\soundcloud-auto-sync\config.json` if the new path doesn't exist yet).
- Uses `execFileSync` with argv arrays, no shell interpolation.
- ⚠️ Does **not** yet share full rate-limit hardening with the Electron path. Tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2).

## Boundaries

- The renderer cannot reach Node APIs. It can only invoke channels in the IPC whitelist (see [`developer.md`](developer.md) for the channel table).
- The main process never executes user-supplied strings via a shell.
- Services never call `electron-store` directly during sync hot paths; they receive settings from the orchestrator.

## State

- **electron-store** (`%APPDATA%\SoundSync\config.json`):
  - `downloadPath` (string)
  - `syncInterval` (number, minutes)
  - `autoStart` (bool — launch on Windows boot)
  - `autoSync` (bool — start syncing on app launch)
  - `skipThumbnail` (bool)
  - `autoUpdate` (bool)
  - `autoInstallOnQuit` (bool)
  - `monitoredUsers` (string[])
  - `monitoredPlaylists` (string[])
  - Sync history (internal, used by monitor to skip already-downloaded tracks)

- **CLI config** (`%APPDATA%\soundsync\config.json`):
  - Same shape, separate file. Synchronization between the two stores is a known gap.

## Auto-updater flow

1. Renderer or scheduled startup task fires `check-app-update`.
2. Main calls `autoUpdater.checkForUpdates()`.
3. `electron-updater` resolves the manifest from the broker URL configured in `electron-builder.yml` (`https://botify-network.com/downloads/soundsync/files`), which proxies to GitHub Releases.
4. If a newer version is found and `autoDownload` is on, download begins.
5. When download completes, main emits `update-downloaded`.
6. If `autoInstallOnQuit` is on, the update applies silently when the user quits.
7. Otherwise the renderer shows **Install now**, which calls `quitAndInstall()`.

For the release-side flow, see [`deployment.md`](deployment.md).
