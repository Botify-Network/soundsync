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
const YTDLP_NETWORK_ARGS = [
  '--retries', '10',
  '--retry-sleep', 'http:exp=1:30',
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

function isRateLimitMessage(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return RATE_LIMIT_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

class Downloader {
  constructor(store) {
    this.store = store || null;
    this.downloadQueue = [];
    this.isProcessing = false;
    // Cooldown until epoch-ms; set when a 429 is detected so the queue pauses
    // before issuing the next request.
    this.cooldownUntil = 0;
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

  async downloadSingleTrack(url, downloadPath) {
    try {
      const result = await this.downloadWithYtDlp(url, downloadPath);
      return {
        success: true,
        filename: result.outputTemplate,
        skipped: result.skipped || false
      };
    } catch (error) {
      console.error('Download failed:', error);
      const wrapped = new Error(`Failed to download track: ${error.message}`);
      if (error.rateLimited) wrapped.rateLimited = true;
      throw wrapped;
    }
  }

  async downloadPlaylist(url, downloadPath) {
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
      console.error('Playlist download failed:', error.message);
      throw new Error(`Failed to download playlist: ${error.message}`);
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

    // Set timeout based on whether it's a playlist or single track
    const timeoutMs = isPlaylist ? 30 * 60 * 1000 : 5 * 60 * 1000;

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
          reject(new Error(`Download timed out. This could be due to:\n- Slow internet connection\n- Large playlist\n- Rate limiting by SoundCloud\n\nPlease try again later.`));
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

    let nextDelayMs = 1500; // baseline spacing between tracks
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
