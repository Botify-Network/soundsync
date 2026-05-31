# Changelog

All notable changes to **SoundSync by Botify** are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- "Download timed out" firing too early on big files / 403-recovery paths. Single-track timeout bumped 5 min → 12 min default; playlist 30 min → 60 min default. Both user-overridable via `trackTimeoutMs` / `playlistTimeoutMs` store keys (min 60s). yt-dlp internal retries lowered 10 → 5 and exp backoff cap 30s → 15s since the Downloader now owns 403 recovery — keeps internal retry budget under ~75s so the outer timer reflects real download time, not retry storms.
- SoundCloud `HTTP 403 Forbidden` / `Unable to download JSON metadata` errors now auto-recover: `Downloader` detects the auth-block signature, purges the yt-dlp cache (forcing a fresh `client_id` scrape), best-effort self-updates yt-dlp (throttled to once per 6h), and transparently retries the download once. Applies to both single-track and playlist paths in `src/services/downloader.js`.
- "Download from URL" dialog: buttons were clipped below the visible area on Windows because the window sized to 500×200 *including* the title/menu bar. Switched to `useContentSize: true`, bumped to 520×260 content, stripped the menu bar (`setMenu(null)` + `autoHideMenuBar`), and tightened body padding so Download/Cancel are always visible without scrolling.

### Changed
- Queued downloads are now paced with a randomized inter-track delay (default 4–12s, configurable via `interTrackDelayMinMs` / `interTrackDelayMaxMs` in user settings, hard-clamped to 1s–120s). Cuts the chance of SoundCloud rate-limiting the cached `client_id` during large playlist syncs. Skipped when the queue is empty or when a 429 cooldown is already active.

### Docs
- Premium README rewrite with badges, architecture overview, troubleshooting, project links.
- Created `/docs/` skeleton: operator, developer, governance, architecture, deployment, security, troubleshooting.
- Added `SECURITY.md` (reporting + supported versions + hardening summary).
- Added `CONTRIBUTING.md` (scope rules, governance, PR checklist).
- Added this `CHANGELOG.md`.

### Engineering
- (Tracked in [#2](https://github.com/Botify-Network/soundsync/issues/2).)

## [2.0.7] — 2026-05-28

### Added
- Botify governance UI kit applied to settings/dashboard ([#11](https://github.com/Botify-Network/soundsync/pull/11)):
  - Botify command-center tokens (radius, shadow, glow CSS vars; cyan/blue/violet semantic colors).
  - CSS Grid app shell + responsive metric/dashboard/footer grids; no horizontal clipping at 860×640 → 1280×800.
  - Sidebar brand block: "SoundSync · by Botify" + local PNG mark derived from ZIP icon masters.
  - Header health pill, glass cards, blue-gradient buttons, status pills, animated toggles.
  - Active Sources empty state with CTA to Monitoring.
  - Sync Health card with state-driven `health-chip` semantics.
  - Footer 3-col grid (status / metadata pill / actions) collapsing to 2-row then 1-col.
- Local brand asset pipeline derived from `SoundSync Template.zip` (no remote/CDN refs):
  - `assets/brand/SoundSync_app_icon_{64,128,256,512}.png` + master.
  - `assets/brand/SoundSync_badge_orb_512.png` + master.
  - `assets/brand/SoundSync_sidebar_logo_{128,256,512}.png` (sharpened from minimal-style master).
  - `assets/brand/SoundSync_favicon_{16,32}.png` + master.
  - `assets/brand/SoundSync_taskbar_icon.ico` (multi-size 16/32/48/64/128/256) + master.
  - Mirrored runtime PNGs into `src/assets/brand/` for renderer file:// resolution.
  - `design/soundsync-template-review/runtime-icon-contact-sheet.png` (master selection rationale).

### Changed
- Settings window: 900×650 → 1040×740 default; added `minWidth: 860`, `minHeight: 640`, `resizable: true`, `backgroundColor: '#050b18'`.
- BrowserWindow icon → `assets/brand/SoundSync_taskbar_icon.ico` (multi-size).

## [2.0.6] — pre-2026-05-28

### Changed
- Rebranded **SoundCloud Auto Sync / SC Auto Downloader** → **SoundSync by Botify**.
- Updated repository ownership references to `Botify-Network/soundsync`.

## [2.0.5] — pre-2026-05-28

### Changed
- Hardened `yt-dlp` invocations against SoundCloud rate-limiting:
  - `--retries 10` with `--retry-sleep http:exp=1:30` exponential backoff (up to 30s).
  - `--retry-sleep extractor:5`.
  - `--socket-timeout 30`.
  - `--sleep-requests 1`, `--sleep-interval 2 --max-sleep-interval 6` for downloads.
  - Per-track 1.5s pacing in `getFullMetadata`.
  - 3-attempt app-level retry with 15s/30s/60s backoff on detected rate-limit.
  - 90s download-queue cooldown when a 429 is detected mid-batch.

### Fixed
- Auto-updater controls and notifications.

## Earlier

Earlier history pre-dates the SoundSync rebrand. See git log: `git log --oneline -- README.md package.json`.

---

[Unreleased]: https://github.com/Botify-Network/soundsync/compare/v2.0.7...HEAD
[2.0.7]: https://github.com/Botify-Network/soundsync/releases/tag/v2.0.7
[2.0.6]: https://github.com/Botify-Network/soundsync/releases/tag/v2.0.6
[2.0.5]: https://github.com/Botify-Network/soundsync/releases/tag/v2.0.5
