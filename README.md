# Royal Theaters Systems

Electron wrapper for Royal Theaters Systems that provides kiosk-mode access, silent printing, and desktop integration for internal operations.

## Features

- **Silent Printing**: Print kitchen tickets without user dialogs
- **Kiosk Mode**: Full-screen application for dedicated terminals
- **Printer Management**: Select and configure receipt printers
- **Auto-Recovery**: Automatic reload on crashes

## Development

```bash
# Install dependencies
npm install

# Start in development mode with debugging
npm run dev

# Start normally
npm start
```

## Building

```bash
# Build for current platform
npm run build

# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for Linux
npm run build:linux

# Build for all platforms
npm run build:all
```

## Configuration

Set the POS app URL via environment variable:

```bash
# For local development
APP_URL=http://localhost:3000 npm start

# For network deployment
APP_URL=http://192.168.1.186:3000 npm start
```

## Printer Setup

1. Install your receipt printer drivers
2. Set the printer as default, or
3. Use the printer selection in the POS app settings

The app will automatically detect and prefer AURES ODP333 printers if available.

## Deployment

The built application includes:
- Windows: NSIS installer and portable executable
- macOS: DMG installer and ZIP archive
- Linux: AppImage and DEB package

For kiosk deployment, the app runs in fullscreen mode with the menu bar hidden.

## Timeclock Popup Window

To open the Scheduley Timeclock site in a popup window that remembers login cookies between runs, call the exposed preload API from your web app loaded in the kiosk:

```js
// In your web app (renderer)
document.getElementById('openTimeclockBtn').addEventListener('click', () => {
  window.electronAPI?.openTimeclock();
});
```

Notes:
- The popup uses a persistent session partition (`persist:timeclock`) so cookies and storage persist across app restarts.
- The window is always on top and can be closed with the standard close button. You can also programmatically close it via `window.electronAPI?.closeTimeclock()`.
