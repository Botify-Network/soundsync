const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, powerSaveBlocker } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const SoundCloudMonitor = require('./services/soundcloud-monitor');
const Downloader = require('./services/downloader');
const { getYtDlpPath, getFfmpegPath } = require('./services/paths');
const { runCmd } = require('./main/run-cmd');
const { migrateUserDataFromLegacy } = require('./main/user-data-migration');

// Brand identity — must run before app.whenReady() so Windows uses the
// SoundSync name for taskbar/notification grouping and the userData folder.
app.setName('SoundSync');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.botify.soundsync');
}

// One-time migration from the pre-rebrand userData folder.
migrateUserDataFromLegacy(app);

// Initialize persistent storage
const store = new Store();

let tray = null;
let settingsWindow = null;
let monitor = null;
let downloader = null;
let powerSaveId = null;
let isSyncing = false;

// Pull current updater toggles from the store onto the electron-updater
// singleton. Safe to call repeatedly (e.g. after save-settings).
function applyAutoUpdaterSettings() {
  autoUpdater.autoDownload = store.get('autoUpdate', true);
  autoUpdater.autoInstallOnAppQuit = store.get('autoInstallOnQuit', true);
}

// Prevent system sleep during active operations
function blockSleep() {
  if (powerSaveId === null) {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
    console.log('Power save blocker started:', powerSaveId);
  }
}

function unblockSleep() {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
    console.log('Power save blocker stopped:', powerSaveId);
    powerSaveId = null;
  }
}

// Status tracking
let appStatus = {
  operational: true,
  currentActivity: 'Idle',
  syncStatus: 'Ready',
  lastSync: null,
  downloadCount: 0,
  // Populated by autoUpdater event handlers. null = no pending update.
  // Otherwise: { version, downloaded: bool }.
  updateAvailable: null
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

  tray.setToolTip('SoundSync');

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
      label: 'SoundSync',
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
      preload: path.join(__dirname, 'preload-input.js'),
      contextIsolation: true,
      nodeIntegration: false
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
        <button class="download" onclick="doDownload()">Download</button>
        <button class="cancel" onclick="doCancel()">Cancel</button>
      </div>
      <script>
        document.getElementById('url').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') doDownload();
        });

        function doDownload() {
          const url = document.getElementById('url').value.trim();
          if (url) {
            window.api.sendDownloadUrl(url);
            window.api.closeWindow();
          }
        }

        function doCancel() {
          window.api.closeWindow();
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
    width: 1040,
    height: 740,
    minWidth: 860,
    minHeight: 640,
    title: 'SoundSync',
    icon: path.join(__dirname, '../assets/brand/SoundSync_taskbar_icon.ico'),
    backgroundColor: '#050b18',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

async function syncNow() {
  if (isSyncing) {
    console.log('Sync already in progress, skipping');
    return;
  }

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
  isSyncing = true;
  appStatus.currentActivity = 'Syncing...';
  appStatus.syncStatus = 'In Progress';
  updateTrayMenu();
  tray.setToolTip('SoundSync — Syncing...');
  blockSleep();

  monitor.syncAll()
    .then((results) => {
      isSyncing = false;
      unblockSleep();

      // Update status
      appStatus.currentActivity = 'Idle';
      appStatus.syncStatus = 'Complete';
      appStatus.lastSync = new Date();
      appStatus.downloadCount += results.downloaded;
      store.set('downloadCount', appStatus.downloadCount);
      updateTrayMenu();

      tray.setToolTip('SoundSync — Sync Complete');

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
        tray.setToolTip('SoundSync');
      }, 3000);
    })
    .catch((error) => {
      isSyncing = false;
      unblockSleep();
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
      tray.setToolTip('SoundSync');

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

// IPC handlers
ipcMain.on('download-url', async (event, url) => {
  try {
    // Validate URL
    if (!url || !url.includes('soundcloud.com')) {
      dialog.showErrorBox('Invalid URL', 'Please enter a valid SoundCloud URL.');
      return;
    }

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
    blockSleep();

    if (isPlaylist) {
      tray.displayBalloon({
        title: 'Playlist Download Started',
        content: 'Downloading all tracks from playlist. This may take a while...'
      });
    }

    const result = await downloader.downloadFromURL(url, downloadPath);

    unblockSleep();
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
    unblockSleep();
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

// Return app version to renderer
ipcMain.on('get-app-version', (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.on('get-settings', (event) => {
  event.reply('settings-data', {
    downloadPath: store.get('downloadPath', app.getPath('music')),
    autoSync: store.get('autoSync', false),
    syncInterval: store.get('syncInterval', 15),
    autoStart: store.get('autoStart', false),
    skipThumbnail: store.get('skipThumbnail', false),
    autoUpdate: store.get('autoUpdate', true),
    autoInstallOnQuit: store.get('autoInstallOnQuit', true),
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
  store.set('skipThumbnail', settings.skipThumbnail || false);
  if (typeof settings.autoUpdate === 'boolean') store.set('autoUpdate', settings.autoUpdate);
  if (typeof settings.autoInstallOnQuit === 'boolean') store.set('autoInstallOnQuit', settings.autoInstallOnQuit);
  store.set('monitoredUsers', settings.monitoredUsers);
  store.set('monitoredPlaylists', settings.monitoredPlaylists);

  // Re-apply updater toggles immediately so the change takes effect without
  // requiring a restart.
  applyAutoUpdaterSettings();

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

// Manual app-update controls. Independent of the autoUpdate setting so users
// can check on demand even when automatic checks are disabled.
ipcMain.on('check-app-update', async (event) => {
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result && result.updateInfo;
    event.reply('app-update-info', {
      updateAvailable: !!(info && info.version && info.version !== app.getVersion()),
      version: info ? info.version : null,
      currentVersion: app.getVersion()
    });
  } catch (error) {
    event.reply('app-update-info', { error: error.message, currentVersion: app.getVersion() });
  }
});

ipcMain.on('download-app-update', async (event) => {
  try {
    // Force download even if autoDownload is off.
    await autoUpdater.downloadUpdate();
    event.reply('app-update-download-started', { success: true });
  } catch (error) {
    event.reply('app-update-download-started', { success: false, error: error.message });
  }
});

ipcMain.on('install-app-update', () => {
  // quitAndInstall() restarts the app via the installer. No reply — the
  // process is about to exit.
  try { autoUpdater.quitAndInstall(); } catch (e) { console.error('quitAndInstall failed:', e.message); }
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
    const { stdout } = await runCmd(ytdlpPath, ['--version'], 10000);
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
    // getFfmpegPath() returns the directory containing ffmpeg.exe (or null);
    // resolve to the actual binary so it's executable directly without a shell.
    const ffmpegDir = getFfmpegPath();
    const ffmpegBin = ffmpegDir ? path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : 'ffmpeg';
    await runCmd(ffmpegBin, ['-version'], 10000);
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
    await runCmd(ytdlpPath, ['--flat-playlist', '--playlist-items', '1', '-j', 'https://soundcloud.com/discover'], 30000);
    event.reply('diagnostic-update', { test: 'soundcloud', status: 'pass', message: 'Connected to SoundCloud successfully' });
    passed++;
  } catch (error) {
    const stderr = error.stderr || error.message || '';
    let message = 'Cannot connect to SoundCloud';
    if (stderr.includes('Unsupported URL') || stderr.includes('no suitable InfoExtractor')) {
      message = 'yt-dlp cannot extract from SoundCloud - try updating yt-dlp';
    } else if (stderr.includes('HTTP Error 403') || stderr.includes('HTTP Error 401')) {
      message = 'SoundCloud is blocking requests - try updating yt-dlp';
    } else if (stderr.includes('getaddrinfo') || stderr.includes('URLError') || stderr.includes('Connection refused')) {
      message = 'Cannot reach SoundCloud - check your internet connection';
    } else if (stderr.includes('timed out')) {
      message = 'Connection to SoundCloud timed out';
    }
    event.reply('diagnostic-update', { test: 'soundcloud', status: 'fail', message });
    failed++;
  }

  // Complete
  event.reply('diagnostic-complete', { passed, failed });
});

ipcMain.on('fetch-playlist-metadata', async (event, url) => {
  try {
    // url comes from the renderer (user-supplied playlist URL). Validate
    // shape, then pass as an argv element so it can't be parsed as a shell
    // metacharacter sequence by any layer below us.
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || !url.includes('soundcloud.com')) {
      event.reply('playlist-metadata-result', {
        success: false,
        url,
        error: 'Invalid playlist URL'
      });
      return;
    }

    console.log(`Fetching metadata for playlist: ${url}`);

    const ytdlpPath = getYtDlpPath();
    const { stdout } = await runCmd(
      ytdlpPath,
      ['--dump-json', '--flat-playlist', '--playlist-items', '1', url],
      10000
    );

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
  downloader = new Downloader(store);

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
      unblockSleep();

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

  // Auto-updater: configurable. Defaults preserve prior behavior (auto-check,
  // auto-download, auto-install on quit) but are now user-toggleable.
  // - autoUpdate=false → no startup check, no auto-download. Manual "Check for
  //   updates" IPC still works and surfaces update info without downloading.
  // - autoInstallOnQuit=false → downloaded update is NOT silently applied on
  //   next quit; user must click "Install now" (which calls quitAndInstall).
  applyAutoUpdaterSettings();

  autoUpdater.on('update-available', (info) => {
    console.log('App update available:', info.version);
    appStatus.updateAvailable = { version: info.version, downloaded: false };
    const willDownload = autoUpdater.autoDownload;
    tray.displayBalloon({
      title: 'Update Available',
      content: willDownload
        ? `Version ${info.version} is downloading in the background.`
        : `Version ${info.version} is available. Open Settings to install.`
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('App is up to date:', info && info.version);
    appStatus.updateAvailable = null;
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('App update downloaded:', info.version);
    appStatus.updateAvailable = { version: info.version, downloaded: true };
    const willAutoInstall = autoUpdater.autoInstallOnAppQuit;
    tray.displayBalloon({
      title: 'Update Ready',
      content: willAutoInstall
        ? `Version ${info.version} will be installed on next restart.`
        : `Version ${info.version} downloaded. Open Settings to install now, or it will wait until you choose.`
    });
  });

  autoUpdater.on('error', (err) => {
    console.log('Auto-updater error:', err && err.message);
    // Surface to the user — prior code swallowed this to the console only,
    // which made silent-failure modes invisible.
    if (tray) {
      tray.displayBalloon({
        title: 'Update Check Failed',
        content: (err && err.message) ? err.message.slice(0, 200) : 'Unknown error'
      });
    }
  });

  if (store.get('autoUpdate', true)) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        console.log('Update check failed:', err.message);
      });
    }, 10000);
  } else {
    console.log('Auto-update is disabled. Skipping startup check.');
  }

  // Don't show window on start - run in background
  app.dock?.hide(); // Hide dock icon on macOS
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Don't quit when windows are closed
});

app.on('before-quit', () => {
  unblockSleep();
  if (monitor) {
    monitor.stop();
  }
});
