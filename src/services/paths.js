const path = require('path');
const fs = require('fs');

/**
 * Get the path to yt-dlp executable.
 * Checks bundled version first, then falls back to system PATH.
 * Returns a bare path (no quotes) suitable for spawn().
 */
function getYtDlpPath() {
  if (process.resourcesPath) {
    const bundledPath = path.join(process.resourcesPath, 'yt-dlp.exe');
    if (fs.existsSync(bundledPath)) return bundledPath;
  }

  const devPath = path.join(__dirname, '..', '..', 'resources', 'yt-dlp.exe');
  if (fs.existsSync(devPath)) return devPath;

  return 'yt-dlp';
}

/**
 * Get the path to the ffmpeg directory.
 * Checks bundled version first, then returns null to let yt-dlp use system PATH.
 */
function getFfmpegPath() {
  if (process.resourcesPath) {
    const bundledPath = path.join(process.resourcesPath, 'ffmpeg.exe');
    if (fs.existsSync(bundledPath)) return process.resourcesPath;
  }

  const devPath = path.join(__dirname, '..', '..', 'resources', 'ffmpeg.exe');
  if (fs.existsSync(devPath)) return path.join(__dirname, '..', '..', 'resources');

  return null;
}

module.exports = { getYtDlpPath, getFfmpegPath };
