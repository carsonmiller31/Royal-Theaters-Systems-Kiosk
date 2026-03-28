const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class SettingsManager {
  constructor() {
    // Store settings in user-writable location
    const userDataDir = app.getPath('userData');
    this.configPath = path.join(userDataDir, 'config.json');
    this.legacyConfigPath = path.join(__dirname, 'config.json');

    this.defaults = {
      appUrl: 'https://systems.royaltheaters.com/showtimes/kiosk',
      adminPassword: '1016',
      hasSeenDriverPrompt: false,
      driverInstalled: false
    };
    this.settings = this.loadSettings();
  }

  isLegacyDefaultUrl(appUrl) {
    const legacyUrls = new Set([
      'https://food-pos.royaltheaters-systems.com',
      'https://food-pos-system-neon.vercel.app',
      'https://systems.royaltheaters.com',
      'https://systems.royaltheaters.com/showtimes/display'
    ]);

    return legacyUrls.has((appUrl || '').trim());
  }

  normalizeSettings(rawSettings) {
    const merged = { ...this.defaults, ...rawSettings };

    if (!merged.appUrl || this.isLegacyDefaultUrl(merged.appUrl)) {
      merged.appUrl = this.defaults.appUrl;
    }

    return merged;
  }

  loadSettings() {
    try {
      // Ensure directory exists
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });

      // Prefer current config path
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const normalized = this.normalizeSettings(JSON.parse(data));
        fs.writeFileSync(this.configPath, JSON.stringify(normalized, null, 2));
        return normalized;
      }

      // Migrate from legacy config (pre-1.0.9) if present
      if (fs.existsSync(this.legacyConfigPath)) {
        const legacyData = fs.readFileSync(this.legacyConfigPath, 'utf8');
        const merged = this.normalizeSettings(JSON.parse(legacyData));
        // Save migrated data to userData config path
        fs.writeFileSync(this.configPath, JSON.stringify(merged, null, 2));
        return merged;
      }
    } catch (error) {
      console.log('Error loading settings, using defaults:', error);
    }
    return { ...this.defaults };
  }

  saveSettings() {
    try {
      // Ensure directory exists
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2));
      return true;
    } catch (error) {
      console.log('Error saving settings:', error);
      return false;
    }
  }

  get(key) {
    return this.settings[key];
  }

  set(key, value) {
    this.settings[key] = value;
    return this.saveSettings();
  }

  validatePassword(password) {
    return password === this.settings.adminPassword;
  }

  getAll() {
    return { ...this.settings };
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    return this.saveSettings();
  }

  save() {
    return this.saveSettings();
  }
}

module.exports = SettingsManager;
