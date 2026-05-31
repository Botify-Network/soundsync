const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { getYtDlpPath, getFfmpegPath } = require('./paths');

// yt-dlp args that make every download resilient to transient network failures
// and SoundCloud rate limiting. Kept in one place so monitor + one-off downloads
// behave consistently.
// yt-dlp internal retry count kept moderate because we now handle 403
// auth-block recovery (cache purge + retry) ourselves at the Downloader
// layer. 5 internal retries + 1 outer retry is plenty without blowing the
// per-track timeout budget.
const YTDLP_NETWORK_ARGS = [
  '--retries', '5',
  '--retry-sleep', 'http:exp=1:15',
  '--retry-sleep', 'extractor:5',
  '--socket-timeout', '30',
  '--sleep-requests', '1',
  '--sleep-interval', '2',
  '--max-sleep-interval', '6'
];

const RATE_LIMIT_PATTERNS = [
  'HTTP Error 429',
  'Too Many Requests',
  'rate-limit',
  'rate limit'
];

// SoundCloud rotates its public client_id frequently. yt-dlp caches the last
// known good value; when SoundCloud rotates, the cached id starts returning
// 403 on the JSON metadata endpoint until the cache is purged (which forces
// yt-dlp to re-scrape a fresh client_id from the web player).
const AUTH_BLOCK_PATTERNS = [
  'HTTP Error 403',
  'Forbidden',
  'Unable to download JSON metadata'
];

function isRateLimitMessage(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return RATE_LIMIT_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

function isAuthBlockMessage(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return AUTH_BLOCK_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

class Downloader {
  constructor(store) {
    this.store = store || null;
    this.downloadQueue = [];
    this.isProcessing = false;
    // Cooldown until epoch-ms; set when a 429 is detected so the queue pauses
    // before issuing the next request.
    this.cooldownUntil = 0;
    // Throttle automatic yt-dlp self-updates triggered by 403s so we never
    // hammer the GitHub release API mid-queue.
    this.lastAutoUpdateAt = 0;
  }

  /**
   * Random delay (ms) between queued downloads. Honors user-configured
   * min/max from settings; clamps to sensible bounds so the queue never
   * stalls or hammers SoundCloud.
   */
  getInterTrackDelayMs() {
    const DEFAULT_MIN = 4000;
    const DEFAULT_MAX = 12000;
    const HARD_FLOOR = 1000;
    const HARD_CEIL = 120000;

    let min = DEFAULT_MIN;
    let max = DEFAULT_MAX;
    if (this.store) {
      const cfgMin = Number(this.store.get('interTrackDelayMinMs', DEFAULT_MIN));
      const cfgMax = Number(this.store.get('interTrackDelayMaxMs', DEFAULT_MAX));
      if (Number.isFinite(cfgMin)) min = cfgMin;
      if (Number.isFinite(cfgMax)) max = cfgMax;
    }
    min = Math.max(HARD_FLOOR, Math.min(min, HARD_CEIL));
    max = Math.max(HARD_FLOOR, Math.min(max, HARD_CEIL));
    if (max < min) max = min;

    return Math.floor(min + Math.random() * (max - min + 1));
  }

  /**
   * Wipe yt-dlp's on-disk cache (forces fresh SoundCloud client_id scrape).
   */
  async clearYtDlpCache() {
    try {
      const ytdlpPath = getYtDlpPath();
      await execPromise(`"${ytdlpPath}" --rm-cache-dir`);
      console.log('yt-dlp cache cleared');
      return true;
    } catch (error) {
      console.warn(`Failed to clear yt-dlp cache: ${error.message}`);
      return false;
    }
  }

  /**
   * Best-effort yt-dlp self-update used during 403 auto-recovery.
   * Skipped if we already tried within the last 6 hours.
   */
  async autoUpdateYtDlpIfStale() {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    if (Date.now() - this.lastAutoUpdateAt < SIX_HOURS) {
      return { skipped: true, reason: 'recent-attempt' };
    }
    this.lastAutoUpdateAt = Date.now();
    try {
      const result = await this.updateYtDlp();
      if (result && result.success) {
        console.log(`yt-dlp auto-update: ${result.message || 'ok'}`);
      }
      return result;
    } catch (error) {
      console.warn(`yt-dlp auto-update failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if a path is writable
   * @param {String} dirPath - Directory path to check
   */
  async checkWritePermission(dirPath) {
    try {
      // Create directory if it doesn't exist
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Test write permission by creating a temp file
      const testFile = path.join(dirPath, `.write-test-${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return { success: true };
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        return {
          success: false,
          error: `Permission denied: Cannot write to "${dirPath}". Try running as Administrator or choose a different folder.`
        };
      } else if (error.code === 'ENOENT') {
        return {
          success: false,
          error: `Invalid path: "${dirPath}" does not exist and cannot be created.`
        };
      } else if (error.code === 'EINVAL') {
        return {
          success: false,
          error: `Invalid path: "${dirPath}" contains invalid characters.`
        };
      }
      return {
        success: false,
        error: `Cannot access "${dirPath}": ${error.message}`
      };
    }
  }

  /**
   * Download a track from SoundCloud
   * @param {Object} track - Track object with title, url, artist
   * @param {String} downloadPath - Destination folder
   */
  async downloadTrack(track, downloadPath) {
    // Check if file already exists
    const sanitizedArtist = this.sanitizeFilename(track.artist);
    const sanitizedTitle = this.sanitizeFilename(track.title);

    // Don't prepend artist if it's NA, Unknown, or empty
    let filename;
    if (!sanitizedArtist || sanitizedArtist === 'NA' || sanitizedArtist === 'Unknown') {
      filename = `${sanitizedTitle}.mp3`;
    } else {
      filename = `${sanitizedArtist} - ${sanitizedTitle}.mp3`;
    }

    const filePath = path.join(downloadPath, filename);

    // Also check for old format with NA prefix (for backwards compatibility)
    const oldFilePath = path.join(downloadPath, `NA - ${sanitizedTitle}.mp3`);
    const unknownFilePath = path.join(downloadPath, `Unknown - ${sanitizedTitle}.mp3`);

    if (fs.existsSync(filePath) || fs.existsSync(oldFilePath) || fs.existsSync(unknownFilePath)) {
      console.log(`File already exists, skipping: ${filename}`);
      return { success: true, skipped: true, filename };
    }

    return new Promise((resolve, reject) => {
      this.downloadQueue.push({ track, downloadPath, resolve, reject });

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Download from a direct URL (for one-time downloads)
   * @param {String} url - SoundCloud URL
   * @param {String} downloadPath - Destination folder
   */
  async downloadFromURL(url, downloadPath) {
    const isPlaylist = url.includes('/sets/');

    if (isPlaylist) {
      console.log('Detected playlist URL, downloading all tracks...');
      return this.downloadPlaylist(url, downloadPath);
    } else {
      console.log('Detected single track URL');
      return this.downloadSingleTrack(url, downloadPath);
    }
  }

  /**
   * Recover from a SoundCloud 403 by purging yt-dlp's client_id cache and
   * (at most once every 6 hours) self-updating yt-dlp. Returns true if any
   * recovery step ran so the caller can retry the download.
   */
  async recoverFromAuthBlock() {
    console.warn('Auth block (403) detected — purging yt-dlp cache and checking for update...');
    const cleared = await this.clearYtDlpCache();
    const updated = await this.autoUpdateYtDlpIfStale();
    return cleared || (updated && updated.success);
  }

  async downloadSingleTrack(url, downloadPath, _retry = false) {
    try {
      const result = await this.downloadWithYtDlp(url, downloadPath);
      return {
        success: true,
        filename: result.outputTemplate,
        skipped: result.skipped || false
      };
    } catch (error) {
      if (error.authBlocked && !_retry) {
        await this.recoverFromAuthBlock();
        return this.downloadSingleTrack(url, downloadPath, true);
      }
      console.error('Download failed:', error);
      const wrapped = new Error(`Failed to download track: ${error.message}`);
      if (error.rateLimited) wrapped.rateLimited = true;
      if (error.authBlocked) wrapped.authBlocked = true;
      throw wrapped;
    }
  }

  async downloadPlaylist(url, downloadPath, _retry = false) {
    try {
      console.log(`Downloading playlist from: ${url}`);
      console.log(`Save location: ${downloadPath}`);

      await this.downloadWithYtDlp(url, downloadPath, true);

      console.log('Playlist download complete!');
      return {
        success: true,
        isPlaylist: true,
        message: 'Playlist downloaded successfully'
      };
    } catch (error) {
      if (error.authBlocked && !_retry) {
        await this.recoverFromAuthBlock();
        return this.downloadPlaylist(url, downloadPath, true);
      }
      console.error('Playlist download failed:', error.message);
      const wrapped = new Error(`Failed to download playlist: ${error.message}`);
      if (error.authBlocked) wrapped.authBlocked = true;
      throw wrapped;
    }
  }

  async downloadWithYtDlp(url, downloadPath, isPlaylist = false) {
    // Check write permission first
    const permCheck = await this.checkWritePermission(downloadPath);
    if (!permCheck.success) {
      throw new Error(permCheck.error);
    }

    // Use title only - artist metadata is embedded in the file anyway
    const outputTemplate = path.join(downloadPath, '%(title)s.%(ext)s');

    const skipThumbnail = this.store ? this.store.get('skipThumbnail', false) : false;

    const args = [
      ...YTDLP_NETWORK_ARGS,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--add-metadata',
      '--no-overwrites',
      '--output', outputTemplate
    ];

    if (!skipThumbnail) {
      args.push('--embed-thumbnail');
    }

    // Add ffmpeg location if bundled ffmpeg is available
    const ffmpegPath = getFfmpegPath();
    if (ffmpegPath) {
      args.push('--ffmpeg-location', ffmpegPath);
      console.log(`Using ffmpeg at: ${ffmpegPath}`);
    }

    if (isPlaylist) {
      args.push('--yes-playlist');
    } else {
      args.push('--no-playlist');
    }

    // URL must come after all options
    args.push(url);

    console.log(`Executing yt-dlp with ${args.length} arguments`);

    // Per-track / per-playlist hard timeout. User-overridable via store so
    // slow networks or huge playlists don't get killed mid-download.
    const trackDefault = 12 * 60 * 1000;    // 12 min single track
    const playlistDefault = 60 * 60 * 1000; // 60 min playlist
    let timeoutMs = isPlaylist ? playlistDefault : trackDefault;
    if (this.store) {
      const cfgKey = isPlaylist ? 'playlistTimeoutMs' : 'trackTimeoutMs';
      const cfg = Number(this.store.get(cfgKey, timeoutMs));
      if (Number.isFinite(cfg) && cfg >= 60 * 1000) timeoutMs = cfg;
    }

    const ytdlpPath = getYtDlpPath();

    return new Promise((resolve, reject) => {
      const ytdlp = spawn(ytdlpPath, args);

      let stdout = '';
      let stderr = '';
      let timeoutId = null;
      let isTimedOut = false;

      timeoutId = setTimeout(() => {
        isTimedOut = true;
        console.error(`Download timed out after ${timeoutMs / 1000} seconds`);
        ytdlp.kill('SIGTERM');

        setTimeout(() => {
          if (ytdlp.exitCode === null) {
            ytdlp.kill('SIGKILL');
          }
        }, 5000);
      }, timeoutMs);

      ytdlp.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log(output);
      });

      ytdlp.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        if (!output.includes('WARNING')) {
          console.log(output);
        }
      });

      ytdlp.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);

        if (error.message.includes('ENOENT') || error.message.includes('not found')) {
          reject(new Error('yt-dlp is not installed. Please install yt-dlp to enable downloads.'));
        } else {
          reject(error);
        }
      });

      ytdlp.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);

        if (isTimedOut) {
          const minutes = Math.round(timeoutMs / 60000);
          reject(new Error(
            `Download timed out after ${minutes} min. Likely causes:\n` +
            `- Slow connection or large file\n` +
            `- SoundCloud rate-limiting / 403 storm\n\n` +
            `You can raise the limit in settings: trackTimeoutMs / playlistTimeoutMs.`
          ));
          return;
        }

        if (code === 0) {
          const wasSkipped = stdout.includes('has already been downloaded') ||
                             stdout.includes('already been recorded in archive') ||
                             stdout.includes('[download] ') && stdout.includes(' has already been downloaded');

          const wasDownloaded = stdout.includes('[download] Destination:') ||
                               stdout.includes('Downloading') ||
                               stdout.includes('[ExtractAudio]');

          resolve({
            outputTemplate,
            skipped: wasSkipped && !wasDownloaded
          });
        } else {
          let errorMessage = stderr || `yt-dlp exited with code ${code}`;
          let rateLimited = false;

          if (stderr.includes('EPERM') || stderr.includes('Permission denied')) {
            errorMessage = `Permission denied: Cannot write files to the download folder. Try choosing a different folder or running as Administrator.`;
          } else if (stderr.includes('ENOSPC')) {
            errorMessage = `Disk full: Not enough space to download the file.`;
          } else if (stderr.includes('Unable to extract') || stderr.includes('Unsupported URL')) {
            errorMessage = `Invalid URL: The SoundCloud URL could not be processed. Make sure the track/playlist is public and the URL is correct.`;
          } else if (stderr.includes('HTTP Error 404')) {
            errorMessage = `Track not found: The URL may be invalid or the track may have been removed.`;
          } else if (isRateLimitMessage(stderr)) {
            errorMessage = `Rate limited: Too many requests to SoundCloud. Cooling down before next download.`;
            rateLimited = true;
            // 90s cooldown — yt-dlp already retried internally with backoff, so
            // a longer pause before any further request is warranted.
            this.cooldownUntil = Date.now() + 90 * 1000;
          } else if (isAuthBlockMessage(stderr)) {
            errorMessage = `SoundCloud rejected the request (HTTP 403). The cached client_id is likely stale.`;
            const err = new Error(errorMessage);
            err.authBlocked = true;
            reject(err);
            return;
          } else if (stderr.includes('Connection') || stderr.includes('timed out') || stderr.includes('ETIMEDOUT') || stderr.includes('ECONNRESET')) {
            errorMessage = `Network error: ${stderr.trim().split('\n').slice(-1)[0] || 'connection failed'}. Will retry on next sync.`;
          }

          const err = new Error(errorMessage);
          if (rateLimited) err.rateLimited = true;
          reject(err);
        }
      });
    });
  }

  async processQueue() {
    if (this.downloadQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    // Honor any pending cooldown from a prior 429 before pulling next job.
    const waitMs = this.cooldownUntil - Date.now();
    if (waitMs > 0) {
      console.warn(`Cooldown active, waiting ${Math.ceil(waitMs / 1000)}s before next download...`);
      await new Promise(r => setTimeout(r, waitMs));
    }

    const { track, downloadPath, resolve, reject } = this.downloadQueue.shift();

    let nextDelayMs = this.getInterTrackDelayMs();
    try {
      const result = await this.downloadSingleTrack(track.url, downloadPath);
      resolve(result);
    } catch (error) {
      if (error.rateLimited) {
        // Already set cooldownUntil in close handler; nothing more to do here.
        nextDelayMs = 0;
      }
      reject(error);
    }

    if (this.downloadQueue.length > 0 && nextDelayMs > 0) {
      console.log(`Pacing: sleeping ${Math.round(nextDelayMs / 1000)}s before next download (rate-limit hygiene)`);
    }
    setTimeout(() => this.processQueue(), nextDelayMs);
  }

  sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
  }

  /**
   * Compare yt-dlp version strings numerically (e.g. "2024.01.02" vs "2024.1.2.1")
   */
  isNewerVersion(latest, current) {
    if (!latest || !current || latest === current) return false;
    const a = latest.split('.').map(Number);
    const b = current.split('.').map(Number);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (av > bv) return true;
      if (av < bv) return false;
    }
    return false;
  }

  /**
   * Check if yt-dlp is installed
   */
  async checkYtDlp() {
    try {
      const ytdlpPath = getYtDlpPath();
      await execPromise(`"${ytdlpPath}" --version`);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the current yt-dlp version
   */
  async getYtDlpVersion() {
    try {
      const ytdlpPath = getYtDlpPath();
      const { stdout } = await execPromise(`"${ytdlpPath}" --version`);
      return stdout.trim();
    } catch (error) {
      return null;
    }
  }

  /**
   * Check for yt-dlp updates and return info
   */
  async checkYtDlpUpdate() {
    try {
      const currentVersion = await this.getYtDlpVersion();
      if (!currentVersion) {
        return { updateAvailable: false, error: 'yt-dlp not installed' };
      }

      // Fetch latest release info from GitHub
      const response = await axios.get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
        headers: { 'User-Agent': 'SoundCloud-Sync-App' },
        timeout: 10000
      });

      const latestVersion = response.data.tag_name;

      // Find the .exe asset download URL from the release
      let downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${latestVersion}/yt-dlp.exe`;
      const exeAsset = response.data.assets && response.data.assets.find(a => a.name === 'yt-dlp.exe');
      if (exeAsset && exeAsset.browser_download_url) {
        downloadUrl = exeAsset.browser_download_url;
      }

      // Compare versions numerically (format: YYYY.MM.DD or YYYY.MM.DD.N)
      const updateAvailable = this.isNewerVersion(latestVersion, currentVersion);

      return {
        updateAvailable,
        currentVersion,
        latestVersion,
        downloadUrl
      };
    } catch (error) {
      console.error('Failed to check for yt-dlp updates:', error.message);
      return { updateAvailable: false, error: error.message };
    }
  }

  /**
   * Update yt-dlp to the latest version
   */
  async updateYtDlp(progressCallback) {
    try {
      const updateInfo = await this.checkYtDlpUpdate();
      if (!updateInfo.updateAvailable) {
        return { success: true, message: 'Already up to date', version: updateInfo.currentVersion };
      }

      if (progressCallback) progressCallback('Downloading latest yt-dlp...');

      // Determine where to save the updated yt-dlp
      let targetPath;
      if (process.resourcesPath) {
        targetPath = path.join(process.resourcesPath, 'yt-dlp.exe');
      } else {
        targetPath = path.join(__dirname, '..', '..', 'resources', 'yt-dlp.exe');
      }

      // Download to a temp file first
      const tempPath = targetPath + '.tmp';

      const response = await axios({
        method: 'get',
        url: updateInfo.downloadUrl,
        responseType: 'stream',
        timeout: 120000,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'SoundCloud-Sync-App',
          'Accept': 'application/octet-stream'
        }
      });

      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      // Verify downloaded file is valid (should be > 1MB for yt-dlp.exe)
      const stats = fs.statSync(tempPath);
      if (stats.size < 1024 * 1024) {
        fs.unlinkSync(tempPath);
        return { success: false, error: 'Downloaded file is too small - possible corrupt download' };
      }

      if (progressCallback) progressCallback('Installing update...');

      // Replace old file with new one
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      fs.renameSync(tempPath, targetPath);

      // Verify the update
      const newVersion = await this.getYtDlpVersion();
      if (!newVersion) {
        return { success: false, error: 'Update installed but version check failed - executable may be corrupted' };
      }

      return {
        success: true,
        message: `Updated from ${updateInfo.currentVersion} to ${newVersion}`,
        oldVersion: updateInfo.currentVersion,
        newVersion
      };
    } catch (error) {
      // Clean up temp file if it exists
      try {
        let targetPath;
        if (process.resourcesPath) {
          targetPath = path.join(process.resourcesPath, 'yt-dlp.exe');
        } else {
          targetPath = path.join(__dirname, '..', '..', 'resources', 'yt-dlp.exe');
        }
        const tempPath = targetPath + '.tmp';
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) { /* ignore cleanup errors */ }

      console.error('Failed to update yt-dlp:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = Downloader;
