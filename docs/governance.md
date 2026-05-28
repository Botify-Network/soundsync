# Governance

SoundSync is a member repo of the **Botify Network** org. The rules below apply unconditionally.

## Hard rules

1. **No secrets** in any commit, comment, issue, attachment, screenshot, PR description, or log paste. Includes API tokens, session cookies, SoundCloud auth, Railway env values, certs, private URLs.
2. **No deploys without explicit operator approval.** Every release tag + upload requires approval (see [`deployment.md`](deployment.md)).
3. **No merges without explicit operator approval** — even if CI is green.
4. **No broad rewrites.** Each PR has an explicit, narrow scope.
5. **Behavior preservation is the default.** Intentional behavior changes must be called out in the PR body and CHANGELOG.
6. **No remote assets at runtime.** All fonts, icons, images, scripts must be local. No CDN. No analytics. No telemetry.
7. **No `innerHTML` for user-supplied values.** Use `createElement` + `textContent`. See [`security.md`](security.md).
8. **No `child_process` with shell interpolation.** Use argv arrays via `spawn` / `execFile`.
9. **No cross-repo edits** without explicit confirmation. SoundSync work stays in `Botify-Network/soundsync`.
10. **CHANGELOG every commit.** Update `## [Unreleased]` with a specific entry. No "misc fixes" wording.

## Scope

- **In scope**: Windows Electron tray app for SoundCloud auto-sync. CLI companion. Brand assets. Documentation.
- **Out of scope**: server backends, mobile clients, broker config (lives in `botify-network-site`), org-wide CI templates, unrelated tooling.

Cross-repo work redirects:

| Concern | Lives in |
|---|---|
| Broker config (`/downloads/soundsync/*` routing) | `botify-network-site` |
| Org-wide release automation | `botify-network-site` / governance hub |
| Cross-repo issue tracking | `botify-network-site` issues |
| Code-signing cert / Apple notarization | Org-level governance (not yet implemented) |

## Approval matrix

| Action | Required approval |
|---|---|
| Open a PR | None (anyone) |
| Merge a PR to `main` / `master` | Operator |
| Create a release tag | Operator |
| Upload release artifacts | Operator |
| Force-push to `main` / `master` | **Forbidden** |
| Delete a release tag | **Forbidden** (ship a new patch instead) |
| Change visibility (public ↔ private) | Operator |
| Add/remove org members | Operator (via GitHub UI) |
| Change branch protection rules | Operator |

## Tracking issues

- [#1](https://github.com/Botify-Network/soundsync/issues/1) — Docs / README initiative
- [#2](https://github.com/Botify-Network/soundsync/issues/2) — Engineering cleanup / refactor / tests

Parent governance issues live in `botify-network-site`:

- Multi-repo docs initiative: `botify-network-site#76`
- Multi-repo engineering initiative: `botify-network-site#77`

## Repo conventions

- Default branch: `main` (with `master` legacy branch still present)
- Branch naming: `claude/<slug>`, `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`
- Commits: Conventional Commits (`type(scope): summary`)
- PR titles: same Conventional Commits format
- PR body must include: summary, linked issue, validation steps, behavior-change callouts (if any)

## Review checklist (reviewers)

- Scope matches the linked tracking issue.
- No new `innerHTML` with user-supplied strings.
- No new shell interpolation in `child_process` calls.
- No new IPC channels without preload whitelist + handler + doc.
- No new remote asset / CDN URLs.
- No secrets.
- CHANGELOG entry is specific and accurate.
- Behavior preservation unless explicitly flagged.

## Escalation

- Maintainer: `justyn.gunnels@me.com`
- Subject prefix for governance: `[soundsync-governance]`
- Subject prefix for security: `[soundsync-security]`
