#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_PATH = path.join(process.env.APPDATA || '', 'soundcloud-auto-sync', 'config.json');
const RESOURCES_PATH = path.join(__dirname, 'resources');

// Colors for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function log(msg, color = 'white') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logStatus(label, status, message) {
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '○';
  const color = status === 'pass' ? 'green' : status === 'fail' ? 'red' : 'yellow';
  console.log(`${colors[color]}  ${icon} ${label}${colors.reset}: ${message}`);
}

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return {
    downloadPath: path.join(require('os').homedir(), 'Music'),
    syncInterval: 15,
    autoSync: false,
    autoStart: false,
    monitoredUsers: [],
    monitoredPlaylists: []
  };
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  log('Settings saved!', 'green');
}

function getYtDlpPath() {
  const bundled = path.join(RESOURCES_PATH, 'yt-dlp.exe');
  if (fs.existsSync(bundled)) return bundled;
  return 'yt-dlp';
}

function getFfmpegPath() {
  const bundled = path.join(RESOURCES_PATH, 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;
  return 'ffmpeg';
}

async function runDiagnostics() {
  log('\n╔════════════════════════════════════════╗', 'cyan');
  log('║       SYSTEM DIAGNOSTICS               ║', 'cyan');
  log('╚════════════════════════════════════════╝\n', 'cyan');

  let passed = 0, failed = 0;

  // Test 1: yt-dlp
  process.stdout.write('  Testing yt-dlp... ');
  try {
    const ytdlp = getYtDlpPath();
    const version = execSync(`"${ytdlp}" --version`, { encoding: 'utf8', timeout: 10000 }).trim();
    logStatus('yt-dlp', 'pass', `v${version}`);
    passed++;
  } catch (e) {
    logStatus('yt-dlp', 'fail', 'Not found');
    failed++;
  }

  // Test 2: ffmpeg
  process.stdout.write('  Testing ffmpeg... ');
  try {
    const ffmpeg = getFfmpegPath();
    execSync(`"${ffmpeg}" -version`, { encoding: 'utf8', timeout: 10000 });
    logStatus('ffmpeg', 'pass', 'Available');
    passed++;
  } catch (e) {
    logStatus('ffmpeg', 'fail', 'Not found');
    failed++;
  }

  // Test 3: Write permissions
  process.stdout.write('  Testing write permissions... ');
  const config = getConfig();
  try {
    const testFile = path.join(config.downloadPath, `.test-${Date.now()}`);
    if (!fs.existsSync(config.downloadPath)) {
      fs.mkdirSync(config.downloadPath, { recursive: true });
    }
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    logStatus('Permissions', 'pass', config.downloadPath);
    passed++;
  } catch (e) {
    logStatus('Permissions', 'fail', 'Cannot write to download folder');
    failed++;
  }

  // Test 4: SoundCloud connection
  process.stdout.write('  Testing SoundCloud connection... ');
  try {
    const ytdlp = getYtDlpPath();
    execSync(`"${ytdlp}" --flat-playlist --playlist-items 1 -j "https://soundcloud.com/charts/top"`, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    logStatus('SoundCloud', 'pass', 'Connected');
    passed++;
  } catch (e) {
    logStatus('SoundCloud', 'fail', 'Cannot connect');
    failed++;
  }

  // Summary
  log('\n────────────────────────────────────────', 'dim');
  if (failed === 0) {
    log(`  All ${passed} tests passed!`, 'green');
  } else {
    log(`  ${passed} passed, ${failed} failed`, 'yellow');
  }
  log('', 'reset');

  return { passed, failed };
}

async function showSettings() {
  const config = getConfig();

  log('\n╔════════════════════════════════════════╗', 'cyan');
  log('║       CURRENT SETTINGS                 ║', 'cyan');
  log('╚════════════════════════════════════════╝\n', 'cyan');

  log(`  Download Path:   ${config.downloadPath}`, 'white');
  log(`  Sync Interval:   ${config.syncInterval} minutes`, 'white');
  log(`  Auto Sync:       ${config.autoSync ? 'Yes' : 'No'}`, 'white');
  log(`  Auto Start:      ${config.autoStart ? 'Yes' : 'No'}`, 'white');
  log(`  Monitored Users: ${config.monitoredUsers.length > 0 ? config.monitoredUsers.join(', ') : 'None'}`, 'white');
  log(`  Playlists:       ${config.monitoredPlaylists.length > 0 ? config.monitoredPlaylists.length + ' configured' : 'None'}`, 'white');

  if (config.monitoredPlaylists.length > 0) {
    config.monitoredPlaylists.forEach((url, i) => {
      log(`                   ${i + 1}. ${url}`, 'dim');
    });
  }
  log('', 'reset');
}

async function configureSettings() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (q) => new Promise(resolve => rl.question(q, resolve));
  const config = getConfig();

  log('\n╔════════════════════════════════════════╗', 'cyan');
  log('║       CONFIGURE SETTINGS               ║', 'cyan');
  log('╚════════════════════════════════════════╝\n', 'cyan');
  log('  Press Enter to keep current value\n', 'dim');

  // Download path
  const newPath = await question(`  Download Path [${config.downloadPath}]: `);
  if (newPath.trim()) config.downloadPath = newPath.trim();

  // Sync interval
  const newInterval = await question(`  Sync Interval in minutes [${config.syncInterval}]: `);
  if (newInterval.trim()) config.syncInterval = parseInt(newInterval) || 15;

  // Auto sync
  const newAutoSync = await question(`  Enable Auto Sync? (y/n) [${config.autoSync ? 'y' : 'n'}]: `);
  if (newAutoSync.trim().toLowerCase() === 'y') config.autoSync = true;
  else if (newAutoSync.trim().toLowerCase() === 'n') config.autoSync = false;

  // Add monitored user
  const addUser = await question(`\n  Add monitored user? (y/n) [n]: `);
  if (addUser.trim().toLowerCase() === 'y') {
    const username = await question(`  Enter SoundCloud username: `);
    if (username.trim() && !config.monitoredUsers.includes(username.trim())) {
      config.monitoredUsers.push(username.trim());
      log('  User added!', 'green');
    }
  }

  // Add custom playlist
  const addCustom = await question(`\n  Add playlist URL? (y/n) [n]: `);
  if (addCustom.trim().toLowerCase() === 'y') {
    const customUrl = await question(`  Enter playlist URL: `);
    if (customUrl.trim() && customUrl.includes('soundcloud.com') && customUrl.includes('/sets/')) {
      if (!config.monitoredPlaylists.includes(customUrl.trim())) {
        config.monitoredPlaylists.push(customUrl.trim());
        log('  Playlist added!', 'green');
      }
    } else {
      log('  Invalid URL, skipping', 'yellow');
    }
  }

  rl.close();
  saveConfig(config);
  await showSettings();
}

async function syncNow() {
  const config = getConfig();

  log('\n╔════════════════════════════════════════╗', 'cyan');
  log('║       STARTING SYNC                    ║', 'cyan');
  log('╚════════════════════════════════════════╝\n', 'cyan');

  if (config.monitoredUsers.length === 0 && config.monitoredPlaylists.length === 0) {
    log('  No users or playlists configured!', 'yellow');
    log('  Run: node cli.js config', 'dim');
    return;
  }

  const ytdlp = getYtDlpPath();
  const ffmpegDir = path.dirname(getFfmpegPath());

  // Sync playlists
  for (const playlistUrl of config.monitoredPlaylists) {
    log(`\n  Syncing playlist: ${playlistUrl}`, 'cyan');

    try {
      const args = [
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--embed-thumbnail',
        '--add-metadata',
        '--no-overwrites',
        '--ffmpeg-location', ffmpegDir,
        '-o', path.join(config.downloadPath, '%(title)s.%(ext)s'),
        playlistUrl
      ];

      const proc = spawn(ytdlp, args, { stdio: 'inherit' });

      await new Promise((resolve, reject) => {
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Exit code ${code}`));
        });
        proc.on('error', reject);
      });

      log('  Playlist sync complete!', 'green');
    } catch (e) {
      log(`  Error syncing playlist: ${e.message}`, 'red');
    }
  }

  // Sync user likes
  for (const username of config.monitoredUsers) {
    log(`\n  Syncing likes from: ${username}`, 'cyan');

    try {
      const likesUrl = `https://soundcloud.com/${username}/likes`;
      const args = [
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--embed-thumbnail',
        '--add-metadata',
        '--no-overwrites',
        '--ffmpeg-location', ffmpegDir,
        '-o', path.join(config.downloadPath, '%(title)s.%(ext)s'),
        likesUrl
      ];

      const proc = spawn(ytdlp, args, { stdio: 'inherit' });

      await new Promise((resolve, reject) => {
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Exit code ${code}`));
        });
        proc.on('error', reject);
      });

      log('  User likes sync complete!', 'green');
    } catch (e) {
      log(`  Error syncing likes: ${e.message}`, 'red');
    }
  }

  log('\n  All syncs complete!', 'green');
}

async function showHelp() {
  log('\n╔════════════════════════════════════════╗', 'cyan');
  log('║   SC AUTO SYNC/DOWNLOADER CLI          ║', 'cyan');
  log('╚════════════════════════════════════════╝\n', 'cyan');

  log('  Usage: node cli.js <command>\n', 'white');
  log('  Commands:', 'yellow');
  log('    test      Run full system diagnostics', 'white');
  log('    config    Configure settings interactively', 'white');
  log('    settings  Show current settings', 'white');
  log('    sync      Run sync now', 'white');
  log('    install   Install dependencies and setup', 'white');
  log('    gui       Launch the GUI app', 'white');
  log('    help      Show this help message', 'white');
  log('', 'reset');
}

async function install() {
  log('\n╔════════════════════════════════════════╗', 'cyan');
  log('║       INSTALLING                       ║', 'cyan');
  log('╚════════════════════════════════════════╝\n', 'cyan');

  // Check npm dependencies
  log('  Installing npm dependencies...', 'yellow');
  try {
    execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
    log('  Dependencies installed!', 'green');
  } catch (e) {
    log('  Failed to install dependencies', 'red');
  }

  // Check resources
  log('\n  Checking bundled tools...', 'yellow');

  const ytdlp = path.join(RESOURCES_PATH, 'yt-dlp.exe');
  const ffmpeg = path.join(RESOURCES_PATH, 'ffmpeg.exe');

  if (fs.existsSync(ytdlp)) {
    log('  yt-dlp.exe found', 'green');
  } else {
    log('  yt-dlp.exe not found - downloading...', 'yellow');
    try {
      execSync('curl -L -o "' + ytdlp + '" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', { stdio: 'inherit' });
      log('  yt-dlp.exe downloaded!', 'green');
    } catch (e) {
      log('  Failed to download yt-dlp', 'red');
    }
  }

  if (fs.existsSync(ffmpeg)) {
    log('  ffmpeg.exe found', 'green');
  } else {
    log('  ffmpeg.exe not found - please download manually from ffmpeg.org', 'yellow');
  }

  // Create default config
  log('\n  Creating default configuration...', 'yellow');
  const config = getConfig();
  saveConfig(config);

  log('\n  Installation complete!', 'green');
  log('  Run: node cli.js test    to verify setup', 'dim');
  log('  Run: node cli.js config  to configure', 'dim');
}

async function launchGUI() {
  log('  Launching GUI...', 'cyan');
  try {
    const electron = require('electron');
    const proc = spawn(electron, ['.'], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore'
    });
    proc.unref();
    log('  GUI launched!', 'green');
  } catch (e) {
    log('  Trying npm start...', 'yellow');
    execSync('npm start', { cwd: __dirname, stdio: 'inherit' });
  }
}

// Main
const command = process.argv[2] || 'help';

(async () => {
  switch (command) {
    case 'test':
    case 'diagnostics':
      await runDiagnostics();
      break;
    case 'config':
    case 'configure':
      await configureSettings();
      break;
    case 'settings':
    case 'show':
      await showSettings();
      break;
    case 'sync':
      await syncNow();
      break;
    case 'install':
    case 'setup':
      await install();
      break;
    case 'gui':
    case 'app':
      await launchGUI();
      break;
    case 'help':
    default:
      await showHelp();
  }
})();
