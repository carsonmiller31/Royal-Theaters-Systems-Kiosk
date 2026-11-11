const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../kiosk-security');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const POS_URL = 'https://kitchen-pos.systems.royaltheaters.com';
const file = (name) => `file:///C:/Program%20Files/Kiosk/resources/app.asar/${name}`;

test('passwords hash, verify and reject', () => {
  const stored = s.hashPassword('correct horse');
  assert.match(stored, /^scrypt\$/);
  assert.ok(!stored.includes('correct horse'));
  assert.equal(s.verifyPassword('correct horse', stored), true);
  assert.equal(s.verifyPassword('wrong', stored), false);
  assert.notEqual(stored, s.hashPassword('correct horse'), 'salted');
});

test('verifyPassword fails closed on bad input', () => {
  for (const stored of [undefined, null, '', 'plain', 'scrypt$1$a', 'md5$1$a$b', 'scrypt$notnum$AA==$AA==']) {
    assert.equal(s.verifyPassword('x', stored), false);
  }
  assert.equal(s.verifyPassword(1234, s.hashPassword('1234')), false);
  assert.equal(s.verifyPassword('', s.hashPassword('abcdefgh')), false);
});

test('new passwords need 8 characters', () => {
  assert.equal(s.checkNewPassword('1234567').ok, false);
  assert.equal(s.checkNewPassword('12345678').ok, true);
  assert.equal(s.checkNewPassword(undefined).ok, false);
});

test('attempt limiter locks after five failures and doubles', () => {
  const limit = new s.AttemptLimiter();
  for (let i = 0; i < 4; i++) limit.failure(1000);
  assert.equal(limit.check(1000).allowed, true);
  limit.failure(1000);
  assert.deepEqual(limit.check(1000), { allowed: false, retryAfterMs: 30000 });
  assert.equal(limit.check(31000).allowed, true);
  limit.failure(31000);
  assert.equal(limit.check(31000).retryAfterMs, 60000);
});

test('attempt limiter caps the pause and resets on success', () => {
  const limit = new s.AttemptLimiter();
  for (let i = 0; i < 40; i++) limit.failure(0);
  assert.equal(limit.check(0).retryAfterMs, 900000);
  limit.success();
  assert.equal(limit.check(0).allowed, true);
  assert.equal(limit.failures, 0);
});

test('what can be saved as the kiosk URL', () => {
  for (const ok of [POS_URL, 'https://systems.royaltheaters.com/showtimes/kiosk', 'https://royaltheaters.com', 'http://192.168.1.186:3000', 'http://10.0.0.5', 'http://172.16.1.1:3000', 'http://localhost:3000', 'http://127.0.0.1:3681']) {
    assert.equal(s.checkNewAppUrl(ok).ok, true, ok);
  }
  for (const bad of ['', 'not a url', 'https://evil.example', 'http://kitchen-pos.systems.royaltheaters.com', 'https://royaltheaters.com.evil.example', 'https://evilroyaltheaters.com', 'javascript:alert(1)', 'file:///C:/x.html', 'https://user:pw@kitchen-pos.systems.royaltheaters.com', 'http://172.32.0.1', 'http://8.8.8.8', 5, null]) {
    assert.equal(s.checkNewAppUrl(bad).ok, false, String(bad));
  }
});

test('main window navigation stays on Royal pages or the saved app origin', () => {
  assert.equal(s.isAllowedMainNavigation(`${POS_URL}/kitchen`, POS_URL), true);
  assert.equal(s.isAllowedMainNavigation('https://volume-times.systems.royaltheaters.com/x', POS_URL), true);
  assert.equal(s.isAllowedMainNavigation('about:blank', POS_URL), true);
  assert.equal(s.isAllowedMainNavigation('http://192.168.1.186:3000/kitchen', 'http://192.168.1.186:3000'), true);
  assert.equal(s.isAllowedMainNavigation('https://legacy.vercel.app/x', 'https://legacy.vercel.app'), true, 'a value already saved keeps working');
  for (const bad of ['https://evil.example', 'https://royaltheaters.com.evil.example/', 'http://kitchen-pos.systems.royaltheaters.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'http://192.168.1.186:3000/']) {
    assert.equal(s.isAllowedMainNavigation(bad, POS_URL), false, bad);
  }
});

test('startup redirect: the saved URL may land on another origin, only while first loading', () => {
  const landing = 'https://landing.example.net/app';
  const saved = 'https://custom-saved.example.com/';
  assert.equal(s.isAllowedMainNavigation(landing, saved), false, 'a different origin is refused by default');
  assert.equal(s.isAllowedStartupRedirect(landing, true), true);
  assert.equal(s.isAllowedStartupRedirect(landing, false), false, 'not after the app has loaded');
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
    assert.equal(s.isAllowedStartupRedirect(bad, true), false, bad);
  }
  const trusted = [saved, landing];
  assert.equal(s.isAllowedMainNavigation('https://landing.example.net/next', trusted), true, 'the landing origin is then trusted');
  assert.equal(s.isAllowedMainNavigation('https://custom-saved.example.com/x', trusted), true, 'the saved origin stays trusted');
  assert.equal(s.isAllowedMainNavigation('https://third.example.org/', trusted), false);
  assert.equal(s.resolveSenderRole({ role: 'main', frameUrl: 'https://landing.example.net/app', isMainFrame: true, appUrl: trusted }), 'main');
  assert.equal(s.resolveSenderRole({ role: 'main', frameUrl: 'https://third.example.org/', isMainFrame: true, appUrl: trusted }), null);
});

test('failed-load page can reach admin and retry, and nothing else', () => {
  const role = s.resolveSenderRole({ role: 'main', frameUrl: file('load-error.html'), isMainFrame: true, appUrl: POS_URL });
  assert.equal(role, 'load-error');
  assert.equal(s.isIpcAllowed('open-admin-panel', role, false), true);
  assert.equal(s.isIpcAllowed('retry-app-load', role, false), true);
  for (const ch of Object.keys(s.IPC_POLICY).filter((c) => !['open-admin-panel', 'retry-app-load'].includes(c))) {
    assert.equal(s.isIpcAllowed(ch, role, true), false, ch);
  }
  assert.equal(s.resolveSenderRole({ role: 'admin', frameUrl: file('load-error.html'), isMainFrame: true, appUrl: POS_URL }), null);
  assert.equal(s.isIpcAllowed('retry-app-load', 'main', true), false);
});

test('timeclock stays on Scheduley over https', () => {
  assert.equal(s.isAllowedTimeclockNavigation('https://timeclock.scheduley.net/timeclock'), true);
  assert.equal(s.isAllowedTimeclockNavigation('https://scheduley.net/'), true);
  for (const bad of ['http://timeclock.scheduley.net/', 'https://scheduley.net.evil.example/', 'https://evil.example/', POS_URL]) {
    assert.equal(s.isAllowedTimeclockNavigation(bad), false, bad);
  }
});

test('sender role needs the right page in the right window', () => {
  const role = (r, frameUrl, isMainFrame = true) => s.resolveSenderRole({ role: r, frameUrl, isMainFrame, appUrl: POS_URL });
  assert.equal(role('main', `${POS_URL}/`), 'main');
  assert.equal(role('main', 'https://evil.example/'), null);
  assert.equal(role('main', `${POS_URL}/`, false), null, 'subframes are refused');
  assert.equal(role('timeclock', 'https://timeclock.scheduley.net/timeclock'), 'timeclock');
  assert.equal(role('timeclock', POS_URL), null);
  assert.equal(role('admin', file('admin-panel.html')), 'admin');
  assert.equal(role('driver', file('driver-setup.html')), 'driver');
  assert.equal(role('update', file('update-notification.html')), 'update');
  assert.equal(role('admin', file('driver-setup.html')), null);
  assert.equal(role('admin', 'https://evil.example/admin-panel.html'), null);
  assert.equal(role(null, `${POS_URL}/`), null);
  assert.equal(role('bogus', file('admin-panel.html')), null);
});

test('IPC matrix: what the web POS and the timeclock can reach', () => {
  for (const ch of ['print', 'open-admin-panel', 'open-timeclock', 'close-timeclock', 'hard-refresh', 'app-exit']) {
    assert.equal(s.isIpcAllowed(ch, 'main', false), true, ch);
  }
  for (const ch of ['save-settings', 'validate-password', 'set-initial-password', 'install-printer-driver', 'force-kill-app', 'app-restart', 'deep-refresh', 'download-update', 'install-update', 'check-for-updates', 'open-driver-setup']) {
    assert.equal(s.isIpcAllowed(ch, 'main', true), false, ch);
  }
  assert.equal(s.isIpcAllowed('open-admin-panel', 'timeclock', false), true);
  assert.equal(s.isIpcAllowed('close-timeclock', 'timeclock', false), true);
  for (const ch of Object.keys(s.IPC_POLICY).filter((c) => !['open-admin-panel', 'close-timeclock'].includes(c))) {
    assert.equal(s.isIpcAllowed(ch, 'timeclock', true), false, ch);
  }
});

test('IPC matrix: protected admin calls need the password', () => {
  for (const ch of ['save-settings', 'check-for-updates', 'open-driver-setup', 'force-kill-app']) {
    assert.equal(s.isIpcAllowed(ch, 'admin', false), false, ch);
    assert.equal(s.isIpcAllowed(ch, 'admin', true), true, ch);
  }
  for (const ch of ['app-restart', 'app-exit', 'hard-refresh', 'deep-refresh', 'close-admin', 'validate-password', 'set-initial-password', 'get-admin-state']) {
    assert.equal(s.isIpcAllowed(ch, 'admin', false), true, ch);
  }
});

test('IPC refuses unknown channels, unknown senders, and prototype names', () => {
  assert.equal(s.isIpcAllowed('nope', 'admin', true), false);
  assert.equal(s.isIpcAllowed('print', null, true), false);
  assert.equal(s.isIpcAllowed('constructor', 'admin', true), false);
  assert.equal(s.isIpcAllowed('__proto__', 'admin', true), false);
});

test('driver and update windows keep their flows', () => {
  for (const ch of ['get-driver-status', 'mark-driver-installed', 'mark-driver-prompt-seen', 'install-printer-driver', 'close-driver-setup']) {
    assert.equal(s.isIpcAllowed(ch, 'driver', false), true, ch);
  }
  for (const ch of ['download-update', 'install-update', 'get-update-info', 'close-update']) {
    assert.equal(s.isIpcAllowed(ch, 'update', false), true, ch);
  }
});

const handled = [...read('main.js').matchAll(/guardedHandle\('([a-z-]+)'/g)].map((m) => m[1]);
const invoked = [...read('preload.js').matchAll(/invoke\('([a-z-]+)'/g)].map((m) => m[1]);

test('every IPC handler goes through the guard and has a policy', () => {
  assert.ok(handled.length >= 25);
  assert.equal([...read('main.js').matchAll(/ipcMain\.handle\(/g)].length, 1, 'only guardedHandle calls ipcMain.handle');
  for (const ch of handled) assert.ok(s.IPC_POLICY[ch], ch);
  for (const ch of Object.keys(s.IPC_POLICY)) assert.ok(handled.includes(ch), `policy without handler: ${ch}`);
});

test('everything the preload exposes is handled', () => {
  for (const ch of invoked) assert.ok(handled.includes(ch), ch);
});

test('subframe redirects are left alone and failed loads get a page with buttons', () => {
  const main = read('main.js');
  assert.match(main, /if \(!event\.isMainFrame \|\| isAllowed\(event\.url\)/);
  assert.match(main, /did-fail-load/);
  const page = read('load-error.html');
  assert.match(page, /electronAPI\.retryAppLoad\(\)/);
  assert.match(page, /electronAPI\.openAdminPanel\(\)/);
});

test('every window uses the secure preferences and is confined', () => {
  const main = read('main.js');
  const windows = main.match(/new BrowserWindow\(\{[\s\S]*?\n\s*\}\);/g);
  assert.equal(windows.length, 6, 'main, driver, admin, update, print, timeclock');
  for (const block of windows) assert.match(block, /secureWebPreferences\(/);
  assert.equal([...main.matchAll(/restrictNavigation\(\s*(?:mainWindow|driverWindow|adminWindow|updateWindow|printWin|timeclockWindow)\.webContents/g)].length, 6);
  assert.ok(!/fullscreen: true/.test(main));
  assert.match(main, /kiosk: !WINDOWED_FOR_DEV/);
  assert.match(main, /devTools: !IS_PACKAGED/);
  assert.match(main, /setApplicationMenu\(/);
  assert.match(main, /globalShortcut\.register\('CommandOrControl\+Shift\+Alt\+A'/);
});

test('the security module ships in the installer', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const f of ['main.js', 'preload.js', 'settings.js', 'kiosk-security.js', 'load-error.html']) assert.ok(pkg.build.files.includes(f), f);
});

test('the two kiosks share the same security module', (t) => {
  const siblingName = path.basename(root) === 'pos-kiosk' ? 'systems-kiosk' : 'pos-kiosk';
  const other = path.join(root, '..', siblingName, 'kiosk-security.js');
  const inWorkspace = fs.existsSync(path.join(root, '..', '..', 'REPOSITORIES.md'));
  if (!fs.existsSync(other)) {
    assert.ok(!inWorkspace, `${siblingName} is missing from the workspace`);
    t.skip(`standalone checkout: ${siblingName} is a separate repo`);
    return;
  }
  assert.equal(fs.readFileSync(other, 'utf8'), read('kiosk-security.js'));
});

test('no admin password is committed in defaults or config', () => {
  assert.ok(!/adminPassword:\s*['"]/.test(read('settings.js')));
  assert.equal(JSON.parse(read('config.json')).adminPassword, undefined);
});
