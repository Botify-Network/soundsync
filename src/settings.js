/* SoundSync settings UI — extracted from src/settings.html (PR-A, #2). Behavior unchanged. */
let settings = {};

// ── Page Navigation ──
function switchPage(page) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  // Update pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  // Update header
  const titles = {
    dashboard: ['Dashboard', 'Overview and quick actions'],
    downloads: ['Download Settings', 'Configure download path and behavior'],
    monitoring: ['Monitoring', 'Manage users and playlists to sync'],
    engine: ['Download Engine', 'yt-dlp version and updates'],
    diagnostics: ['Diagnostics', 'System health checks']
  };
  document.getElementById('pageTitle').textContent = titles[page][0];
  document.getElementById('pageDesc').textContent = titles[page][1];
}

// ── Set app version ──
try {
  const ver = window.api.getAppVersion();
  if (ver) document.getElementById('appVersion').textContent = 'v' + ver;
} catch (e) {}

// ── Load Settings ──
window.api.send('get-settings');
window.api.send('get-status');

window.api.on('settings-data', (data) => {
  settings = data;
  populateSettings();
});

window.api.on('status-data', (data) => {
  updateDashboardStatus(data);
});

function populateSettings() {
  document.getElementById('downloadPath').value = settings.downloadPath;
  document.getElementById('syncInterval').value = settings.syncInterval;
  document.getElementById('autoStart').checked = settings.autoStart;
  document.getElementById('autoSync').checked = settings.autoSync;
  document.getElementById('skipThumbnail').checked = settings.skipThumbnail || false;
  document.getElementById('autoUpdate').checked = settings.autoUpdate !== false;
  document.getElementById('autoInstallOnQuit').checked = settings.autoInstallOnQuit !== false;

  // Populate users
  const usersList = document.getElementById('usersList');
  usersList.innerHTML = '';
  (settings.monitoredUsers || []).forEach(user => {
    addUserItem(user);
  });

  // Populate playlists
  const playlistsList = document.getElementById('playlistsList');
  playlistsList.innerHTML = '';
  (settings.monitoredPlaylists || []).forEach(url => {
    addPlaylistItem(url);
  });

  updateDashboardSources();
  updateQuickFollowCheckboxes();
}

function updateDashboardStatus(data) {
  document.getElementById('statDownloads').textContent = data.downloadCount || 0;

  if (data.lastSync) {
    const d = new Date(data.lastSync);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000 / 60);
    if (diff < 1) document.getElementById('statLastSync').textContent = 'Just now';
    else if (diff < 60) document.getElementById('statLastSync').textContent = `${diff}m ago`;
    else document.getElementById('statLastSync').textContent = `${Math.floor(diff / 60)}h ago`;
  }

  document.getElementById('statSyncStatus').textContent = data.syncStatus || 'Ready';

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const footerDot = document.getElementById('footerStatusDot');
  const footerText = document.getElementById('footerStatusText');
  const operational = data.operational !== false;
  const label = operational ? (data.currentActivity || 'Ready') : 'Offline';

  statusDot.className = 'status-dot' + (operational ? '' : ' offline');
  statusText.textContent = label;
  if (footerText) footerText.textContent = label;
  if (footerDot) {
    footerDot.style.background = operational ? 'var(--botify-green)' : 'var(--botify-red)';
    footerDot.style.boxShadow = operational
      ? '0 0 8px rgba(34,224,122,0.7)'
      : '0 0 8px rgba(255,77,109,0.7)';
  }
}

// Build a `.list-item` node without using innerHTML, so values supplied by
// the user (usernames, playlist URLs, playlist titles) cannot inject markup.
function createListItem({ title, subtitle, marginBottom, removeHandler, datasetUrl }) {
  const item = document.createElement('div');
  item.className = 'list-item';
  if (marginBottom) item.style.marginBottom = marginBottom;
  if (datasetUrl != null) item.dataset.url = datasetUrl;

  const info = document.createElement('div');
  info.className = 'item-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'item-title';
  titleEl.textContent = title;

  const subEl = document.createElement('div');
  subEl.className = 'item-sub';
  subEl.textContent = subtitle;

  info.appendChild(titleEl);
  info.appendChild(subEl);
  item.appendChild(info);

  if (removeHandler) {
    const btn = document.createElement('button');
    btn.className = 'btn-danger btn-sm';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => removeHandler(btn));
    item.appendChild(btn);
  }

  return item;
}

function updateDashboardSources() {
  const users = settings.monitoredUsers || [];
  const playlists = settings.monitoredPlaylists || [];
  const el = document.getElementById('dashboardSources');

  // Reset container safely.
  while (el.firstChild) el.removeChild(el.firstChild);

  if (users.length === 0 && playlists.length === 0) {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';

    const icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '◎';
    wrap.appendChild(icon);

    const txt = document.createElement('div');
    txt.className = 'empty-state-text';

    const title = document.createElement('div');
    title.className = 'empty-state-title';
    title.textContent = 'No active sources configured';
    txt.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'empty-state-desc';
    desc.textContent = 'Add SoundCloud users or playlists from Monitoring to begin auto-sync.';
    txt.appendChild(desc);
    wrap.appendChild(txt);

    const btn = document.createElement('button');
    btn.className = 'btn-secondary btn-sm';
    btn.style.marginLeft = 'auto';
    btn.textContent = 'Configure Sources';
    btn.addEventListener('click', () => switchPage('monitoring'));
    wrap.appendChild(btn);

    el.appendChild(wrap);
    document.getElementById('statMonitoring').textContent = 'Off';
    document.getElementById('statMonitoringSub').textContent = 'No sources';
    updateSyncHealth();
    return;
  }

  users.forEach(u => {
    el.appendChild(createListItem({
      title: u,
      subtitle: 'User likes',
      marginBottom: '4px'
    }));
  });
  playlists.forEach(p => {
    const parts = String(p).split('/');
    const name = (parts[5] || 'playlist').replace(/-/g, ' ');
    el.appendChild(createListItem({
      title: name,
      subtitle: p,
      marginBottom: '4px'
    }));
  });

  const total = users.length + playlists.length;
  document.getElementById('statMonitoring').textContent = `${total}`;
  document.getElementById('statMonitoringSub').textContent = `${users.length} users, ${playlists.length} playlists`;
  updateSyncHealth();
}

function updateSyncHealth() {
  const users = settings.monitoredUsers || [];
  const playlists = settings.monitoredPlaylists || [];
  const total = users.length + playlists.length;
  const autoSync = !!settings.autoSync;

  const monEl = document.getElementById('healthMonitoring');
  const srcEl = document.getElementById('healthSources');
  if (!monEl || !srcEl) return;

  monEl.className = 'health-chip ' + (autoSync ? 'healthy' : 'muted');
  monEl.textContent = autoSync ? 'Monitoring enabled' : 'Monitoring disabled';

  if (total === 0) {
    srcEl.className = 'health-chip warning';
    srcEl.textContent = 'No active sources';
  } else {
    srcEl.className = 'health-chip info';
    srcEl.textContent = `${total} source${total === 1 ? '' : 's'} configured`;
  }
}

// ── Quick Follow Presets ──
function updateQuickFollowCheckboxes() {
  const users = settings.monitoredUsers || [];
  document.getElementById('followPrime').checked = users.includes('haus-of-prime');
  document.getElementById('followHighTexas').checked = users.includes('hightexas');
  document.getElementById('followVIP').checked = users.includes('willbrvip');

  const playlists = settings.monitoredPlaylists || [];
  document.getElementById('followPrimeJukebox').checked = playlists.includes('https://soundcloud.com/haus-of-prime/sets/jukebox');
}

function toggleQuickFollow(username, checked) {
  if (!settings.monitoredUsers) settings.monitoredUsers = [];

  if (checked) {
    if (!settings.monitoredUsers.includes(username)) {
      settings.monitoredUsers.push(username);
    }
  } else {
    const idx = settings.monitoredUsers.indexOf(username);
    if (idx > -1) settings.monitoredUsers.splice(idx, 1);
  }

  // Refresh the users list
  const usersList = document.getElementById('usersList');
  usersList.innerHTML = '';
  settings.monitoredUsers.forEach(user => addUserItem(user));
  updateDashboardSources();
}

function toggleQuickFollowPlaylist(playlistUrl, checked) {
  if (!settings.monitoredPlaylists) settings.monitoredPlaylists = [];

  if (checked) {
    if (!settings.monitoredPlaylists.includes(playlistUrl)) {
      settings.monitoredPlaylists.push(playlistUrl);
      addPlaylistItem(playlistUrl);
    }
  } else {
    const idx = settings.monitoredPlaylists.indexOf(playlistUrl);
    if (idx > -1) settings.monitoredPlaylists.splice(idx, 1);

    const playlistsList = document.getElementById('playlistsList');
    playlistsList.innerHTML = '';
    settings.monitoredPlaylists.forEach(url => addPlaylistItem(url));
  }
  updateDashboardSources();
}

// ── User Management ──
function addUserItem(username) {
  const usersList = document.getElementById('usersList');
  const item = createListItem({
    title: username,
    subtitle: `soundcloud.com/${username}/likes`,
    removeHandler: (btn) => removeUser(btn, username)
  });
  usersList.appendChild(item);
}

function addUser() {
  const input = document.getElementById('newUsername');
  const username = input.value.trim().replace(/^.*soundcloud\.com\//, '').replace(/\/.*$/, '');

  if (!username) {
    showToast('Please enter a username');
    return;
  }

  if (!settings.monitoredUsers) settings.monitoredUsers = [];
  if (settings.monitoredUsers.includes(username)) {
    showToast('User already being monitored');
    return;
  }

  settings.monitoredUsers.push(username);
  addUserItem(username);
  input.value = '';
  updateDashboardSources();
}

function removeUser(btn, username) {
  if (settings.monitoredUsers) {
    const idx = settings.monitoredUsers.indexOf(username);
    if (idx > -1) settings.monitoredUsers.splice(idx, 1);
  }
  btn.closest('.list-item').remove();
  updateDashboardSources();
}

// ── Playlist Management ──
async function addPlaylistItem(url) {
  if (!url) return;

  const playlistsList = document.getElementById('playlistsList');

  // Parse display name from URL
  const parts = String(url).split('/');
  const user = parts[3] || 'Unknown';
  const playlistSlug = parts[5] || 'Unknown';
  const playlistName = playlistSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const item = createListItem({
    title: `${playlistName} - ${user}`,
    subtitle: url,
    datasetUrl: url,
    removeHandler: (btn) => removePlaylist(btn)
  });
  playlistsList.appendChild(item);

  // Try to fetch real metadata in background
  try {
    const metadata = await fetchPlaylistMetadata(url);
    const title = metadata.title || playlistName;
    const uploader = metadata.uploader || user;
    item.querySelector('.item-title').textContent = `${title} - ${uploader}`;
  } catch (e) {
    // keep URL-parsed name
  }
}

async function fetchPlaylistMetadata(url) {
  return new Promise((resolve, reject) => {
    window.api.send('fetch-playlist-metadata', url);

    const timeout = setTimeout(() => {
      window.api.removeListener('playlist-metadata-result', handler);
      reject(new Error('Timeout'));
    }, 10000);

    const handler = (result) => {
      if (result.url !== url) return;
      clearTimeout(timeout);
      window.api.removeListener('playlist-metadata-result', handler);
      if (result.success) resolve(result.metadata);
      else reject(new Error(result.error));
    };

    window.api.on('playlist-metadata-result', handler);
  });
}

function addPlaylist() {
  const input = document.getElementById('newPlaylistUrl');
  const url = input.value.trim();

  if (!url) {
    showToast('Please enter a playlist URL');
    return;
  }

  if (!url.includes('soundcloud.com') || !url.includes('/sets/')) {
    showToast('Enter a valid SoundCloud playlist URL');
    return;
  }

  if (!settings.monitoredPlaylists) settings.monitoredPlaylists = [];
  if (settings.monitoredPlaylists.includes(url)) {
    showToast('Playlist already being monitored');
    return;
  }

  settings.monitoredPlaylists.push(url);
  addPlaylistItem(url);
  input.value = '';
  updateDashboardSources();
}

function removePlaylist(btn) {
  const item = btn.closest('.list-item');
  const url = item.dataset.url;

  if (settings.monitoredPlaylists) {
    const idx = settings.monitoredPlaylists.indexOf(url);
    if (idx > -1) settings.monitoredPlaylists.splice(idx, 1);
  }

  item.remove();
  updateDashboardSources();
}

// ── Folder Picker ──
function chooseFolder() {
  window.api.send('choose-folder');
}

window.api.on('folder-chosen', (folderPath) => {
  document.getElementById('downloadPath').value = folderPath;
});

// ── Save Settings ──
function saveSettings() {
  const newSettings = {
    downloadPath: document.getElementById('downloadPath').value,
    syncInterval: parseInt(document.getElementById('syncInterval').value),
    autoStart: document.getElementById('autoStart').checked,
    autoSync: document.getElementById('autoSync').checked,
    skipThumbnail: document.getElementById('skipThumbnail').checked,
    autoUpdate: document.getElementById('autoUpdate').checked,
    autoInstallOnQuit: document.getElementById('autoInstallOnQuit').checked,
    monitoredUsers: settings.monitoredUsers || [],
    monitoredPlaylists: settings.monitoredPlaylists || []
  };

  window.api.send('save-settings', newSettings);
}

window.api.on('settings-saved', () => {
  showToast('Settings saved');
});

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Actions ──
function triggerSync() {
  window.api.send('test-sync');
  showToast('Starting sync...');
}

// ── App update controls ──
function checkAppUpdate() {
  const btn = document.getElementById('appUpdateCheckBtn');
  const status = document.getElementById('appUpdateStatus');
  btn.disabled = true;
  status.textContent = 'Checking GitHub Releases...';
  window.api.send('check-app-update');
}

function installAppUpdate() {
  if (!confirm('Quit the app and install the update now?')) return;
  window.api.send('install-app-update');
}

window.api.on('app-update-info', (info) => {
  const btn = document.getElementById('appUpdateCheckBtn');
  const installBtn = document.getElementById('appUpdateInstallBtn');
  const status = document.getElementById('appUpdateStatus');
  btn.disabled = false;

  if (info.error) {
    status.textContent = `Check failed: ${info.error}`;
    installBtn.style.display = 'none';
    return;
  }

  if (info.updateAvailable) {
    status.textContent = `Update available: v${info.version} (current v${info.currentVersion})`;
    installBtn.style.display = '';
    // Trigger download so quitAndInstall has something to install.
    window.api.send('download-app-update');
  } else {
    status.textContent = `Up to date (v${info.currentVersion})`;
    installBtn.style.display = 'none';
  }
});

window.api.on('app-update-download-started', (result) => {
  const status = document.getElementById('appUpdateStatus');
  if (!result.success) {
    status.textContent = `Download failed: ${result.error}`;
  }
});

window.api.on('test-sync-complete', (result) => {
  showToast(result.success ? 'Sync completed' : 'Sync failed: ' + result.error);
});

function openDownloadFolder() {
  const downloadPath = document.getElementById('downloadPath').value;
  if (downloadPath) {
    window.api.openPath(downloadPath);
  }
}

// ── yt-dlp Version ──
function checkYtDlpVersion() {
  window.api.send('check-ytdlp-update');
}

window.api.on('ytdlp-update-info', (info) => {
  const versionEl = document.getElementById('ytdlpVersion');
  const statusEl = document.getElementById('ytdlpUpdateStatus');
  const updateBtn = document.getElementById('updateYtdlpBtn');

  if (info.error) {
    versionEl.textContent = 'Not installed';
    statusEl.textContent = '';
    updateBtn.style.display = 'none';
    return;
  }

  versionEl.textContent = info.currentVersion || 'Unknown';

  if (info.updateAvailable) {
    statusEl.textContent = 'Update available';
    statusEl.className = 'version-status outdated';
    updateBtn.style.display = 'inline-block';
    updateBtn.textContent = `Update to ${info.latestVersion}`;
    updateBtn.disabled = false;
  } else {
    statusEl.textContent = 'Up to date';
    statusEl.className = 'version-status current';
    updateBtn.style.display = 'none';
  }
});

function updateYtDlp() {
  const updateBtn = document.getElementById('updateYtdlpBtn');
  const statusEl = document.getElementById('ytdlpUpdateStatus');
  updateBtn.disabled = true;
  updateBtn.textContent = 'Updating...';
  statusEl.textContent = 'Downloading...';
  statusEl.className = 'version-status';
  window.api.send('update-ytdlp');
}

window.api.on('ytdlp-update-progress', (progress) => {
  document.getElementById('ytdlpUpdateStatus').textContent = progress;
});

window.api.on('ytdlp-update-result', (result) => {
  const statusEl = document.getElementById('ytdlpUpdateStatus');
  const updateBtn = document.getElementById('updateYtdlpBtn');
  const versionEl = document.getElementById('ytdlpVersion');

  if (result.success) {
    if (result.newVersion) {
      versionEl.textContent = result.newVersion;
      showToast(`yt-dlp updated to ${result.newVersion}`);
    }
    statusEl.textContent = 'Up to date';
    statusEl.className = 'version-status current';
    updateBtn.style.display = 'none';
  } else {
    statusEl.textContent = 'Update failed';
    statusEl.className = 'version-status outdated';
    updateBtn.textContent = 'Retry';
    updateBtn.disabled = false;
  }
});

setTimeout(checkYtDlpVersion, 500);

// ── Diagnostics ──
let diagnosticsRunning = false;

function setTestStatus(test, status, message) {
  const item = document.querySelector(`[data-test="${test}"]`);
  const icon = document.getElementById(`test-${test}-icon`);
  const desc = document.getElementById(`test-${test}-status`);

  item.className = 'diagnostic-item ' + status;

  if (status === 'running') icon.innerHTML = '&#9673;';
  else if (status === 'pass') icon.innerHTML = '&#10003;';
  else if (status === 'fail') icon.innerHTML = '&#10007;';
  else icon.innerHTML = '&#9675;';

  desc.textContent = message;
}

function resetAllTests() {
  const tests = ['ytdlp', 'ffmpeg', 'permissions', 'soundcloud'];
  tests.forEach(test => {
    setTestStatus(test, '', getDefaultMessage(test));
  });
  document.getElementById('diagnosticSummary').textContent = '';
  document.getElementById('diagnosticSummary').className = 'diagnostic-summary';
}

function getDefaultMessage(test) {
  const messages = {
    ytdlp: 'Check if download engine is installed and working',
    ffmpeg: 'Check if audio conversion is available',
    permissions: 'Verify download folder is writable',
    soundcloud: 'Test fetching data from SoundCloud'
  };
  return messages[test] || '';
}

async function runDiagnostics() {
  if (diagnosticsRunning) return;

  diagnosticsRunning = true;
  const btn = document.getElementById('runDiagnosticsBtn');
  btn.disabled = true;
  btn.textContent = 'Running...';

  resetAllTests();
  window.api.send('run-diagnostics');
}

window.api.on('diagnostic-update', (data) => {
  setTestStatus(data.test, data.status, data.message);
});

window.api.on('diagnostic-complete', (results) => {
  diagnosticsRunning = false;
  const btn = document.getElementById('runDiagnosticsBtn');
  btn.disabled = false;
  btn.textContent = 'Run Diagnostics';

  const summary = document.getElementById('diagnosticSummary');
  if (results.failed === 0) {
    summary.textContent = `All ${results.passed} tests passed`;
    summary.className = 'diagnostic-summary success';
  } else {
    summary.textContent = `${results.passed} passed, ${results.failed} failed`;
    summary.className = 'diagnostic-summary error';
  }
});

// ── Enter key support for add fields ──
document.getElementById('newUsername').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addUser();
});
document.getElementById('newPlaylistUrl').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addPlaylist();
});
