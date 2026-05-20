const { spawn } = require('child_process');
const { getYtDlpPath } = require('./paths');

// Shared yt-dlp args that make extractor calls resilient to flaky networks and
// SoundCloud rate-limiting. Applied to every yt-dlp invocation in this file.
const YTDLP_NETWORK_ARGS = [
  '--retries', '10',
  '--retry-sleep', 'http:exp=1:30',
  '--retry-sleep', 'extractor:5',
  '--socket-timeout', '30',
  '--sleep-requests', '1'
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class SoundCloudMonitor {
  constructor(store, downloader) {
    this.store = store;
    this.downloader = downloader;
    this.intervalId = null;
    this.isRunning = false;
    this.isPaused = false;
  }

  start(intervalMs) {
    if (this.isRunning) {
      this.stop();
    }

    this.isRunning = true;

    // Run initial sync
    this.syncAll();

    // Set up periodic sync
    this.intervalId = setInterval(() => {
      this.syncAll();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.isPaused = false;
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    // Trigger sync immediately on resume
    if (this.isRunning) {
      this.syncAll();
    }
  }

  async syncAll() {
    // Skip sync if paused
    if (this.isPaused) {
      console.log('Sync skipped: monitor is paused');
      return {
        downloaded: 0,
        errors: [],
        skipped: true,
        fromPlaylists: 0,
        fromLikes: 0
      };
    }

    const results = {
      downloaded: 0,
      errors: [],
      fromPlaylists: 0,
      fromLikes: 0,
      details: []
    };

    try {
      const monitoredUsers = this.store.get('monitoredUsers', []);
      const monitoredPlaylists = this.store.get('monitoredPlaylists', []);
      const downloadPath = this.store.get('downloadPath', '');

      if (!downloadPath) {
        results.errors.push('Download path not configured');
        return results;
      }

      // Monitor user likes
      for (const username of monitoredUsers) {
        try {
          console.log(`Checking likes for user: ${username}`);

          // First do a fast flat-playlist scan to get track IDs
          const trackIds = await this.getFlatTrackList(`https://soundcloud.com/${username}/likes`);
          const sourceKey = `user_${username}`;
          const syncedTracks = new Set(this.store.get(`synced_${sourceKey}`, []));

          // Filter to only new track IDs
          const newTrackIds = trackIds.filter(t => !syncedTracks.has(t.id));
          console.log(`Found ${newTrackIds.length} new tracks from ${username}'s likes (${trackIds.length} total)`);

          if (newTrackIds.length === 0) continue;

          // Only fetch full metadata for new tracks
          const newTracks = await this.getFullMetadata(newTrackIds);

          const successfullyDownloaded = [];
          for (const track of newTracks) {
            try {
              const result = await this.downloader.downloadTrack(track, downloadPath);
              if (result && result.success && !result.skipped) {
                results.downloaded++;
                results.fromLikes++;
                results.details.push({ source: `${username} (likes)`, track: track.title });
                successfullyDownloaded.push(track);
              }
            } catch (error) {
              results.errors.push(`Failed to download ${track.title}: ${error.message}`);
            }
          }

          if (successfullyDownloaded.length > 0) {
            this.updateSyncedTracks(successfullyDownloaded, sourceKey);
          }
        } catch (error) {
          results.errors.push(`Failed to fetch likes for ${username}: ${error.message}`);
        }
      }

      // Monitor playlists
      for (const playlistUrl of monitoredPlaylists) {
        try {
          console.log(`Checking playlist: ${playlistUrl}`);

          // First do a fast flat-playlist scan to get track IDs
          const trackIds = await this.getFlatTrackList(playlistUrl);
          const playlistId = this.extractPlaylistId(playlistUrl);
          const sourceKey = `playlist_${playlistId}`;
          const syncedTracks = new Set(this.store.get(`synced_${sourceKey}`, []));

          // Filter to only new track IDs
          const newTrackIds = trackIds.filter(t => !syncedTracks.has(t.id));
          console.log(`Found ${newTrackIds.length} new tracks in playlist (${trackIds.length} total)`);

          if (newTrackIds.length === 0) {
            console.log('All tracks from this playlist already downloaded');
            continue;
          }

          // Only fetch full metadata for new tracks
          const newTracks = await this.getFullMetadata(newTrackIds);

          const successfullyDownloaded = [];
          for (const track of newTracks) {
            try {
              console.log(`Downloading: ${track.title} - ${track.artist}`);
              const result = await this.downloader.downloadTrack(track, downloadPath);
              if (result && result.success && !result.skipped) {
                results.downloaded++;
                results.fromPlaylists++;
                results.details.push({ source: 'playlist', track: track.title });
                successfullyDownloaded.push(track);
              }
            } catch (error) {
              console.error(`Error downloading ${track.title}:`, error);
              results.errors.push(`Failed to download ${track.title}: ${error.message}`);
            }
          }

          if (successfullyDownloaded.length > 0) {
            this.updateSyncedTracks(successfullyDownloaded, sourceKey);
            console.log(`Updated sync history for playlist`);
          }
        } catch (error) {
          console.error(`Error fetching playlist ${playlistUrl}:`, error);
          results.errors.push(`Failed to fetch playlist ${playlistUrl}: ${error.message}`);
        }
      }
    } catch (error) {
      results.errors.push(`Sync error: ${error.message}`);
    }

    return results;
  }

  /**
   * Fast flat-playlist scan to get track IDs without full metadata.
   * Uses spawn() to avoid shell injection.
   */
  async getFlatTrackList(url) {
    const ytdlpPath = getYtDlpPath();
    const args = [...YTDLP_NETWORK_ARGS, '--flat-playlist', '-j', url];

    const attempt = () => new Promise((resolve, reject) => {
      const proc = spawn(ytdlpPath, args, { timeout: 5 * 60 * 1000 });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('error', (error) => {
        if (error.message.includes('ENOENT') || error.message.includes('not found')) {
          reject(new Error('yt-dlp is not installed. Please install yt-dlp to enable monitoring.'));
        } else {
          reject(error);
        }
      });

      proc.on('close', (code) => {
        if (code !== 0 && isRateLimitMessage(stderr)) {
          const err = new Error(stderr.trim() || 'Rate limited');
          err.rateLimited = true;
          reject(err);
          return;
        }

        if (!stdout) { resolve([]); return; }

        const tracks = [];
        const lines = stdout.trim().split('\n');

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            tracks.push({
              id: data.id,
              url: data.url || data.webpage_url
            });
          } catch (e) {
            // skip unparseable lines
          }
        }

        resolve(tracks);
      });
    });

    // App-level retry on top of yt-dlp's own retries — covers cases where the
    // extractor itself bails before yt-dlp's HTTP retry kicks in.
    const maxAttempts = 3;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await attempt();
      } catch (error) {
        const isLast = i === maxAttempts - 1;
        if (isLast || !error.rateLimited) {
          console.error(`Error fetching flat track list for ${url}:`, error.message);
          return [];
        }
        const waitMs = 15000 * Math.pow(2, i); // 15s, 30s, 60s
        console.warn(`Rate limited on flat scan, waiting ${waitMs / 1000}s before retry...`);
        await sleep(waitMs);
      }
    }
    return [];
  }

  /**
   * Fetch full metadata for specific tracks (title, artist, etc.).
   * Uses spawn() to avoid shell injection.
   */
  async getFullMetadata(trackList) {
    const tracks = [];
    const ytdlpPath = getYtDlpPath();
    const interTrackDelayMs = 1500;

    const fetchOne = (trackUrl) => new Promise((resolve, reject) => {
      const args = [...YTDLP_NETWORK_ARGS, '--dump-json', '--skip-download', trackUrl];
      const proc = spawn(ytdlpPath, args, { timeout: 60000 });
      let out = '';
      let err = '';

      proc.stdout.on('data', (data) => { out += data.toString(); });
      proc.stderr.on('data', (data) => { err += data.toString(); });

      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0 && out) {
          resolve(out);
          return;
        }
        const error = new Error(err || `yt-dlp exited with code ${code}`);
        if (isRateLimitMessage(err)) error.rateLimited = true;
        reject(error);
      });
    });

    for (let i = 0; i < trackList.length; i++) {
      const item = trackList[i];
      const trackUrl = item.url || `https://soundcloud.com/track/${item.id}`;

      if (i > 0) await sleep(interTrackDelayMs);

      let stdout = null;
      const maxAttempts = 3;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          stdout = await fetchOne(trackUrl);
          break;
        } catch (e) {
          const isLast = attempt === maxAttempts - 1;
          if (e.rateLimited && !isLast) {
            const waitMs = 15000 * Math.pow(2, attempt); // 15s, 30s, 60s
            console.warn(`Rate limited on metadata for ${item.id}, waiting ${waitMs / 1000}s...`);
            await sleep(waitMs);
            continue;
          }
          console.error(`Failed to fetch metadata for track ${item.id}:`, e.message);
          break;
        }
      }

      if (stdout) {
        try {
          const data = JSON.parse(stdout.trim());
          tracks.push({
            id: data.id || item.id,
            title: data.title || data.track || 'Unknown Track',
            url: data.webpage_url || data.url || trackUrl,
            artist: data.uploader || data.artist || 'Unknown',
            duration: data.duration,
            artwork: data.thumbnail
          });
          continue;
        } catch (parseErr) {
          console.error(`Failed to parse metadata for track ${item.id}:`, parseErr.message);
        }
      }

      // Fall back to minimal info so we can still attempt the download
      if (item.url) {
        tracks.push({
          id: item.id,
          title: `Track ${item.id}`,
          url: item.url,
          artist: 'Unknown'
        });
      }
    }

    return tracks;
  }

  updateSyncedTracks(newTracks, sourceKey) {
    const syncedTracks = this.store.get(`synced_${sourceKey}`, []);
    const newIds = newTracks.map(t => t.id);
    const updated = [...new Set([...syncedTracks, ...newIds])];

    // Keep only last 1000 IDs to prevent unlimited growth
    if (updated.length > 1000) {
      updated.splice(0, updated.length - 1000);
    }

    this.store.set(`synced_${sourceKey}`, updated);
  }

  extractPlaylistId(url) {
    // Extract unique identifier from URL
    const match = url.match(/soundcloud\.com\/([^\/]+)\/sets\/([^\/\?]+)/);
    if (match) {
      return `${match[1]}_${match[2]}`;
    }
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

module.exports = SoundCloudMonitor;
