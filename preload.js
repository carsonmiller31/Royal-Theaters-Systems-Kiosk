const { contextBridge, ipcRenderer } = require('electron');

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

console.log('✅ Simple Electron API ready');
