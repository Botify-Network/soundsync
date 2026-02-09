#!/usr/bin/env node
/**
 * Auto version bumper
 * Increments patch version in package.json and updates settings.html to match.
 *
 * Usage:
 *   node scripts/bump-version.js          → bumps patch (2.0.0 → 2.0.1)
 *   node scripts/bump-version.js minor    → bumps minor (2.0.1 → 2.1.0)
 *   node scripts/bump-version.js major    → bumps major (2.1.0 → 3.0.0)
 *   node scripts/bump-version.js 2.5.0    → sets exact version
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const HTML_PATH = path.join(ROOT, 'src', 'settings.html');

// Read current version
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const oldVersion = pkg.version;
const [major, minor, patch] = oldVersion.split('.').map(Number);

// Determine new version
const arg = process.argv[2] || 'patch';
let newVersion;

if (/^\d+\.\d+\.\d+$/.test(arg)) {
  newVersion = arg;
} else if (arg === 'major') {
  newVersion = `${major + 1}.0.0`;
} else if (arg === 'minor') {
  newVersion = `${major}.${minor + 1}.0`;
} else {
  newVersion = `${major}.${minor}.${patch + 1}`;
}

// Update package.json
pkg.version = newVersion;
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

// Update settings.html version display
if (fs.existsSync(HTML_PATH)) {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  html = html.replace(
    /(<div class="version"[^>]*>)v[\d.]+(<\/div>)/,
    `$1v${newVersion}$2`
  );
  fs.writeFileSync(HTML_PATH, html);
}

console.log(`Version bumped: ${oldVersion} → ${newVersion}`);
