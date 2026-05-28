# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in **SoundSync by Botify**, do **not** open a public issue.

- Email the maintainer: `justyn.gunnels@me.com`
- Subject line: `[soundsync-security] <short description>`
- Include reproduction steps, affected version, and any logs that do not contain personal data.

You will receive an acknowledgment within 72 hours. A fix or mitigation will be coordinated privately before public disclosure.

## Supported versions

| Version | Supported |
|---|---|
| 2.0.x   | ✅ |
| < 2.0.0 | ❌ (rebrand era; upgrade to 2.0.x) |

## Threat model summary

SoundSync is a single-user Windows Electron desktop app. It runs locally, persists settings in `electron-store`, and invokes bundled CLIs (`yt-dlp`, `ffmpeg`) to fetch SoundCloud content. The current threat model assumes:

- The user is the only actor on the machine.
- Network egress is limited to: SoundCloud (via `yt-dlp`), GitHub Releases / botify-network.com broker (via `electron-updater`).
- No inbound network services are exposed.
- No telemetry is collected.

Out of scope: multi-user attack scenarios, compromised OS, supply-chain attacks against `yt-dlp` / `ffmpeg` binaries (mitigated only by sourcing from official releases when refreshing bundled tools).

## Hardening highlights

### Renderer (settings window)

- `contextIsolation: true` — renderer cannot reach Node APIs directly.
- `nodeIntegration: false`.
- Preload bridge (`src/preload.js`) exposes a whitelist: `window.api.send`, `on`, `removeListener`, `openPath`, `getAppVersion`. No arbitrary IPC.
- **No `innerHTML` for user-supplied values.** Usernames, playlist URLs, fetched track titles, and uploader names are inserted via `document.createElement` + `textContent`. Hardcoded HTML entities are used only for diagnostic icons.

### Main process

- All `yt-dlp` and `ffmpeg` invocations use `spawn` / `execFile` with **argv arrays**. No string interpolation, no shell.
- `runCmd()` enforces a per-call timeout and surfaces stdout/stderr/exit code on failure without re-shelling.
- IPC handlers validate input shape before forwarding to services.

### CLI (`cli.js`)

- Same argv-array discipline: `execFileSync(file, args, opts)` instead of shell interpolation.
- Config is read/written as JSON only; no `eval` or dynamic require.

### Network resilience

- `yt-dlp` calls pass `--retries 10`, `--retry-sleep http:exp=1:30`, `--socket-timeout 30`, `--sleep-requests 1`.
- App-level: 3-attempt retry with 15s/30s/60s backoff on detected rate-limit; 90s queue cooldown on 429.

### Auto-updater

- Each toggle (auto-check, auto-download, auto-install-on-quit) is independently disable-able.
- Update artifacts must match `electron-updater`'s expected manifest — see [`docs/deployment.md`](docs/deployment.md).

## What we do not promise

- No formal third-party security audit has been performed.
- Bundled `yt-dlp.exe` / `ffmpeg.exe` are not signed by this project; their integrity is the responsibility of the operator refreshing them.
- The CLI sync path does not yet share full rate-limit hardening — tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2).

## Coordinated disclosure timeline

- T+0: report received.
- T+72h: acknowledgment.
- T+14d: target for fix or mitigation.
- T+30d: target for coordinated public disclosure.

Adjustments are negotiated per report based on severity and exploit complexity.
