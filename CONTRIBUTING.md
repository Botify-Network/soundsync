# Contributing to SoundSync by Botify

Thanks for your interest. This project follows Botify Network governance.

## Hard rules

- **No secrets** in any commit, comment, issue, attachment, screenshot, or PR description.
- **No deploys** without explicit operator approval.
- **No merges** without explicit operator approval — even if CI is green.
- **No broad rewrites** — each PR has an explicit, narrow scope.
- **Behavior preservation is the default.** Any intentional behavior change must be called out in the PR body.

## Scope

This repo is a Windows Electron tray app for SoundCloud auto-sync. PRs outside that scope (server backends, mobile clients, unrelated tooling) will be redirected to the appropriate sibling repo or governance hub.

## Before opening a PR

1. Open or find a tracking issue. Link it in the PR body.
2. Run all syntax checks:
   ```bash
   node --check src/main.js
   node --check src/preload.js
   node --check cli.js
   node --check src/services/downloader.js
   node --check src/services/soundcloud-monitor.js
   ```
3. If you touched the renderer, manually verify the settings window opens at the supported window sizes (860×640, 960×720, 1100×760, 1280×800).
4. Inspect `git status` and `git diff --stat` before staging. Stage explicit paths, not `git add -A`.
5. Update [`CHANGELOG.md`](CHANGELOG.md) under `## [Unreleased]` with a specific entry. Avoid "misc fixes."

## PR checklist

- [ ] Linked tracking issue.
- [ ] Scoped diff (no incidental refactors).
- [ ] `node --check` passes on all touched JS.
- [ ] No new `innerHTML` with user-supplied values.
- [ ] No new `child_process` calls that use shell interpolation.
- [ ] No new remote asset / CDN references.
- [ ] No secrets in commits or attachments.
- [ ] `CHANGELOG.md` updated.
- [ ] PR body explains *why*, not just *what*.
- [ ] If UI changed: screenshot evidence at supported resize sizes.
- [ ] If behavior changed: explicit callout in PR body.

## Branch naming

- `claude/<slug>` — agent-authored work.
- `feat/<slug>` — feature branches.
- `fix/<slug>` — bug fixes.
- `docs/<slug>` — docs-only changes.
- `chore/<slug>` — tooling, CI, dependencies.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short imperative summary

Optional body explaining the why. Hard-wrap at 80 chars.
Link related issues at the bottom.
```

Common `type` values: `feat`, `fix`, `docs`, `style`, `refactor`, `chore`, `security`.

## Code style

- Mixed CommonJS today (`require`). Keep consistent unless a dedicated ESM migration PR lands.
- 2-space indent.
- Single quotes for JS strings, double quotes inside HTML.
- Prefer early returns over deep nesting.
- Names: `camelCase` for vars/functions, `PascalCase` for classes, `UPPER_SNAKE_CASE` for constants.

## Reviewing

Reviewers should verify:

- Scope matches the tracking issue.
- No security regressions (XSS, shell interpolation, IPC widening).
- No new remote assets.
- `CHANGELOG.md` entry is specific.
- Behavior preservation unless explicitly flagged.

## Reporting security issues

Do **not** open a public issue. See [`SECURITY.md`](SECURITY.md).
