# Operator guide

## Install

Download the latest installer from [Releases](https://github.com/Botify-Network/soundsync/releases) and run it. The NSIS installer registers the app, places a tray icon on launch, and writes user data under `%APPDATA%\SoundSync`.

If you previously ran the pre-rebrand build, settings are migrated automatically from `%APPDATA%\soundcloud-auto-sync` on first launch.

## First run

1. Tray icon appears. Click it to open Settings.
2. **Downloads** → pick a download folder. Google Drive File Stream paths are supported (the app detects when the virtual mount is not present and shows a diagnostic hint).
3. **Monitoring** → add SoundCloud sources:
   - **Users**: enter a SoundCloud username; their public `/likes` feed is monitored.
   - **Playlists**: paste a full SoundCloud playlist URL (must contain `/sets/`).
4. **Startup** → enable **Auto-sync on launch** if you want sync to start with the app.
5. **Startup** → set **Sync interval** (default 15 minutes; range 5–1440).

## Tray menu

| Item | Effect |
|---|---|
| Status / Connection / Sync / Downloaded | Read-only counters and last-sync time |
| Download URL... | One-off prompt for any SoundCloud track/playlist URL |
| Sync Now | Force immediate sync |
| Pause Syncing / Resume Syncing | Toggle while auto-sync is enabled |
| Settings | Open the settings window |
| Auto-Sync: ON/OFF | Toggle background sync |
| Open Download Folder | Open the configured download folder in Explorer |
| Exit | Quit the app |

## Settings pages

- **Dashboard** — three metric cards (Downloads / Last Sync / Monitoring), Quick Actions, Active Sources, Sync Health chips.
- **Downloads** — download folder, sync interval, skip-thumbnail toggle, startup toggles, app-update controls.
- **Monitoring** — Quick Follow presets, Monitored Users list, Monitored Playlists list.
- **Engine** — yt-dlp version + update button.
- **Diagnostics** — run-all system test: yt-dlp engine, ffmpeg, write permissions, SoundCloud connection.

## Updating the app

`electron-updater` checks GitHub Releases on startup (if **Check for updates automatically** is on). When an update is found:

- It downloads in the background.
- If **Install updates on next restart** is on, the update applies silently when you quit.
- Otherwise, click **Install now** in the **App Updates** card.

Manual check: **Check for updates** button (works regardless of auto-check toggle).

For details on what artifacts a release must include, see [`deployment.md`](deployment.md).

## CLI

For headless or batch use, `cli.js` provides:

```bash
node cli.js test        # diagnostics
node cli.js config      # interactive configure
node cli.js settings    # show current config
node cli.js sync        # run a sync now
node cli.js install     # install deps + check bundled tools
node cli.js gui         # launch the Electron app
```

⚠️ The CLI's `sync` path does not yet share the rate-limit hardening that the Electron sync uses. Tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2).

## Where data lives

- Settings (Electron): `%APPDATA%\SoundSync\config.json` (via `electron-store`).
- Settings (CLI): `%APPDATA%\soundsync\config.json` (separate from Electron store).
- Logs: stderr only (no persistent log file).
- Downloaded tracks: the folder you configured.

## Common questions

- **Will it download anything I don't already see in SoundCloud likes / the playlist?** No. The monitor only fetches what `yt-dlp` returns for the configured URL.
- **What if I rate-limit?** The app self-throttles. See [`troubleshooting.md`](troubleshooting.md).
- **Can I run it on macOS / Linux?** Not currently. The build target is Windows NSIS.
