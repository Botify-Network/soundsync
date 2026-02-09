const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendDownloadUrl: (url) => {
    ipcRenderer.send('download-url', url);
  },
  closeWindow: () => {
    window.close();
  }
});
