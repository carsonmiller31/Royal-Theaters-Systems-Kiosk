const { app, BrowserWindow, ipcMain, globalShortcut, session } = require('electron');
let autoUpdater; // lazily required after app context is ready
const SettingsManager = require('./settings');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let mainWindow;
let adminWindow;
let updateWindow;
let driverWindow;
let timeclockWindow;
let settings;
let pendingUpdateInfo;
let isQuitting = false;
let updateReadyToInstall = false;

function createWindow() {
  settings = new SettingsManager();
  
  // Version info for testing
  console.log('🚀 Royal Theaters Systems v' + app.getVersion() + ' - Auto-update test version!');
  
  // Set app to launch at startup
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: false
  });
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js')
    }
  });

  const APP_URL = process.env.APP_URL || settings.get('appUrl');
  mainWindow.loadURL(APP_URL);
  
  // Windows-only: show driver setup on first run
  if (process.platform === 'win32') {
    maybeShowDriverSetup();
  }
  
  // Handle window close event
  mainWindow.on('close', (event) => {
    if (!isQuitting && updateReadyToInstall) {
      event.preventDefault();
      gracefulShutdown();
    }
  });
  
  registerAdminShortcut();
  setupAutoUpdater();
}

function getDriverInstallerPath() {
  // In packaged app, extraResources are placed under process.resourcesPath
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'drivers', 'AURES Elite Printer Driver 4.64.exe');
  }
  // In dev, use project root file
  return path.join(__dirname, 'AURES Elite Printer Driver 4.64.exe');
}

function maybeShowDriverSetup() {
  try {
    // Only relevant on Windows and only show once
    if (process.platform !== 'win32') return;
    const hasSeen = !!settings.get('hasSeenDriverPrompt');
    if (hasSeen) return;
    showDriverSetupWindow();
  } catch (e) {
    console.log('Driver prompt check failed:', e);
  }
}

function showDriverSetupWindow() {
  if (driverWindow) {
    driverWindow.focus();
    return;
  }

  driverWindow = new BrowserWindow({
    width: 560,
    height: 420,
    modal: true,
    parent: mainWindow,
    autoHideMenuBar: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js')
    }
  });

  // Mark as seen so this prompt only shows once on first run
  try { settings.set('hasSeenDriverPrompt', true); } catch (e) {}

  driverWindow.loadFile('driver-setup.html');

  driverWindow.on('closed', () => {
    driverWindow = null;
  });
}
 
function setupAutoUpdater() {
  // Lazy-load electron-updater only when running in Electron main context
  if (!autoUpdater) {
    try {
      const { autoUpdater: au } = require('electron-updater');
      autoUpdater = au;
    } catch (e) {
      console.log('Failed to load electron-updater:', e);
      return; // Skip updater in environments where it cannot load
    }
  }
  // Force updates in development for testing
  if (!app.isPackaged) {
    Object.defineProperty(app, 'isPackaged', {
      get() {
        return true;
      }
    });
  }
  
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = process.env.ALLOW_PRERELEASE === 'true';
  autoUpdater.allowDowngrade = false;
  
  // No GH_TOKEN required for public GitHub updates; we always use public GitHub releases via gh CLI
  console.log('ℹ️ Using public GitHub releases (no GH_TOKEN).');

  // Set the update server URL
  const UPDATE_PROVIDER = (process.env.UPDATE_PROVIDER || '').toLowerCase();
  const UPDATE_URL = process.env.UPDATE_URL;
  if (UPDATE_PROVIDER === 'generic' && UPDATE_URL) {
    console.log('🔗 Using GENERIC update provider:', UPDATE_URL);
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_URL });
  } else {
    console.log('🔗 Using GITHUB update provider (public): carsonmiller31/Royal-Theaters-Systems-Kiosk');
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'carsonmiller31',
      repo: 'Royal-Theaters-Systems-Kiosk'
    });
  }
  
  // Check for updates on startup (after 3 seconds)
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify()
      .catch((err) => {
        console.log('checkForUpdatesAndNotify error:', err);
      });
  }, 3000);
  
  // Auto-updater events
  autoUpdater.on('checking-for-update', () => {
    console.log('🔍 Checking for update...');
    console.log('Repository: carsonmiller31/Royal-Theaters-Systems-Kiosk');
    console.log('Current version:', app.getVersion());
    if (adminWindow) {
      adminWindow.webContents.send('update-status', { type: 'checking' });
    }
  });
  
  autoUpdater.on('update-available', (info) => {
    console.log('✅ Update available:', info.version);
    console.log('Update info:', JSON.stringify(info, null, 2));
    pendingUpdateInfo = info;
    showUpdateWindow();
    if (adminWindow) {
      adminWindow.webContents.send('update-status', { type: 'available', version: info.version });
    }
  });
  
  autoUpdater.on('update-not-available', (info) => {
    console.log('❌ Update not available');
    console.log('Current version:', app.getVersion());
    console.log('Latest version checked:', info ? info.version : 'unknown');
    console.log('Repository response:', JSON.stringify(info, null, 2));
    if (adminWindow) {
      adminWindow.webContents.send('update-status', { 
        type: 'no-update', 
        current: app.getVersion(), 
        latest: info ? info.version : undefined 
      });
    }
  });
  
  autoUpdater.on('error', (err) => {
    console.log('💥 Auto-updater error:', err);
    console.log('Error details:', JSON.stringify(err, null, 2));
    if (adminWindow) {
      adminWindow.webContents.send('update-status', { 
        type: 'error', 
        message: (err && err.message) ? err.message : String(err),
        statusCode: err && err.statusCode,
        code: err && err.code
      });
    }
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    console.log(`Download progress: ${progressObj.percent}%`);
    if (updateWindow) {
      updateWindow.webContents.send('download-progress', progressObj);
    }
  });
  
  autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded');
    updateReadyToInstall = true;
    if (updateWindow) {
      updateWindow.webContents.send('update-downloaded');
    }
  });
}

function gracefulShutdown() {
  console.log('Starting graceful shutdown...');
  isQuitting = true;
  
  // Close all child windows first
  if (adminWindow) {
    adminWindow.close();
  }
  if (updateWindow) {
    updateWindow.close();
  }
  
  // Save any pending data (if needed)
  if (settings) {
    settings.save();
  }
  
  // Force quit handler as backup
  const forceQuitTimer = setTimeout(() => {
    console.log('Force quitting application for update...');
    app.exit(0);
  }, 5000);
  
  // Wait a moment for cleanup, then quit and install
  setTimeout(() => {
    clearTimeout(forceQuitTimer);
    console.log('Performing graceful shutdown and installing update...');
    if (autoUpdater && typeof autoUpdater.quitAndInstall === 'function') {
      autoUpdater.quitAndInstall(false, true);
    } else {
      app.quit();
    }
  }, 500);
}

function forceKillProcess() {
  console.log('Force killing any remaining application processes...');
  const { exec } = require('child_process');
  const appName = 'Royal Theaters Systems';
  
  // Windows
  if (process.platform === 'win32') {
    exec(`taskkill /f /im "${appName}.exe"`, (error) => {
      if (error) console.log('Process kill command completed');
    });
  }
  // macOS
  else if (process.platform === 'darwin') {
    exec(`pkill -f "${appName}"`, (error) => {
      if (error) console.log('Process kill command completed');
    });
  }
  // Linux
  else {
    exec(`pkill -f "${appName}"`, (error) => {
      if (error) console.log('Process kill command completed');
    });
  }
}

function registerAdminShortcut() {
  globalShortcut.register('CommandOrControl+Shift+Alt+A', () => {
    if (adminWindow) {
      adminWindow.focus();
      return;
    }
    
    adminWindow = new BrowserWindow({
      width: 780,
      height: 700,
      minWidth: 680,
      minHeight: 620,
      modal: true,
      parent: mainWindow,
      autoHideMenuBar: true,
      resizable: true,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: require('path').join(__dirname, 'preload.js')
      }
    });

    adminWindow.loadFile('admin-panel.html');
    
    adminWindow.on('closed', () => {
      adminWindow = null;
    });
  });
}

function showUpdateWindow() {
  if (updateWindow) {
    updateWindow.focus();
    return;
  }
  
  updateWindow = new BrowserWindow({
    width: 500,
    height: 400,
    modal: true,
    parent: mainWindow,
    autoHideMenuBar: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js')
    }
  });

  updateWindow.loadFile('update-notification.html');
  
  updateWindow.on('closed', () => {
    updateWindow = null;
  });
}

app.whenReady().then(createWindow);

// SIMPLE PRINT HANDLER
ipcMain.handle('print', async (event, htmlContent) => {
  console.log('PRINT REQUEST received');
  
  try {
    // Create simple print window
    const printWin = new BrowserWindow({ 
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    // Create proper HTML with styling for printing
    const printHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            margin: 0;
            padding: 0;
            width: 100%;
          }
          @media print {
            body { margin: 0; padding: 0; }
            @page { margin: 0; }
          }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
      </html>
    `;
    
    // Load the HTML content
    await printWin.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(printHTML)}`);
    
    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Print to default printer, silent, with receipt-sized margins
    return new Promise((resolve, reject) => {
      printWin.webContents.print({
        silent: true,
        margins: { marginType: 'none' },
        pageSize: { width: 80000, height: 297000 },  // 80mm x 297mm in microns
      }, (success, errorType) => {
        printWin.close();
        if (success) {
          console.log('✅ PRINT SUCCESS');
          resolve(true);
        } else {
          console.log('❌ PRINT FAILED:', errorType);
          reject(new Error(errorType || 'Print failed'));
        }
      });
    });
  } catch (error) {
    console.log('❌ PRINT ERROR:', error);
    throw error;
  }
});

// ADMIN HANDLERS
ipcMain.handle('validate-password', async (_, password) => {
  if (settings.validatePassword(password)) {
    return {
      valid: true,
      settings: {
        appUrl: settings.get('appUrl')
      }
    };
  }
  return { valid: false };
});

// TIMECLOCK WINDOW
function openTimeclockWindow() {
  if (timeclockWindow && !timeclockWindow.isDestroyed()) {
    timeclockWindow.focus();
    return;
  }

  // Use a separate persistent partition so cookies/session persist across app restarts
  const partitionName = 'persist:timeclock';
  session.fromPartition(partitionName);

  timeclockWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    parent: mainWindow,
    modal: false,
    autoHideMenuBar: true,
    resizable: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js'),
      partition: partitionName
    }
  });

  timeclockWindow.loadURL('https://timeclock.scheduley.net/timeclock');

  timeclockWindow.on('closed', () => {
    timeclockWindow = null;
  });
}

ipcMain.handle('open-timeclock', async () => {
  openTimeclockWindow();
  return true;
});

ipcMain.handle('close-timeclock', async () => {
  if (timeclockWindow && !timeclockWindow.isDestroyed()) {
    timeclockWindow.close();
    timeclockWindow = null;
    return true;
  }
  return false;
});

ipcMain.handle('save-settings', async (_, newSettings) => {
  return settings.updateSettings(newSettings);
});

ipcMain.handle('close-admin', async () => {
  if (adminWindow) {
    adminWindow.close();
  }
});

// AUTO-UPDATER HANDLERS
ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return true;
  } catch (error) {
    console.log('Download update error:', error);
    return false;
  }
});

ipcMain.handle('install-update', async () => {
  if (updateReadyToInstall) {
    gracefulShutdown();
  } else {
    console.log('Update not ready to install');
    return false;
  }
});

ipcMain.handle('check-for-updates', async () => {
  try {
    console.log('🔍 Manual update check requested...');
    console.log('Current app version:', app.getVersion());
    console.log('Repository: carsonmiller31/Royal-Theaters-Systems-Kiosk');
    if (adminWindow) {
      adminWindow.webContents.send('update-status', { type: 'checking' });
    }
    const result = await autoUpdater.checkForUpdates();
    console.log('Update check result:', result);
    return { ok: true };
  } catch (error) {
    console.log('💥 Check for updates error:', error);
    console.log('Error details:', JSON.stringify(error, null, 2));
    return { 
      ok: false, 
      error: {
        message: (error && error.message) ? error.message : String(error),
        statusCode: error && error.statusCode,
        code: error && error.code
      }
    };
  }
});

ipcMain.handle('get-update-info', async () => {
  return pendingUpdateInfo;
});

ipcMain.handle('close-update', async () => {
  if (updateWindow) {
    updateWindow.close();
  }
});

// DRIVER SETUP IPC
ipcMain.handle('get-driver-status', async () => {
  return {
    platform: process.platform,
    hasSeenDriverPrompt: !!settings.get('hasSeenDriverPrompt'),
    driverInstalled: !!settings.get('driverInstalled'),
    installerPathExists: fs.existsSync(getDriverInstallerPath())
  };
});

ipcMain.handle('mark-driver-installed', async () => {
  settings.set('driverInstalled', true);
  settings.set('hasSeenDriverPrompt', true);
  return {
    hasSeenDriverPrompt: !!settings.get('hasSeenDriverPrompt'),
    driverInstalled: !!settings.get('driverInstalled')
  };
});

ipcMain.handle('mark-driver-prompt-seen', async () => {
  settings.set('hasSeenDriverPrompt', true);
  return {
    hasSeenDriverPrompt: !!settings.get('hasSeenDriverPrompt'),
    driverInstalled: !!settings.get('driverInstalled')
  };
});

ipcMain.handle('install-printer-driver', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Printer driver installer is only available on Windows.' };
  }
  const installerPath = getDriverInstallerPath();
  if (!fs.existsSync(installerPath)) {
    return { ok: false, error: 'Installer not found.' };
  }
  try {
    // Launch the installer (interactive). Detached so it continues if app closes
    const child = execFile(installerPath, [], { detached: true }, (error) => {
      if (error) {
        console.log('Driver installer exited with error:', error);
      } else {
        console.log('Driver installer launched successfully');
      }
    });
    if (child && child.pid) {
      child.unref?.();
    }
    return { ok: true };
  } catch (error) {
    console.log('Failed to launch driver installer:', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

ipcMain.handle('close-driver-setup', async () => {
  if (driverWindow) {
    driverWindow.close();
  }
});

ipcMain.handle('open-driver-setup', async () => {
  showDriverSetupWindow();
  return true;
});

ipcMain.handle('force-kill-app', async () => {
  console.log('Force kill requested via IPC');
  forceKillProcess();
  setTimeout(() => app.exit(0), 1000);
});

// App control handlers
ipcMain.handle('app-exit', async () => {
  console.log('App exit requested via IPC');
  if (updateReadyToInstall) {
    // If an update is ready, follow the graceful shutdown path to install it
    gracefulShutdown();
  } else {
    isQuitting = true;
    // Attempt graceful quit
    app.quit();
    // Fallback exit in case quit hangs
    setTimeout(() => app.exit(0), 2000);
  }
});

ipcMain.handle('app-restart', async () => {
  console.log('App restart requested via IPC');
  isQuitting = true;
  app.relaunch();
  app.exit(0);
  return true;
});

ipcMain.handle('hard-refresh', async () => {
  console.log('Hard refresh requested via IPC');
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      await mainWindow.webContents.session.clearCache();
    } catch (e) {
      // ignore cache clear errors
    }
    mainWindow.webContents.reloadIgnoringCache();
    return true;
  }
  return false;
});

ipcMain.handle('deep-refresh', async () => {
  console.log('Deep refresh requested via IPC');
  if (mainWindow && !mainWindow.isDestroyed()) {
    const ses = mainWindow.webContents.session;
    try {
      // 1) Clear HTTP cache
      await ses.clearCache();
    } catch {}
    try {
      // 2) Clear storage data including cookies and service worker caches
      await ses.clearStorageData({
        storages: [
          'appcache',
          'serviceworkers',
          'cachestorage',
          'localstorage',
          'indexeddb',
          'filesystem',
          'websql',
          'cookies'
        ]
      });
    } catch (e) {
      console.log('clearStorageData error:', e);
    }
    try {
      // 3) Best-effort unregister service workers in the page
      await mainWindow.webContents.executeJavaScript(
        "(async () => { try { const regs = await navigator.serviceWorker?.getRegistrations?.(); if (regs) { await Promise.all(regs.map(r => r.unregister())); } return true; } catch { return false; } })()",
        true
      );
    } catch {}
    // 4) Reload ignoring cache
    mainWindow.webContents.reloadIgnoringCache();
    return true;
  }
  return false;
});

// Open admin panel from web POS
ipcMain.handle('open-admin-panel', async () => {
  if (adminWindow) {
    adminWindow.focus();
    return;
  }
  
  adminWindow = new BrowserWindow({
    width: 780,
    height: 700,
    minWidth: 680,
    minHeight: 620,
    modal: true,
    parent: mainWindow,
    autoHideMenuBar: true,
    resizable: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js')
    }
  });

  adminWindow.loadFile('admin-panel.html');
  
  adminWindow.on('closed', () => {
    adminWindow = null;
  });
});

app.on('window-all-closed', () => {
  if (!isQuitting) {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (updateReadyToInstall && !isQuitting) {
    event.preventDefault();
    gracefulShutdown();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Handle app activation (macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
