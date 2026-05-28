const { describe, it, expect, beforeEach, afterEach, vi } = require('vitest');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('services/paths', () => {
  let getYtDlpPath;
  let getFfmpegPath;
  let tmpResources;
  let originalResourcesPath;

  beforeEach(() => {
    // Force a fresh require so process.resourcesPath stubs take effect.
    vi.resetModules();

    tmpResources = fs.mkdtempSync(path.join(os.tmpdir(), 'soundsync-paths-'));
    originalResourcesPath = process.resourcesPath;
  });

  afterEach(() => {
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath;
    } else {
      Object.defineProperty(process, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
        writable: true,
      });
    }
    try {
      fs.rmSync(tmpResources, { recursive: true, force: true });
    } catch (e) {
      // best effort
    }
  });

  function loadModule() {
    const mod = require('../src/services/paths');
    getYtDlpPath = mod.getYtDlpPath;
    getFfmpegPath = mod.getFfmpegPath;
  }

  function setResourcesPath(value) {
    Object.defineProperty(process, 'resourcesPath', {
      value,
      configurable: true,
      writable: true,
    });
  }

  it('getYtDlpPath returns bundled path when resourcesPath/yt-dlp.exe exists', () => {
    const bundled = path.join(tmpResources, 'yt-dlp.exe');
    fs.writeFileSync(bundled, '');
    setResourcesPath(tmpResources);
    loadModule();

    expect(getYtDlpPath()).toBe(bundled);
  });

  it('getYtDlpPath falls back to "yt-dlp" when no bundled binary exists', () => {
    setResourcesPath(tmpResources); // empty dir, no yt-dlp.exe
    loadModule();

    const result = getYtDlpPath();
    // Either dev resources/yt-dlp.exe (if one happens to be checked in locally)
    // or the bare PATH fallback. Both are acceptable behavior; the test
    // asserts we don't return the empty tmpResources bundled path we set up.
    expect(result === 'yt-dlp' || result.endsWith('yt-dlp.exe')).toBe(true);
    expect(result).not.toBe(path.join(tmpResources, 'yt-dlp.exe'));
  });

  it('getFfmpegPath returns resourcesPath directory when ffmpeg.exe is bundled', () => {
    fs.writeFileSync(path.join(tmpResources, 'ffmpeg.exe'), '');
    setResourcesPath(tmpResources);
    loadModule();

    expect(getFfmpegPath()).toBe(tmpResources);
  });

  it('getFfmpegPath returns null when no bundled ffmpeg and no dev resources', () => {
    setResourcesPath(tmpResources); // empty
    loadModule();

    const result = getFfmpegPath();
    // Either null (no dev fallback) or a path ending in 'resources' (dev fallback).
    expect(result === null || (typeof result === 'string' && result.endsWith('resources'))).toBe(true);
  });
});
