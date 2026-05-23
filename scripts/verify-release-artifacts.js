#!/usr/bin/env node
/**
 * verify-release-artifacts.js
 *
 * Pre-publish guard for the SoundSync by Botify GitHub release
 * workflow. Refuses to upload an empty / mislabeled / stale artifact
 * set. The Botify Network download broker at
 * https://botify-network.com/downloads/soundsync/latest consumes these
 * artifacts; an empty release would surface as a 404/502 on the public
 * site.
 *
 * Hard checks:
 *   1. dist/ exists and contains at least one Windows installer.
 *   2. electron-builder.yml publish provider/owner/repo matches the
 *      canonical Botify-Network/soundsync target so the auto-updater
 *      keeps working after the visibility flip.
 *   3. Installer filename starts with "SoundSync" (productName) and
 *      embeds the package.json version. Old "SC Auto Downloader"
 *      filenames are rejected.
 *   4. A latest*.yml updater manifest exists.
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed (workflow refuses publish)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PKG_PATH = path.join(ROOT, "package.json");
const BUILDER_PATH = path.join(ROOT, "electron-builder.yml");

const errors = [];
const notes = [];

function check(cond, message, extra) {
  if (cond) {
    notes.push(`PASS  ${message}`);
  } else {
    errors.push(`FAIL  ${message}${extra ? "\n      " + extra : ""}`);
  }
}

// 1. dist/ exists with at least one Windows installer (.exe).
let distFiles = [];
try {
  distFiles = fs.readdirSync(DIST);
} catch (_) {
  // handled by the next check
}
const exeFiles = distFiles.filter((f) => f.toLowerCase().endsWith(".exe"));
check(
  exeFiles.length > 0,
  "dist/ contains at least one .exe installer",
  `looked in ${DIST}; saw ${distFiles.length} files`
);

// 2. electron-builder.yml points at the canonical private repo.
let builderText = "";
try {
  builderText = fs.readFileSync(BUILDER_PATH, "utf8");
} catch (_) {
  errors.push(`FAIL  electron-builder.yml is readable at ${BUILDER_PATH}`);
}
check(
  /provider:\s*github/i.test(builderText),
  "electron-builder.yml publish.provider === github"
);
check(
  /owner:\s*Botify-Network/.test(builderText),
  "electron-builder.yml publish.owner === Botify-Network"
);
check(
  /repo:\s*soundsync\b/.test(builderText),
  "electron-builder.yml publish.repo === soundsync"
);

// 3. Filenames must begin with SoundSync (productName) — never the
//    legacy "SC Auto Downloader" branding. The version from
//    package.json must appear somewhere in the filename.
let pkg = {};
try {
  pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
} catch (_) {
  errors.push("FAIL  package.json is parseable");
}
const version = (pkg && typeof pkg.version === "string") ? pkg.version : "";
check(version.length > 0, "package.json has a version string");

for (const f of exeFiles) {
  check(
    /^SoundSync/i.test(f),
    `installer filename starts with SoundSync (got "${f}")`
  );
  check(
    !/SC[\s_-]?Auto[\s_-]?Downloader/i.test(f),
    `installer filename does not contain legacy "SC Auto Downloader" branding (got "${f}")`
  );
  if (version) {
    check(
      f.includes(version),
      `installer filename embeds package version ${version} (got "${f}")`
    );
  }
}

// 4. Updater manifest present.
const updaterManifests = distFiles.filter((f) => /^latest.*\.ya?ml$/i.test(f));
check(
  updaterManifests.length > 0,
  "dist/ contains an electron-updater latest*.yml manifest"
);

// Print result.
if (notes.length) {
  console.log("\nverify-release-artifacts:");
  for (const n of notes) console.log("  " + n);
}
if (errors.length) {
  console.error("\nverify-release-artifacts: refusing to publish.");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

console.log("\nverify-release-artifacts: OK — safe to publish.");
process.exit(0);
