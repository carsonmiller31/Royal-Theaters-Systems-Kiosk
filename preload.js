const { contextBridge, ipcRenderer } = require('electron');

const ADMIN_SWIPE = {
  edgeThresholdPx: 80,
  minHorizontalDistancePx: 140,
  maxVerticalDriftPx: 80,
  cooldownMs: 1200
};

let swipeState = null;
let lastAdminSwipeAt = 0;

function resetSwipeState() {
  swipeState = null;
}

function canTriggerAdminSwipe() {
  return Date.now() - lastAdminSwipeAt >= ADMIN_SWIPE.cooldownMs;
}

function setupAdminSwipeGesture() {
  window.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || !canTriggerAdminSwipe()) {
      resetSwipeState();
      return;
    }

    const touch = event.touches[0];
    const startX = touch.clientX;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;

    if (viewportWidth - startX > ADMIN_SWIPE.edgeThresholdPx) {
      resetSwipeState();
      return;
    }

    swipeState = {
      startX,
      startY: touch.clientY,
      triggered: false
    };
  }, { passive: true, capture: true });

  window.addEventListener('touchmove', (event) => {
    if (!swipeState || swipeState.triggered || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = swipeState.startX - touch.clientX;
    const deltaY = Math.abs(touch.clientY - swipeState.startY);

    if (touch.clientX > swipeState.startX || deltaY > ADMIN_SWIPE.maxVerticalDriftPx) {
      resetSwipeState();
      return;
    }

    if (deltaX >= ADMIN_SWIPE.minHorizontalDistancePx) {
      swipeState.triggered = true;
      lastAdminSwipeAt = Date.now();
      ipcRenderer.invoke('open-admin-panel').catch((error) => {
        console.log('Admin swipe gesture failed:', error);
      });
    }
  }, { passive: true, capture: true });

  window.addEventListener('touchend', resetSwipeState, { passive: true, capture: true });
  window.addEventListener('touchcancel', resetSwipeState, { passive: true, capture: true });
}

// Simple API for printing and admin functions
contextBridge.exposeInMainWorld('electronAPI', {
  print: (text) => ipcRenderer.invoke('print', text),
  openAdminPanel: () => ipcRenderer.invoke('open-admin-panel'),
  validatePassword: (password) => ipcRenderer.invoke('validate-password', password),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  closeAdmin: () => ipcRenderer.invoke('close-admin'),
  // Update functions
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateInfo: () => ipcRenderer.invoke('get-update-info'),
  closeUpdate: () => ipcRenderer.invoke('close-update'),
  // App controls
  exitApp: () => ipcRenderer.invoke('app-exit'),
  hardRefresh: () => ipcRenderer.invoke('hard-refresh'),
  deepRefresh: () => ipcRenderer.invoke('deep-refresh'),
  // Timeclock popup
  openTimeclock: () => ipcRenderer.invoke('open-timeclock'),
  closeTimeclock: () => ipcRenderer.invoke('close-timeclock'),
  // Driver setup
  installPrinterDriver: () => ipcRenderer.invoke('install-printer-driver'),
  markDriverInstalled: () => ipcRenderer.invoke('mark-driver-installed'),
  markDriverPromptSeen: () => ipcRenderer.invoke('mark-driver-prompt-seen'),
  getDriverStatus: () => ipcRenderer.invoke('get-driver-status'),
  closeDriverSetup: () => ipcRenderer.invoke('close-driver-setup'),
  openDriverSetup: () => ipcRenderer.invoke('open-driver-setup'),
  // Update event listeners
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
  // Admin update status messages
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_, payload) => callback(payload))
});

setupAdminSwipeGesture();

console.log('✅ Simple Electron API ready');
