const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SettingsManager = require('../settings');

function device(saved) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-settings-'));
  if (saved) fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify(saved));
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(userDataDir, 'config.json'), 'utf8'));
  return { open: () => new SettingsManager({ userDataDir }), onDisk };
}

const URL_OK = 'https://kitchen-pos.systems.royaltheaters.com';

test('an updated device keeps its saved password, hashed', () => {
  const d = device({ appUrl: URL_OK, adminPassword: 'saved-pass', hasSeenDriverPrompt: true });
  const s = d.open();
  assert.equal(s.validatePassword('saved-pass'), true);
  assert.equal(s.validatePassword('other'), false);
  assert.equal(s.hasPassword(), true);
  assert.equal(d.onDisk().adminPasswordNeedsChange, undefined, 'no prompt to change it');
  const disk = d.onDisk();
  assert.equal(disk.adminPassword, undefined);
  assert.match(disk.adminPasswordHash, /^scrypt\$/);
  assert.equal(disk.hasSeenDriverPrompt, true, 'other saved settings survive');
});

test('short passwords from before the update still work', () => {
  const s = device({ appUrl: URL_OK, adminPassword: '1234' }).open();
  assert.equal(s.validatePassword('1234'), true);
});

test('the password survives restarts without being re-flagged or re-hashed', () => {
  const d = device({ appUrl: URL_OK, adminPassword: 'saved-pass' });
  d.open();
  const first = d.onDisk().adminPasswordHash;
  const again = d.open();
  assert.equal(again.validatePassword('saved-pass'), true);
  assert.equal(d.onDisk().adminPasswordHash, first);
});

test('a device with no saved password has no way in and no default', () => {
  for (const guess of ['', '1234', '0000', 'admin', 'password', undefined]) {
    assert.equal(device().open().validatePassword(guess), false, String(guess));
  }
  const s = device().open();
  assert.equal(s.hasPassword(), false);
  assert.equal(s.getAll().adminPassword, undefined);
});

test('first-run password can be created once and clears the warning', () => {
  const d = device();
  const s = d.open();
  assert.equal(s.setPassword('short').ok, false);
  assert.equal(s.hasPassword(), false);
  assert.equal(s.setPassword('a-new-password').ok, true);
  assert.equal(s.validatePassword('a-new-password'), true);
  assert.equal(d.open().validatePassword('a-new-password'), true);
});

test('changing the password clears the warning and retires the old one', () => {
  const d = device({ appUrl: URL_OK, adminPassword: '1234' });
  const s = d.open();
  assert.equal(s.updateSettings({ adminPassword: 'a-new-password' }).ok, true);
  assert.equal(s.validatePassword('1234'), false);
  assert.equal(s.validatePassword('a-new-password'), true);
  assert.equal(d.onDisk().adminPasswordNeedsChange, undefined);
});

test('updateSettings only touches what the admin panel edits', () => {
  const d = device({ appUrl: URL_OK, adminPassword: 'saved-pass' });
  const s = d.open();
  const before = d.onDisk().adminPasswordHash;
  assert.equal(s.updateSettings({ adminPasswordHash: 'x', driverInstalled: true, evil: 1 }).ok, true);
  const disk = d.onDisk();
  assert.equal(disk.adminPasswordHash, before);
  assert.equal(disk.driverInstalled, false);
  assert.equal(disk.evil, undefined);
});

test('updateSettings refuses a bad URL and a weak password, changing nothing', () => {
  const d = device({ appUrl: URL_OK, adminPassword: 'saved-pass' });
  const s = d.open();
  assert.equal(s.updateSettings({ appUrl: 'https://evil.example' }).ok, false);
  assert.equal(s.get('appUrl'), URL_OK);
  assert.equal(s.updateSettings({ appUrl: 'https://royaltheaters.com', adminPassword: 'x' }).ok, false);
  assert.equal(s.get('appUrl'), URL_OK, 'nothing applied when any part fails');
  assert.equal(s.updateSettings(undefined).ok, true);
});

test('a URL saved before the update stays and can be re-saved', () => {
  const s = device({ appUrl: 'https://custom-saved.example.com', adminPassword: 'saved-pass' }).open();
  assert.equal(s.get('appUrl'), 'https://custom-saved.example.com');
  assert.equal(s.updateSettings({ appUrl: 'https://custom-saved.example.com' }).ok, true);
});

test('driver flags still save', () => {
  const d = device();
  const s = d.open();
  s.set('hasSeenDriverPrompt', true);
  assert.equal(d.onDisk().hasSeenDriverPrompt, true);
});

test('a corrupt config file falls back to defaults without a password', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-settings-'));
  fs.writeFileSync(path.join(userDataDir, 'config.json'), '{nope');
  const s = new SettingsManager({ userDataDir });
  assert.equal(s.hasPassword(), false);
  assert.ok(s.get('appUrl'));
});
