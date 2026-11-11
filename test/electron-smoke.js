// Runs the real main process in real Electron against a local page: npm run test:smoke
// All traffic except localhost is cancelled, and printing renders to PDF instead of
// reaching a printer, so nothing leaves this machine.
const { app, BrowserWindow, session, webContents } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 3683;
const OTHER_PORT = 3682; // a second server is a different origin
const LANDING = `http://localhost:${PORT}/landed`;
const ROOT = path.join(__dirname, '..');
const results = [];
const check = (name, ok, detail) => {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined || ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finish = () => {
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  app.exit(failed ? 1 : 0);
};

// The saved URL redirects to a different origin, as an old hosting address might.
process.env.APP_URL = `http://127.0.0.1:${PORT}/start`;
process.env.KIOSK_WINDOWED = '1';
process.env.UPDATE_PROVIDER = 'generic';
process.env.UPDATE_URL = 'http://127.0.0.1:9/';
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-smoke-')));
app.setAppPath(ROOT);

const printed = [];
app.on('web-contents-created', (_, contents) => {
  contents.print = (options, callback) => {
    contents.printToPDF({}).then((pdf) => {
      printed.push({ options, bytes: pdf.length, js: contents.getLastWebPreferences().javascript });
      callback(true);
    }, () => callback(false, 'render failed'));
  };
});

const localOnly = (ses) => ses.webRequest.onBeforeRequest((details, callback) => {
  const url = new URL(details.url);
  const local = ['file:', 'data:', 'devtools:'].includes(url.protocol) || url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  callback({ cancel: !local });
});

const pages = (req, res) => {
  const redirect = (location) => {
    res.statusCode = 302;
    res.setHeader('location', location);
    res.end();
  };
  if (req.url === '/start') return redirect(LANDING);
  if (req.url === '/redirect-out') return redirect(`http://127.0.0.1:${OTHER_PORT}/outside`);
  if (req.url === '/frame-out') return redirect(`http://127.0.0.1:${OTHER_PORT}/framed`);
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>${req.url}</title><h1>local app</h1>`);
};
const server = http.createServer(pages).listen(PORT);
const otherServer = http.createServer(pages).listen(OTHER_PORT, '127.0.0.1');

require(path.join(ROOT, 'main.js'));

const inPage = (win, code) => win.webContents.executeJavaScript(code, true);
const attempt = (call) => `${call}.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e) }))`;
const findWindow = (page) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().endsWith(page));
const until = async (fn, ms = 8000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = fn();
    if (value) return value;
    await sleep(100);
  }
  return null;
};

app.whenReady().then(async () => {
  localOnly(session.defaultSession);
  localOnly(session.fromPartition('persist:timeclock'));

  const main = await until(() => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === LANDING));
  check('saved URL redirecting to another origin still loads', main, BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));
  if (!main) return finish();
  await sleep(500);

  check('bridge is present in the app page', await inPage(main, 'typeof window.electronAPI.print') === 'function');
  check('page has no Node', await inPage(main, 'typeof require') === 'undefined');

  // App page can do its job...
  const print = await inPage(main, attempt(`window.electronAPI.print('<div>receipt</div>')`));
  check('app page can print', print.ok && print.v === true, print);
  check('receipt rendered to a real PDF', printed[0] && printed[0].bytes > 500, printed);
  check('print stays silent', printed[0] && printed[0].options.silent === true, printed);
  check('receipt window has scripts off', printed[0] && printed[0].js === false, printed);

  // ...but not the protected things.
  for (const call of [`saveSettings({ appUrl: 'https://evil.example' })`, `validatePassword('x')`, `setInitialPassword('longenough1')`, `installPrinterDriver()`, `restartApp()`, `deepRefresh()`, `downloadUpdate()`, `checkForUpdates()`]) {
    const result = await inPage(main, attempt(`window.electronAPI.${call}`));
    check(`app page refused: ${call}`, !result.ok && /Not allowed/.test(result.e), result);
  }

  // Navigation stays put.
  await inPage(main, `location.href = 'https://evil.example/'; 1`).catch(() => {});
  await sleep(600);
  check('external navigation blocked', main.webContents.getURL() === LANDING, main.webContents.getURL());
  await inPage(main, `location.href = '/redirect-out'; 1`).catch(() => {});
  await sleep(800);
  check('redirect to another origin blocked after startup', !main.webContents.getURL().includes(`:${OTHER_PORT}`), main.webContents.getURL());
  const framed = await inPage(main, `new Promise((resolve) => { const f = document.createElement('iframe'); f.src = '/frame-out'; f.onload = () => resolve(true); document.body.appendChild(f); setTimeout(() => resolve(false), 4000); })`);
  check('redirect inside a subframe is left alone', framed && main.webContents.mainFrame.frames.some((f) => f.url.endsWith('/framed')), main.webContents.mainFrame.frames.map((f) => f.url));
  check('window.open to an outside site blocked', await inPage(main, `window.open('https://evil.example/') === null`));
  await inPage(main, `location.href = '/kitchen'; 1`).catch(() => {});
  await until(() => main.webContents.getURL().endsWith('/kitchen'));
  check('same-origin navigation still works', main.webContents.getURL().endsWith('/kitchen'), main.webContents.getURL());

  // Admin panel: first run, unattended device, no default password.
  await inPage(main, attempt('window.electronAPI.openAdminPanel()'));
  const admin = await until(() => findWindow('admin-panel.html'));
  check('admin panel opens', admin);
  if (!admin) return finish();
  await sleep(400);
  const state = await inPage(admin, 'window.electronAPI.getAdminState()');
  check('fresh device has no password set', state.passwordSet === false, state);
  const locked = await inPage(admin, attempt(`window.electronAPI.saveSettings({ appUrl: 'https://royaltheaters.com' })`));
  check('settings stay locked before sign-in', !locked.ok, locked);
  const noGuess = await inPage(admin, attempt(`window.electronAPI.validatePassword('1234')`));
  check('common guess refused on a fresh device', noGuess.ok && noGuess.v.valid === false, noGuess);
  await inPage(admin, 'showAuthForm(); 1');
  await sleep(200);
  check('first-run screen asks to create a password', await inPage(admin, `document.getElementById('authTitle').textContent`) === 'Create Admin Password');
  await inPage(admin, `document.getElementById('password').value='new-admin-pass'; document.getElementById('passwordConfirm').value='different'; authenticate(); 1`);
  await sleep(200);
  check('mismatched confirmation refused', /do not match/.test(await inPage(admin, `document.getElementById('authError').textContent`)));
  await inPage(admin, `document.getElementById('passwordConfirm').value='new-admin-pass'; authenticate(); 1`);
  await sleep(500);
  check('creating a password opens settings', await inPage(admin, `document.getElementById('settingsForm').style.display`) === 'block');

  const evil = await inPage(admin, `window.electronAPI.saveSettings({ appUrl: 'https://evil.example' })`);
  check('off-list URL refused when saving', evil.ok === false, evil);
  const good = await inPage(admin, `window.electronAPI.saveSettings({ appUrl: 'https://royaltheaters.com/x' })`);
  check('Royal URL saves once signed in', good.ok === true, good);
  const second = await inPage(admin, `window.electronAPI.setInitialPassword('another-pass-1')`);
  check('initial password cannot be set twice', second.ok === false, second);

  // Timeclock window opens (its page is blocked here) and closes.
  await inPage(main, attempt('window.electronAPI.openTimeclock()'));
  await sleep(600);
  const closed = await inPage(main, attempt('window.electronAPI.closeTimeclock()'));
  check('timeclock opens and closes from the app', closed.ok && closed.v === true, closed);

  // Lockout, from a new panel so the unlocked session has ended.
  admin.close();
  await until(() => !findWindow('admin-panel.html'));
  await inPage(main, attempt('window.electronAPI.openAdminPanel()'));
  const admin2 = await until(() => findWindow('admin-panel.html'));
  await sleep(400);
  const relocked = await inPage(admin2, attempt(`window.electronAPI.saveSettings({ appUrl: 'https://royaltheaters.com' })`));
  check('closing the panel locks it again', !relocked.ok, relocked);
  let last;
  for (let i = 0; i < 5; i++) last = await inPage(admin2, `window.electronAPI.validatePassword('wrong-guess')`);
  check('five wrong guesses start a lockout', last.valid === false && last.retryAfterMs > 0, last);
  const duringLock = await inPage(admin2, `window.electronAPI.validatePassword('new-admin-pass')`);
  check('correct password also waits during lockout', duringLock.valid === false, duringLock);

  // A failed load leaves buttons, not a blank kiosk.
  admin2.close();
  await until(() => !findWindow('admin-panel.html'));
  otherServer.close();
  main.loadURL(`http://127.0.0.1:${OTHER_PORT}/gone`).catch(() => {});
  const errorPage = await until(() => main.webContents.getURL().endsWith('load-error.html'));
  check('a failed load shows the local error page', errorPage, main.webContents.getURL());
  await sleep(400);
  const buttons = await inPage(main, `[...document.querySelectorAll('button')].map((b) => b.textContent)`);
  check('error page has Try Again and Admin buttons', buttons.includes('Try Again') && buttons.includes('Admin'), buttons);
  await inPage(main, attempt('window.electronAPI.openAdminPanel()'));
  check('Admin button route opens the panel from the error page', await until(() => findWindow('admin-panel.html')));
  findWindow('admin-panel.html').close();
  await until(() => !findWindow('admin-panel.html'));
  const refused = await inPage(main, attempt(`window.electronAPI.print('<div>x</div>')`));
  check('error page cannot print', !refused.ok, refused);
  const retried = await inPage(main, attempt('window.electronAPI.retryAppLoad()'));
  check('Try Again returns to the app', await until(() => main.webContents.getURL() === LANDING), [retried, main.webContents.getURL()]);

  check('no external WebContents left open', webContents.getAllWebContents().every((c) => !/evil\.example/.test(c.getURL())));
  server.close();
  finish();
}).catch((error) => {
  console.log('Smoke test crashed:', error);
  app.exit(1);
});
