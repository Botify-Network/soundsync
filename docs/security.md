# Security details

For reporting and policy see [`../SECURITY.md`](../SECURITY.md). This doc covers implementation details.

## Renderer hardening

### XSS — no user-supplied `innerHTML`

The settings UI must never inject user-supplied strings via `innerHTML`. Affected surfaces:

- Monitored users / playlists lists
- Active Sources card on Dashboard
- Playlist metadata titles fetched from `yt-dlp`
- Toast messages

All construction uses `document.createElement` + `textContent`. The helper `createListItem({ title, subtitle, ...})` in `src/settings.html` enforces this for list items.

`innerHTML` is used in **four** places, all safe:

- `usersList.innerHTML = ''` / `playlistsList.innerHTML = ''` — clearing only.
- `icon.innerHTML = '&#9673;'` etc. — hardcoded HTML entities for diagnostic icons.

Any new `innerHTML` assignment in the renderer must be reviewed for injection risk.

### Electron security

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox` not set explicitly — relies on contextIsolation + preload whitelist
- Preload (`src/preload.js`) exposes only:
  - `window.api.send(channel, payload)` — channel must be one of a hardcoded list
  - `window.api.on(channel, handler)` — same
  - `window.api.removeListener(channel, handler)`
  - `window.api.openPath(p)` — passes through to `shell.openPath`
  - `window.api.getAppVersion()` — returns `app.getVersion()`

Adding a new IPC channel requires:

1. Whitelist in `src/preload.js`.
2. Handler in `src/main.js`.
3. Renderer usage in `src/settings.html`.
4. Update [`developer.md`](developer.md) IPC channel table.

## Main process hardening

### No shell interpolation

All external commands go through `runCmd(file, args, timeoutMs)` (defined in `src/main.js`) or `execFileSync(file, args, opts)` (in `cli.js`). Both pass argv arrays — no shell.

Surfaces:

- `yt-dlp` calls in `src/services/downloader.js`
- `yt-dlp` calls in `src/services/soundcloud-monitor.js`
- `yt-dlp` version probe + update in `src/main.js`
- `ffmpeg` calls for MP3 encode / metadata embed
- Diagnostics probes (`yt-dlp --version`, `ffmpeg -version`)
- `fetch-playlist-metadata` IPC handler (receives renderer-supplied URL, passed straight to argv)
- CLI subcommands

### Argv validation

URLs from the renderer are not parsed/normalized in the main process before passing to `yt-dlp`. `yt-dlp` itself rejects non-SoundCloud URLs. Renderer-side validation (`url.includes('soundcloud.com') && url.includes('/sets/')` for playlists) is a UX filter, not a security boundary — the main process must remain safe regardless.

### Timeouts

Every `runCmd` call passes a timeout (default 30s). On timeout the spawned process receives `SIGTERM` and the promise rejects with stdout/stderr/code captured.

## Rate-limit hardening

`yt-dlp` argv for every call:

```
--retries 10
--retry-sleep http:exp=1:30
--retry-sleep extractor:5
--socket-timeout 30
--sleep-requests 1
--sleep-interval 2          (downloads only)
--max-sleep-interval 6      (downloads only)
```

App-level layer in `src/services/downloader.js`:

- 3 attempts with 15s / 30s / 60s backoff on detected rate-limit (`429`, "Too Many Requests", or "rate-limit reached" in stderr).
- 90s queue cooldown after a rate-limit detection before the next batch starts.
- `getFullMetadata` paces calls at 1.5s per track.

The CLI does **not** yet share this layer. Tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2).

## Auto-updater

- `electron-updater` reads `app-update.yml` (baked into the build).
- URL points to the `botify-network.com/downloads/soundsync/files` broker, not directly to GitHub. The broker proxies to the actual release artifacts.
- Three independent toggles control auto-update behavior:
  - `autoUpdate` — startup check + background download
  - `autoInstallOnAppQuit` — silent install when user quits
  - Manual **Check for updates** / **Install now** buttons regardless of the toggles
- Update verification: `electron-updater` checks the SHA512 in `latest.yml` against the downloaded installer. A mismatched installer is rejected.

## Bundled tools

`resources/yt-dlp.exe` and `resources/ffmpeg.exe` are NOT cryptographically verified by the app at runtime. Refreshing these binaries is the operator's responsibility — pull them from official upstream releases:

- yt-dlp: https://github.com/yt-dlp/yt-dlp/releases
- ffmpeg: https://www.gyan.dev/ffmpeg/builds/ (or another trusted distributor)

If a bundled tool fails to launch (corrupted, wrong arch, missing), the path resolver falls back to `PATH`.

## Data handling

- No telemetry. No remote logging. No analytics.
- Settings are stored locally as JSON via `electron-store` and (for the CLI) plain `fs.writeFileSync`.
- Downloaded tracks live in the operator-chosen folder.
- The app never uploads any user data.

## Out-of-scope threats

- Multi-user attacks on the same Windows account.
- Compromised OS or AV bypass.
- Supply-chain attacks on `yt-dlp` / `ffmpeg` upstream releases.
- Malicious SoundCloud URLs intended to exploit `yt-dlp` itself.

For these, rely on OS-level protections and keep `yt-dlp` updated via the in-app **Engine → Update yt-dlp** flow.
