const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Send messages to main process
  send: (channel, data) => {
    const allowed = [
      'get-settings', 'save-settings', 'get-status',
      'choose-folder', 'test-sync',
      'check-ytdlp-update', 'update-ytdlp', 'get-ytdlp-version',
      'run-diagnostics', 'fetch-playlist-metadata', 'download-url',
      'check-app-update', 'download-app-update', 'install-app-update'
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // Receive messages from main process
  on: (channel, callback) => {
    const allowed = [
      'settings-data', 'settings-saved', 'status-data',
      'folder-chosen', 'test-sync-complete',
      'ytdlp-update-info', 'ytdlp-update-progress', 'ytdlp-update-result',
      'ytdlp-version',
      'diagnostic-update', 'diagnostic-complete',
      'playlist-metadata-result',
      'app-update-info', 'app-update-download-started'
    ];
    if (allowed.includes(channel)) {
      const sub = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, sub);
      // Return unsubscribe function
      return () => ipcRenderer.removeListener(channel, sub);
    }
  },

  // One-time listener
  once: (channel, callback) => {
    const allowed = [
      'settings-data', 'settings-saved', 'status-data',
      'folder-chosen', 'test-sync-complete',
      'playlist-metadata-result'
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.once(channel, (event, ...args) => callback(...args));
    }
  },

  // Remove specific listener (for playlist metadata handler pattern)
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // Get app version synchronously
  getAppVersion: () => {
    return ipcRenderer.sendSync('get-app-version');
  },

  // Shell operations
  openPath: (filePath) => {
    shell.openPath(filePath);
  }
});
