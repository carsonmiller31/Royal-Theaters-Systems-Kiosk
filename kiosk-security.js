// The kiosk's security decisions, kept free of Electron so they can be unit tested.
// pos-kiosk and systems-kiosk carry identical copies of this file.
const crypto = require('crypto');

// ---------------------------------------------------------------- admin password

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 };
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keyLength, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [scheme, n, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !salt || !key) return false;
  try {
    const expected = Buffer.from(key, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(n),
      r: SCRYPT.r,
      p: SCRYPT.p
    });
    return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
}

function checkNewPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { ok: true };
}

// Five free tries, then a pause that doubles from 30 seconds up to 15 minutes.
class AttemptLimiter {
  constructor({ freeAttempts = 5, baseLockMs = 30000, maxLockMs = 900000 } = {}) {
    this.freeAttempts = freeAttempts;
    this.baseLockMs = baseLockMs;
    this.maxLockMs = maxLockMs;
    this.failures = 0;
    this.lockedUntil = 0;
  }

  check(now) {
    if (now < this.lockedUntil) return { allowed: false, retryAfterMs: this.lockedUntil - now };
    return { allowed: true, retryAfterMs: 0 };
  }

  failure(now) {
    this.failures += 1;
    if (this.failures >= this.freeAttempts) {
      const doublings = this.failures - this.freeAttempts;
      this.lockedUntil = now + Math.min(this.baseLockMs * 2 ** doublings, this.maxLockMs);
    }
  }

  success() {
    this.failures = 0;
    this.lockedUntil = 0;
  }
}

// ---------------------------------------------------------------- URLs

function parseUrl(value) {
  try {
    return new URL(String(value));
  } catch (error) {
    return null;
  }
}

function hostIsWithin(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

const isRoyalHost = (hostname) => hostIsWithin(hostname, 'royaltheaters.com');
const isScheduleyHost = (hostname) => hostIsWithin(hostname, 'scheduley.net');

function isLanHost(hostname) {
  if (hostname === 'localhost') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

// What an admin may save as the kiosk's target. A value already on a device keeps
// loading after an update; this only decides what can be newly saved.
function checkNewAppUrl(value) {
  const url = parseUrl(typeof value === 'string' ? value.trim() : '');
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    return { ok: false, error: 'Enter a full URL starting with https://.' };
  }
  if (url.username || url.password) return { ok: false, error: 'The URL cannot contain a username or password.' };
  if (isLanHost(url.hostname)) return { ok: true };
  if (url.protocol === 'https:' && isRoyalHost(url.hostname)) return { ok: true };
  return { ok: false, error: 'The URL must be on royaltheaters.com or this local network.' };
}

// appUrl is one URL or a list: the saved URL and where it redirected at startup.
function isTrustedAppPage(pageUrl, appUrl) {
  const url = parseUrl(pageUrl);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return false;
  if (url.protocol === 'https:' && isRoyalHost(url.hostname)) return true;
  return [].concat(appUrl).some((candidate) => {
    const app = parseUrl(candidate);
    return !!app && url.origin === app.origin;
  });
}

// The saved URL may redirect anywhere on the web while the app first loads. Once it
// has loaded, only the usual navigation rules apply.
function isAllowedStartupRedirect(target, appLoadInProgress) {
  const url = parseUrl(target);
  return appLoadInProgress === true && !!url && (url.protocol === 'https:' || url.protocol === 'http:');
}

function isAllowedMainNavigation(target, appUrl) {
  return target === 'about:blank' || isTrustedAppPage(target, appUrl);
}

function isAllowedTimeclockNavigation(target) {
  const url = parseUrl(target);
  return !!url && url.protocol === 'https:' && isScheduleyHost(url.hostname);
}

// ---------------------------------------------------------------- IPC

const LOCAL_PAGES = {
  admin: 'admin-panel.html',
  driver: 'driver-setup.html',
  update: 'update-notification.html'
};

const LOAD_ERROR_PAGE = 'load-error.html';

function isLocalPage(frameUrl, page) {
  const url = parseUrl(frameUrl);
  return !!url && url.protocol === 'file:' && decodeURIComponent(url.pathname).split('/').pop() === page;
}

const ALL_WINDOWS = ['main', 'load-error', 'timeclock', 'admin', 'driver', 'update'];

// Who may call each channel. `unlocked` also requires the admin password this session.
const IPC_POLICY = {
  print: { from: ['main'] },
  'open-admin-panel': { from: ALL_WINDOWS }, // the swipe gesture runs in every window
  'retry-app-load': { from: ['load-error'] },
  'open-timeclock': { from: ['main'] },
  'close-timeclock': { from: ['main', 'timeclock'] },
  'hard-refresh': { from: ['main', 'admin'] },
  'app-exit': { from: ['main', 'admin'] },

  'get-admin-state': { from: ['admin'] },
  'validate-password': { from: ['admin'] },
  'set-initial-password': { from: ['admin'] },
  'close-admin': { from: ['admin'] },
  'app-restart': { from: ['admin'] },
  'deep-refresh': { from: ['admin'] },
  'save-settings': { from: ['admin'], unlocked: true },
  'check-for-updates': { from: ['admin'], unlocked: true },
  'open-driver-setup': { from: ['admin'], unlocked: true },
  'force-kill-app': { from: ['admin'], unlocked: true },

  'get-driver-status': { from: ['driver'] },
  'mark-driver-installed': { from: ['driver'] },
  'mark-driver-prompt-seen': { from: ['driver'] },
  'install-printer-driver': { from: ['driver'] },
  'close-driver-setup': { from: ['driver'] },

  'download-update': { from: ['update'] },
  'install-update': { from: ['update'] },
  'get-update-info': { from: ['update'] },
  'close-update': { from: ['update'] }
};

// The window a call came from, or null when the page in it isn't what belongs there.
function resolveSenderRole({ role, frameUrl, isMainFrame, appUrl }) {
  if (!role || !isMainFrame) return null;
  if (role === 'main') {
    if (isLocalPage(frameUrl, LOAD_ERROR_PAGE)) return 'load-error';
    return isTrustedAppPage(frameUrl, appUrl) ? 'main' : null;
  }
  if (role === 'timeclock') return isAllowedTimeclockNavigation(frameUrl) ? 'timeclock' : null;
  return LOCAL_PAGES[role] && isLocalPage(frameUrl, LOCAL_PAGES[role]) ? role : null;
}

function isIpcAllowed(channel, senderRole, unlocked) {
  const rule = Object.prototype.hasOwnProperty.call(IPC_POLICY, channel) ? IPC_POLICY[channel] : null;
  if (!rule || !senderRole || !rule.from.includes(senderRole)) return false;
  return !rule.unlocked || unlocked === true;
}

module.exports = {
  AttemptLimiter,
  IPC_POLICY,
  MIN_PASSWORD_LENGTH,
  checkNewAppUrl,
  checkNewPassword,
  hashPassword,
  isAllowedMainNavigation,
  isAllowedStartupRedirect,
  isAllowedTimeclockNavigation,
  isIpcAllowed,
  isTrustedAppPage,
  resolveSenderRole,
  verifyPassword
};
