const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const execPromise = util.promisify(exec);

/**
 * Get the path to yt-dlp executable
 * Checks bundled version first, then falls back to system PATH
 */
function getYtDlpPath() {
  // Check for bundled yt-dlp in resources folder (packaged app)
  if (process.resourcesPath) {
    const bundledPath = path.join(process.resourcesPath, 'yt-dlp.exe');
    if (fs.existsSync(bundledPath)) {
      return `"${bundledPath}"`;
    }
  }

  // Check for bundled yt-dlp in development mode
  const devPath = path.join(__dirname, '..', '..', 'resources', 'yt-dlp.exe');
  if (fs.existsSync(devPath)) {
    return `"${devPath}"`;
  }

  // Fall back to system PATH
  return 'yt-dlp';
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
      const downloadPath = this.store.get('downloadPath');

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
   * Fast flat-playlist scan to get track IDs without full metadata
   */
  async getFlatTrackList(url) {
    try {
      const ytdlpPath = getYtDlpPath();
      const command = `${ytdlpPath} --flat-playlist -j "${url}"`;

      const { stdout } = await execPromise(command, {
        maxBuffer: 1024 * 1024 * 50,
        timeout: 5 * 60 * 1000
      });

      if (!stdout) return [];

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

      return tracks;
    } catch (error) {
      console.error(`Error fetching flat track list for ${url}:`, error.message);
      if (error.message.includes('not found') || error.message.includes('not recognized')) {
        throw new Error('yt-dlp is not installed. Please install yt-dlp to enable monitoring.');
      }
      return [];
    }
  }

  /**
   * Fetch full metadata for specific tracks (title, artist, etc.)
   */
  async getFullMetadata(trackList) {
    const tracks = [];
    const ytdlpPath = getYtDlpPath();

    for (const item of trackList) {
      try {
        const trackUrl = item.url || `https://soundcloud.com/track/${item.id}`;
        const command = `${ytdlpPath} --dump-json --skip-download "${trackUrl}"`;

        const { stdout } = await execPromise(command, {
          maxBuffer: 1024 * 1024 * 5,
          timeout: 30000
        });

        if (stdout) {
          const data = JSON.parse(stdout.trim());
          tracks.push({
            id: data.id || item.id,
            title: data.title || data.track || 'Unknown Track',
            url: data.webpage_url || data.url || trackUrl,
            artist: data.uploader || data.artist || 'Unknown',
            duration: data.duration,
            artwork: data.thumbnail
          });
        }
      } catch (e) {
        console.error(`Failed to fetch metadata for track ${item.id}:`, e.message);
        // Still add with minimal info so we can attempt download
        if (item.url) {
          tracks.push({
            id: item.id,
            title: `Track ${item.id}`,
            url: item.url,
            artist: 'Unknown'
          });
        }
      }
    }

    return tracks;
  }

  filterNewTracks(tracks, sourceKey) {
    const syncedTracks = this.store.get(`synced_${sourceKey}`, []);
    const syncedIds = new Set(syncedTracks);

    return tracks.filter(track => !syncedIds.has(track.id));
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
