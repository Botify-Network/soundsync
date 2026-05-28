# tests

Vitest-based unit tests for SoundSync services that have no Electron dependencies.

## Run

```bash
npm install        # picks up vitest as a devDependency
npm test           # one-shot run
npm run test:watch # watch mode
```

## Current coverage

- `paths.test.js` — `getYtDlpPath` / `getFfmpegPath` resolution (bundled `resources/` → PATH fallback).

## Planned (tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2))

- `soundcloud-monitor` URL validation (`/sets/` required, username slug parsing).
- `downloader` rate-limit detection (mock yt-dlp child process; verify 3-attempt backoff + 90s cooldown).
- `main/run-cmd` argv pass-through (cross-platform — `node --version` works on all targets).
- `main/user-data-migration` happy path + idempotency (tmpdir userData stubs).

## Not in scope

Electron renderer/main process tests require `electron-mocha` or similar. The current scope targets pure-Node modules only. Integration tests that need the Electron runtime are deferred to a separate harness.
