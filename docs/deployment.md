# Deployment / release flow

## Release artifact requirements

`electron-updater` only detects an update when the GitHub Release has **both** of these attached:

- `SoundSync Setup <version>.exe` — NSIS installer produced by `electron-builder`
- `latest.yml` — manifest `electron-updater` reads (contains SHA512 + version + path)

A notes-only release (tag + body, no binaries) **will not be detected** by installed clients. They will report "Up to date" against their current installed version.

## Release flow

### 1. Bump version

```bash
npm run bump          # patch: 2.0.7 → 2.0.8
# or
npm run bump:minor    # 2.0.7 → 2.1.0
# or
npm run bump:major    # 2.0.7 → 3.0.0
```

`scripts/bump-version.js` updates:

- `package.json` `version`
- `src/settings.html` version display (inline `<div class="version" id="appVersion">v…</div>` and the JS fallback when `window.api.getAppVersion()` is unavailable).

Commit the bump as its own commit:

```bash
git add package.json src/settings.html
git commit -m "chore(release): bump version to vX.Y.Z"
```

### 2. Build

```bash
npm run build:win
```

This runs `prebuild` (which would re-bump, so skip by calling `electron-builder` directly if you already bumped):

```bash
npx electron-builder --win
```

Output:

- `dist/SoundSync Setup <version>.exe`
- `dist/latest.yml`
- `dist/win-unpacked/` (unpacked build tree)
- `dist/builder-effective-config.yaml`
- Other electron-builder artifacts

### 3. Verify artifacts (pre-upload sanity check)

```bash
node scripts/verify-release-artifacts.js
```

Checks:

- Installer + `latest.yml` exist in `dist/`
- Installer filename matches the SoundSync naming regex
- `latest.yml` references the same version + filename + SHA512 as the produced installer
- No stale artifacts from a previous version are left in `dist/`

### 4. Create the GitHub Release + upload artifacts

```bash
# Tag must match package.json version.
gh release create vX.Y.Z \
  --repo Botify-Network/soundsync \
  --title "SoundSync vX.Y.Z" \
  --notes "$(cat <<'EOF'
## What's new

- ...

## Upgrade

Install the attached `SoundSync Setup vX.Y.Z.exe`, or wait for the in-app updater to pick it up automatically.

## Full changelog

See [CHANGELOG.md](https://github.com/Botify-Network/soundsync/blob/main/CHANGELOG.md).
EOF
)"

gh release upload vX.Y.Z \
  --repo Botify-Network/soundsync \
  "dist/SoundSync Setup X.Y.Z.exe" \
  "dist/latest.yml"
```

> ⚠️ Both files must be uploaded. The `latest.yml` upload is the one that arms `electron-updater` for installed clients.

### 5. Broker sanity check

The app reads update manifests from `https://botify-network.com/downloads/soundsync/files` (configured in the broker, not in this repo). Verify the broker resolves the freshly-uploaded artifact:

```bash
curl -sS https://botify-network.com/downloads/soundsync/latest.yml | head -10
```

Expected: the YAML reports the new version + filename + SHA512 you just uploaded.

If the broker is stale, the broker config in `botify-network-site` may need updating. That's a sibling-repo task — do not edit broker config from this repo.

### 6. Smoke test the updater

On a machine running the previous version:

1. Open Settings → Downloads tab.
2. Click **Check for updates**.
3. Expect "Update available: vX.Y.Z" within ~10s.
4. With **Install updates on next restart** on, quit the app — the new version should install silently.
5. Relaunch — verify `Settings → version display` shows vX.Y.Z.

If detection fails, check:

- Does `latest.yml` exist on the release? (Step 4.)
- Does the broker return the right YAML? (Step 5.)
- Is `autoUpdate` set to `true` in the user's `electron-store`? (Settings → Check for updates automatically.)

## Approval gates

- **No deploy / release without operator approval.** This applies to every release, including patch versions.
- **No force-push to `main` or `master`.**
- **No deletion of release tags.** If a release is broken, ship a new patch version.

## Code signing

NSIS installers are currently **not** signed by a Botify certificate. Windows SmartScreen will warn on first run. This is a known gap. Signing is tracked separately at the org-governance level (`botify-network-site`).

## Rolling back

If a release ships broken:

1. Do **not** delete the release or tag.
2. Bump to the next patch version and ship a fix forward.
3. Note the broken version in `CHANGELOG.md` under the new patch's entry ("Reverted X from vA.B.C").
