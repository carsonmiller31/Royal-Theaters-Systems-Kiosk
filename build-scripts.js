#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLATFORMS = {
  win: 'Windows',
  mac: 'macOS', 
  linux: 'Linux'
};

function log(message) {
  console.log(`[BUILD] ${message}`);
}

function executeCommand(command) {
  try {
    log(`Executing: ${command}`);
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch (error) {
    log(`Error executing command: ${error.message}`);
    return false;
  }
}

function checkPrerequisites() {
  log('Checking prerequisites...');
  
  // Check if electron-builder is installed
  try {
    execSync('npx electron-builder --version', { stdio: 'ignore' });
    log('✓ electron-builder found');
  } catch (error) {
    log('✗ electron-builder not found. Run: npm install');
    return false;
  }

  // Check if main files exist
  const requiredFiles = ['main.js', 'preload.js', 'package.json'];
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      log(`✗ Required file missing: ${file}`);
      return false;
    }
  }
  log('✓ All required files found');

  return true;
}

function createIconPlaceholders() {
  const assetsDir = 'assets';
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const placeholders = [
    'icon.ico',
    'icon.icns', 
    'icon.png'
  ];

  for (const placeholder of placeholders) {
    const filePath = path.join(assetsDir, placeholder);
    if (!fs.existsSync(filePath)) {
      log(`Creating placeholder: ${filePath}`);
      fs.writeFileSync(filePath, ''); // Create empty file as placeholder
    }
  }
}

function buildPlatform(platform) {
  log(`Building for ${PLATFORMS[platform]}...`);
  
  const commands = {
    win: 'npx electron-builder -w',
    mac: 'npx electron-builder -m', 
    linux: 'npx electron-builder -l'
  };

  return executeCommand(commands[platform]);
}

function main() {
  const args = process.argv.slice(2);
  const platform = args[0];

  log('Royal Theaters Systems Builder');
  log('============================');

  if (!checkPrerequisites()) {
    process.exit(1);
  }

  createIconPlaceholders();

  if (platform && PLATFORMS[platform]) {
    const success = buildPlatform(platform);
    process.exit(success ? 0 : 1);
  } else if (platform === 'all') {
    log('Building for all platforms...');
    let allSuccess = true;
    for (const [key] of Object.entries(PLATFORMS)) {
      if (!buildPlatform(key)) {
        allSuccess = false;
      }
    }
    process.exit(allSuccess ? 0 : 1);
  } else {
    log('Usage: node build-scripts.js [win|mac|linux|all]');
    log('Available platforms:', Object.keys(PLATFORMS).join(', '));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
