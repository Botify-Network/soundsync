# Troubleshooting

## Symptom table

| Symptom | Likely cause | First fix |
|---|---|---|
| Sync stalls; no new downloads; "Rate limit detected" in tray | SoundCloud 429 | Wait. App auto-cools the queue 90s + retries 3× with 15s/30s/60s backoff. If persistent, reduce number of monitored sources or increase sync interval. |
| `yt-dlp not found` in Diagnostics | Bundled `resources/yt-dlp.exe` missing AND not on `PATH` | Install yt-dlp globally (`pip install yt-dlp` or download release) or restore the bundled binary. |
| `ffmpeg not found` in Diagnostics | Same as above for ffmpeg | Install ffmpeg globally or restore the bundled binary. |
| Diagnostics shows green but downloads silently fail | yt-dlp version too old for SoundCloud extractor changes | Settings → **Engine** → **Update yt-dlp**. |
| Auto-updater never finds new version | GitHub Release missing `latest.yml` OR `SoundSync Setup <version>.exe` | Re-upload both artifacts to the release; see [`deployment.md`](deployment.md). |
| Auto-updater reports "Update available" but install never starts | `autoDownload` disabled in user settings | Settings → **Check for updates automatically** toggle on, or click **Install now** after manual check. |
| `Install now` button does nothing | Update wasn't fully downloaded yet | Wait a few seconds and retry; if persistent, run **Check for updates** to force download. |
| Tray icon missing after install | Existing SoundSync process holds the single-instance lock | Open Task Manager → end any running SoundSync.exe → relaunch from Start Menu. |
| Google Drive File Stream path errors | Drive virtual mount not present | Diagnostics now hints when `My Drive` is unavailable. Mount Drive File Stream or pick a local folder under `C:\Users\<you>\...`. |
| Settings UI shows "v0.0.0" or "vundefined" | Renderer ran before `window.api.getAppVersion()` resolved | Reopen Settings window. If persistent, check that `src/preload.js` exposes `getAppVersion` and `src/main.js` registers it. |
| Quick Follow preset checkbox toggles but list doesn't update | Renderer event handler error | Open DevTools (Settings window → Ctrl+Shift+I) → Console tab → look for JS errors. Report with the error message. |
| CLI `node cli.js sync` runs but skips tracks that the Electron sync would download | CLI does not share the Electron sync history | Use the Electron app for production syncs, or re-add the source via CLI `config`. Tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2). |
| Renderer shows broken-image marker in sidebar logo | Local asset path failed to resolve (likely missing `src/assets/brand/SoundSync_sidebar_logo_512.png`) | Verify the file exists. `onerror` handler hides the broken image and renders the CSS fallback orb. |
| App startup writes data to `%APPDATA%\soundcloud-auto-sync` instead of `%APPDATA%\SoundSync` | `app.setName()` ran after `app.whenReady()` (regression) | Verify `app.setName('SoundSync')` and `app.setAppUserModelId(...)` execute **before** `app.whenReady()` in `src/main.js`. |

## Diagnostic data to capture

When opening an issue, include:

- App version (Settings → bottom-right or tray → SoundSync header)
- OS version (`winver`)
- Output of Settings → **Diagnostics** → **Run Diagnostics**
- Sample of the failing yt-dlp command (run it manually outside the app):

```cmd
resources\yt-dlp.exe --version
resources\yt-dlp.exe --retries 10 --retry-sleep http:exp=1:30 --socket-timeout 30 --print "%(uploader)s — %(title)s" "<failing-url>"
```

- DevTools Console output (Ctrl+Shift+I in the Settings window), JS errors only
- Last 100 lines of stderr from a foreground launch (`npm start` from a terminal)

Never paste API tokens, session cookies, or download URLs containing private playlists in a public issue.

## When to file an issue vs reach out privately

- **Public issue**: UI bugs, sync stalls, missing tracks, doc errors, broken auto-updater detection.
- **Private email** (`justyn.gunnels@me.com`): credentials accidentally committed somewhere, exploitable security findings, anything involving a private SoundCloud URL.

See [`../SECURITY.md`](../SECURITY.md).
