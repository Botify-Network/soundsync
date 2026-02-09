const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const Store = require('electron-store');
const SoundCloudMonitor = require('./services/soundcloud-monitor');
const Downloader = require('./services/downloader');

// Initialize persistent storage
const store = new Store();

let tray = null;
let settingsWindow = null;
let monitor = null;
let downloader = null;

// Status tracking
let appStatus = {
  operational: true,
  currentActivity: 'Idle',
  syncStatus: 'Ready',
  lastSync: null,
  downloadCount: 0
};

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (settingsWindow) {
      if (settingsWindow.isMinimized()) settingsWindow.restore();
      settingsWindow.focus();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  tray = new Tray(iconPath);

  updateTrayMenu();

  tray.setToolTip('SoundCloud - Auto Sync/Downloader');

  tray.on('click', () => {
    if (settingsWindow) {
      settingsWindow.isVisible() ? settingsWindow.hide() : settingsWindow.show();
    } else {
      createSettingsWindow();
    }
  });
}

function updateTrayMenu() {
  const isMonitoring = store.get('autoSync', false);
  const isPaused = monitor && monitor.isPaused;

  // Format last sync time
  let lastSyncText = '';
  if (appStatus.lastSync) {
    const now = new Date();
    const diff = Math.floor((now - appStatus.lastSync) / 1000 / 60); // minutes
    if (diff < 1) lastSyncText = ' (Just now)';
    else if (diff < 60) lastSyncText = ` (${diff}m ago)`;
    else lastSyncText = ` (${Math.floor(diff / 60)}h ago)`;
  }

  const menuTemplate = [
    {
      label: 'SoundCloud - Auto Sync/Downloader',
      enabled: false
    },
    { type: 'separator' },
    // STATUS SECTION
    {
      label: `Status: ${appStatus.currentActivity}`,
      enabled: false
    },
    {
      label: `Connection: ${appStatus.operational ? 'Operational' : 'Offline'}`,
      enabled: false
    },
    {
      label: `Sync: ${appStatus.syncStatus}${lastSyncText}`,
      enabled: false
    },
    {
      label: `Downloaded: ${appStatus.downloadCount} tracks`,
      enabled: false
    },
    { type: 'separator' },
    // ACTIONS
    {
      label: 'Download URL...',
      click: () => {
        promptForURL();
      }
    },
    {
      label: 'Sync Now',
      click: () => {
        syncNow();
      }
    },
    {
      label: isPaused ? 'Resume Syncing' : 'Pause Syncing',
      visible: isMonitoring,
      click: () => {
        togglePause();
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        createSettingsWindow();
      }
    },
    {
      label: isMonitoring ? 'Auto-Sync: ON' : 'Auto-Sync: OFF',
      type: 'checkbox',
      checked: isMonitoring,
      click: (menuItem) => {
        toggleAutoSync(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Open Download Folder',
      click: () => {
        const downloadPath = store.get('downloadPath', app.getPath('music'));
        shell.openPath(downloadPath);
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        app.quit();
      }
    }
  ];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
}

function promptForURL() {
  // Create a simple input dialog using BrowserWindow
  const inputWindow = new BrowserWindow({
    width: 500,
    height: 200,
    modal: true,
    show: false,
    frame: true,
    title: 'Download from URL',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  inputWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
          padding: 20px;
          background: #1e293b;
          color: #e2e8f0;
          margin: 0;
        }
        h3 {
          margin-top: 0;
          color: #f1f5f9;
          font-weight: 600;
          text-align: center;
        }
        input {
          width: 100%;
          padding: 10px;
          margin: 10px 0;
          border: 1px solid #475569;
          border-radius: 6px;
          background: #0f172a;
          color: #e2e8f0;
          font-size: 14px;
          box-sizing: border-box;
        }
        input:focus {
          outline: none;
          border-color: #3B82F6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
        .buttons {
          display: flex;
          gap: 10px;
          margin-top: 20px;
        }
        button {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        }
        .download {
          background: #3B82F6;
          color: white;
        }
        .download:hover { background: #2563eb; }
        .cancel {
          background: #334155;
          color: #e2e8f0;
        }
        .cancel:hover { background: #475569; }
      </style>
    </head>
    <body>
      <h3>Download from SoundCloud URL</h3>
      <input type="text" id="url" placeholder="Enter SoundCloud track or playlist URL" autofocus />
      <div class="buttons">
        <button class="download" onclick="download()">Download</button>
        <button class="cancel" onclick="cancel()">Cancel</button>
      </div>
      <script>
        const { ipcRenderer } = require('electron');

        document.getElementById('url').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') download();
        });

        function download() {
          const url = document.getElementById('url').value.trim();
          if (url) {
            ipcRenderer.send('download-url', url);
            window.close();
          }
        }

        function cancel() {
          window.close();
        }
      </script>
    </body>
    </html>
  `)}`);

  inputWindow.once('ready-to-show', () => {
    inputWindow.show();
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 900,
    height: 650,
    title: 'SoundCloud - Auto Sync/Downloader',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

async function syncNow() {
  if (!monitor) {
    monitor = new SoundCloudMonitor(store, downloader);
  }

  // Check if anything is configured
  const monitoredUsers = store.get('monitoredUsers', []);
  const monitoredPlaylists = store.get('monitoredPlaylists', []);

  if (monitoredUsers.length === 0 && monitoredPlaylists.length === 0) {
    appStatus.syncStatus = 'Not Configured';
    updateTrayMenu();
    tray.displayBalloon({
      title: 'Nothing to Sync',
      content: 'Please add users or playlists in Settings first.\n\nRight-click > Settings > Add playlists or users'
    });
    return;
  }

  // Check download folder permissions first
  const downloadPath = store.get('downloadPath', app.getPath('music'));
  const permCheck = await downloader.checkWritePermission(downloadPath);
  if (!permCheck.success) {
    tray.displayBalloon({
      title: 'Permission Error',
      content: `Cannot write to download folder:\n${downloadPath}\n\nOpen Settings to choose a different folder.`
    });
    appStatus.currentActivity = 'Idle';
    appStatus.syncStatus = 'Permission Error';
    updateTrayMenu();
    return;
  }

  console.log(`Starting sync with ${monitoredUsers.length} users and ${monitoredPlaylists.length} playlists`);

  // Update status
  appStatus.currentActivity = 'Syncing...';
  appStatus.syncStatus = 'In Progress';
  updateTrayMenu();
  tray.setToolTip('SoundCloud - Syncing...');

  monitor.syncAll()
    .then((results) => {
      // Update status
      appStatus.currentActivity = 'Idle';
      appStatus.syncStatus = 'Complete';
      appStatus.lastSync = new Date();
      appStatus.downloadCount += results.downloaded;
      store.set('downloadCount', appStatus.downloadCount);
      updateTrayMenu();

      tray.setToolTip('SoundCloud - Sync Complete');

      if (results.downloaded > 0) {
        // Build detailed message
        let message = `Downloaded ${results.downloaded} new track(s)`;

        const parts = [];
        if (results.fromPlaylists > 0) {
          parts.push(`${results.fromPlaylists} from playlists`);
        }
        if (results.fromLikes > 0) {
          parts.push(`${results.fromLikes} from likes`);
        }

        if (parts.length > 0) {
          message += `\n(${parts.join(', ')})`;
        }

        tray.displayBalloon({
          title: 'Sync Complete',
          content: message
        });

        console.log('Sync complete:', JSON.stringify(results));
      } else {
        // No new tracks
        console.log('Sync complete: No new tracks found');
      }

      setTimeout(() => {
        tray.setToolTip('SoundCloud - Auto Sync/Downloader');
      }, 3000);
    })
    .catch((error) => {
      console.error('Sync error:', error);

      // Update status on error
      appStatus.currentActivity = 'Idle';
      appStatus.syncStatus = 'Error';
      appStatus.operational = false;
      updateTrayMenu();

      tray.displayBalloon({
        title: 'Sync Error',
        content: 'Failed to sync. Check your internet connection.'
      });
      tray.setToolTip('SoundCloud - Auto Sync/Downloader');

      // Reset operational status after 30 seconds
      setTimeout(() => {
        appStatus.operational = true;
        appStatus.syncStatus = 'Ready';
        updateTrayMenu();
      }, 30000);
    });
}

function toggleAutoSync(enabled) {
  store.set('autoSync', enabled);
  updateTrayMenu();

  if (enabled) {
    startMonitoring();
  } else {
    stopMonitoring();
  }
}

function startMonitoring() {
  if (!monitor) {
    monitor = new SoundCloudMonitor(store, downloader);
  }

  const interval = store.get('syncInterval', 15); // minutes
  monitor.start(interval * 60 * 1000);

  tray.displayBalloon({
    title: 'Auto-Sync Enabled',
    content: `Checking for new tracks every ${interval} minutes`
  });
}

function stopMonitoring() {
  if (monitor) {
    monitor.stop();
  }

  tray.displayBalloon({
    title: 'Auto-Sync Disabled',
    content: 'Automatic monitoring has been stopped'
  });
}

function togglePause() {
  if (!monitor) {
    return;
  }

  if (monitor.isPaused) {
    // Resume
    monitor.resume();
    appStatus.syncStatus = 'Resumed';
    updateTrayMenu();
    tray.displayBalloon({
      title: 'Syncing Resumed',
      content: 'Automatic syncing has been resumed'
    });
  } else {
    // Pause
    monitor.pause();
    appStatus.syncStatus = 'Paused';
    updateTrayMenu();
    tray.displayBalloon({
      title: 'Syncing Paused',
      content: 'Automatic syncing has been paused'
    });
  }
}

// Helper to get yt-dlp path
function getYtDlpPath() {
  if (process.resourcesPath) {
    const bundledPath = path.join(process.resourcesPath, 'yt-dlp.exe');
    if (fs.existsSync(bundledPath)) return bundledPath;
  }
  const devPath = path.join(__dirname, '..', 'resources', 'yt-dlp.exe');
  if (fs.existsSync(devPath)) return devPath;
  return 'yt-dlp';
}

// Helper to get ffmpeg path
function getFfmpegPath() {
  if (process.resourcesPath) {
    const bundledPath = path.join(process.resourcesPath, 'ffmpeg.exe');
    if (fs.existsSync(bundledPath)) return bundledPath;
  }
  const devPath = path.join(__dirname, '..', 'resources', 'ffmpeg.exe');
  if (fs.existsSync(devPath)) return devPath;
  return 'ffmpeg';
}

// IPC handlers
ipcMain.on('download-url', async (event, url) => {
  try {
    // Check if it's a playlist
    const isPlaylist = url.includes('/sets/');

    const downloadPath = store.get('downloadPath', app.getPath('music'));

    // Pre-check write permission
    const permCheck = await downloader.checkWritePermission(downloadPath);
    if (!permCheck.success) {
      dialog.showErrorBox('Permission Error',
        `${permCheck.error}\n\nTo fix this:\n` +
        `1. Open Settings and choose a different download folder\n` +
        `2. Or right-click the app and "Run as Administrator"\n` +
        `3. Or check if antivirus is blocking the folder`
      );
      return;
    }

    // Update status
    appStatus.currentActivity = isPlaylist ? 'Downloading Playlist...' : 'Downloading...';
    updateTrayMenu();

    if (isPlaylist) {
      tray.displayBalloon({
        title: 'Playlist Download Started',
        content: 'Downloading all tracks from playlist. This may take a while...'
      });
    }

    const result = await downloader.downloadFromURL(url, downloadPath);

    // Update status
    appStatus.currentActivity = 'Idle';

    // Only increment count for single tracks, not playlists
    if (!result.isPlaylist) {
      appStatus.downloadCount++;
      store.set('downloadCount', appStatus.downloadCount);
    }

    updateTrayMenu();

    if (result.isPlaylist) {
      tray.displayBalloon({
        title: 'Playlist Download Complete',
        content: `All tracks from playlist downloaded to:\n${downloadPath}`
      });
    } else {
      tray.displayBalloon({
        title: 'Download Complete',
        content: 'Track downloaded successfully'
      });
    }
  } catch (error) {
    appStatus.currentActivity = 'Idle';
    updateTrayMenu();

    const errorMsg = error.message || 'Unknown error occurred';
    console.error('Download error:', errorMsg);

    dialog.showErrorBox('Download Error',
      `${errorMsg}\n\nMake sure:\n` +
      `1. The URL is valid\n` +
      `2. You have an internet connection`
    );
  }
});

ipcMain.on('get-settings', (event) => {
  event.reply('settings-data', {
    downloadPath: store.get('downloadPath', app.getPath('music')),
    autoSync: store.get('autoSync', false),
    syncInterval: store.get('syncInterval', 15),
    autoStart: store.get('autoStart', false),
    monitoredUsers: store.get('monitoredUsers', []),
    monitoredPlaylists: store.get('monitoredPlaylists', [])
  });
});

ipcMain.on('get-status', (event) => {
  event.reply('status-data', {
    ...appStatus,
    lastSync: appStatus.lastSync ? appStatus.lastSync.toISOString() : null
  });
});

ipcMain.on('save-settings', (event, settings) => {
  store.set('downloadPath', settings.downloadPath);
  store.set('syncInterval', settings.syncInterval);
  store.set('autoStart', settings.autoStart);
  store.set('monitoredUsers', settings.monitoredUsers);
  store.set('monitoredPlaylists', settings.monitoredPlaylists);

  // Handle auto-start
  if (settings.autoStart) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath
    });
  } else {
    app.setLoginItemSettings({
      openAtLogin: false
    });
  }

  event.reply('settings-saved');

  // Restart monitoring if active
  if (store.get('autoSync')) {
    stopMonitoring();
    startMonitoring();
  }

  updateTrayMenu();
});

ipcMain.on('choose-folder', async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    defaultPath: store.get('downloadPath', app.getPath('music'))
  });

  if (!result.canceled) {
    event.reply('folder-chosen', result.filePaths[0]);
  }
});

ipcMain.on('test-sync', async (event) => {
  try {
    await syncNow();
    event.reply('test-sync-complete', { success: true });
  } catch (error) {
    event.reply('test-sync-complete', { success: false, error: error.message });
  }
});

ipcMain.on('check-ytdlp-update', async (event) => {
  try {
    const updateInfo = await downloader.checkYtDlpUpdate();
    event.reply('ytdlp-update-info', updateInfo);
  } catch (error) {
    event.reply('ytdlp-update-info', { error: error.message });
  }
});

ipcMain.on('update-ytdlp', async (event) => {
  try {
    const result = await downloader.updateYtDlp((progress) => {
      event.reply('ytdlp-update-progress', progress);
    });
    event.reply('ytdlp-update-result', result);
  } catch (error) {
    event.reply('ytdlp-update-result', { success: false, error: error.message });
  }
});

ipcMain.on('get-ytdlp-version', async (event) => {
  try {
    const version = await downloader.getYtDlpVersion();
    event.reply('ytdlp-version', { version });
  } catch (error) {
    event.reply('ytdlp-version', { error: error.message });
  }
});

// Diagnostics handler
ipcMain.on('run-diagnostics', async (event) => {
  let passed = 0;
  let failed = 0;

  // Test 1: yt-dlp
  event.reply('diagnostic-update', { test: 'ytdlp', status: 'running', message: 'Checking yt-dlp...' });
  try {
    const ytdlpPath = getYtDlpPath();
    const { stdout } = await execPromise(`"${ytdlpPath}" --version`, { timeout: 10000 });
    const version = stdout.trim();
    event.reply('diagnostic-update', { test: 'ytdlp', status: 'pass', message: `yt-dlp ${version} installed` });
    passed++;
  } catch (error) {
    event.reply('diagnostic-update', { test: 'ytdlp', status: 'fail', message: 'yt-dlp not found or not working' });
    failed++;
  }

  // Test 2: ffmpeg
  event.reply('diagnostic-update', { test: 'ffmpeg', status: 'running', message: 'Checking ffmpeg...' });
  try {
    const ffmpegPath = getFfmpegPath();
    await execPromise(`"${ffmpegPath}" -version`, { timeout: 10000 });
    event.reply('diagnostic-update', { test: 'ffmpeg', status: 'pass', message: 'ffmpeg is available' });
    passed++;
  } catch (error) {
    event.reply('diagnostic-update', { test: 'ffmpeg', status: 'fail', message: 'ffmpeg not found - audio conversion may fail' });
    failed++;
  }

  // Test 3: Write permissions
  event.reply('diagnostic-update', { test: 'permissions', status: 'running', message: 'Testing write permissions...' });
  try {
    const downloadPath = store.get('downloadPath', app.getPath('music'));
    const result = await downloader.checkWritePermission(downloadPath);
    if (result.success) {
      event.reply('diagnostic-update', { test: 'permissions', status: 'pass', message: `Can write to ${downloadPath}` });
      passed++;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    event.reply('diagnostic-update', { test: 'permissions', status: 'fail', message: error.message || 'Cannot write to download folder' });
    failed++;
  }

  // Test 4: SoundCloud connection
  event.reply('diagnostic-update', { test: 'soundcloud', status: 'running', message: 'Connecting to SoundCloud...' });
  try {
    const ytdlpPath = getYtDlpPath();
    await execPromise(`"${ytdlpPath}" --flat-playlist --playlist-items 1 -j "https://soundcloud.com/discover"`, { timeout: 30000 });
    event.reply('diagnostic-update', { test: 'soundcloud', status: 'pass', message: 'Connected to SoundCloud successfully' });
    passed++;
  } catch (error) {
    event.reply('diagnostic-update', { test: 'soundcloud', status: 'fail', message: 'Cannot connect to SoundCloud' });
    failed++;
  }

  // Complete
  event.reply('diagnostic-complete', { passed, failed });
});

ipcMain.on('fetch-playlist-metadata', async (event, url) => {
  try {
    console.log(`Fetching metadata for playlist: ${url}`);

    // Get yt-dlp path (bundled or system)
    let ytdlpPath = 'yt-dlp';
    if (process.resourcesPath) {
      const bundledPath = path.join(process.resourcesPath, 'yt-dlp.exe');
      if (fs.existsSync(bundledPath)) {
        ytdlpPath = `"${bundledPath}"`;
      }
    } else {
      const devPath = path.join(__dirname, '..', 'resources', 'yt-dlp.exe');
      if (fs.existsSync(devPath)) {
        ytdlpPath = `"${devPath}"`;
      }
    }

    const command = `${ytdlpPath} --dump-json --flat-playlist --playlist-items 1 "${url}"`;

    const { stdout } = await execPromise(command, {
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });

    if (stdout) {
      const data = JSON.parse(stdout.trim().split('\n')[0]);
      event.reply('playlist-metadata-result', {
        success: true,
        url: url,
        metadata: {
          title: data.playlist_title || data.playlist || data.title,
          uploader: data.playlist_uploader || data.uploader || data.channel
        }
      });
    } else {
      throw new Error('No metadata returned');
    }
  } catch (error) {
    console.error('Error fetching playlist metadata:', error.message);
    event.reply('playlist-metadata-result', {
      success: false,
      url: url,
      error: error.message
    });
  }
});

// App lifecycle
app.whenReady().then(() => {
  // Initialize downloader
  downloader = new Downloader();

  // Load saved download count
  appStatus.downloadCount = store.get('downloadCount', 0);

  // Create tray
  createTray();

  // Update menu every 60 seconds to refresh "last sync" time
  setInterval(() => {
    updateTrayMenu();
  }, 60000);

  // Safety mechanism: Reset status if stuck for too long
  let lastActivityChange = Date.now();
  let lastActivity = appStatus.currentActivity;

  setInterval(() => {
    const now = Date.now();

    // If activity changed, update timestamp
    if (appStatus.currentActivity !== lastActivity) {
      lastActivityChange = now;
      lastActivity = appStatus.currentActivity;
      return;
    }

    // If stuck in downloading/syncing state for more than 35 minutes, reset
    const stuckStates = ['Downloading...', 'Downloading Playlist...', 'Syncing...'];
    const isStuck = stuckStates.includes(appStatus.currentActivity);
    const stuckDuration = now - lastActivityChange;
    const maxStuckTime = 35 * 60 * 1000; // 35 minutes

    if (isStuck && stuckDuration > maxStuckTime) {
      console.warn(`Status stuck in "${appStatus.currentActivity}" for ${Math.floor(stuckDuration / 60000)} minutes - resetting`);

      appStatus.currentActivity = 'Idle';
      appStatus.syncStatus = 'Error - Timed Out';
      appStatus.operational = false;
      updateTrayMenu();

      tray.displayBalloon({
        title: 'Operation Timed Out',
        content: 'The download/sync operation took too long and was reset. Check your internet connection and try again.'
      });

      // Reset operational status after 1 minute
      setTimeout(() => {
        appStatus.operational = true;
        appStatus.syncStatus = 'Ready';
        updateTrayMenu();
      }, 60000);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  // Start monitoring if auto-sync is enabled
  if (store.get('autoSync', false)) {
    startMonitoring();
  }

  // Check for yt-dlp updates on startup (silently, in background)
  setTimeout(async () => {
    try {
      const updateInfo = await downloader.checkYtDlpUpdate();
      if (updateInfo.updateAvailable) {
        console.log(`yt-dlp update available: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);
        tray.displayBalloon({
          title: 'yt-dlp Update Available',
          content: `Version ${updateInfo.latestVersion} is available.\nOpen Settings to update.`
        });
      }
    } catch (error) {
      console.log('Failed to check for yt-dlp updates:', error.message);
    }
  }, 5000); // Check 5 seconds after startup

  // Don't show window on start - run in background
  app.dock?.hide(); // Hide dock icon on macOS
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Don't quit when windows are closed
});

app.on('before-quit', () => {
  if (monitor) {
    monitor.stop();
  }
});
