import { Storage } from '../shared/storage.js';
import { RuleEngine } from '../shared/ruleEngine.js';
import { DEFAULT_FILTER_EXTS } from '../shared/utils.js';

async function ensureStorageReady() {
  if (!Storage.db) {
    try {
      await Storage.init();
    } catch {}
  }
}

async function isGlobalEnabled() {
  try {
    const v = await Storage.getValue('globalEnabled', true);
    return v !== false;
  } catch {
    return true;
  }
}

function isUnsupportedProtocol(u) {
  const s = String(u || '').toLowerCase();
  return s.startsWith('chrome-extension://') || s.startsWith('data:');
}

async function isFilteredByExtension(url) {
  let list = [];
  try {
    list = await Storage.getValue('filterExtensions', DEFAULT_FILTER_EXTS);
  } catch {}
  const qp = String(url || '')
    .toLowerCase()
    .split('?')[0];
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.some((sfx) => {
    const s = String(sfx || '')
      .trim()
      .toLowerCase();
    if (!s) return false;
    return qp.endsWith(s.startsWith('.') ? s : `.${s}`);
  });
}

function parseHost(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.split(':')[0];
  } catch {
    const m = String(u || '')
      .toLowerCase()
      .match(/^[a-z]+:\/\/([^\/]+)/);
    const raw = m ? m[1] : '';
    return String(raw || '').split(':')[0];
  }
}

function escapeRegex(s) {
  return s.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
}

function cleanPattern(raw) {
  let pat = String(raw || '')
    .trim()
    .toLowerCase();
  pat = pat.replace(/^https?:\/\/|^wss?:\/\/|^ftp:\/\//, '');
  pat = pat.replace(/\/.*$/, '');
  pat = pat.split(':')[0];
  if (pat.startsWith('.')) pat = pat.slice(1);
  return pat;
}

function wildcardMatch(host, pat) {
  const esc = escapeRegex(pat).replace(/\*/g, '.*');
  try {
    const re = new RegExp(`^${esc}$`);
    if (re.test(host)) return true;
    if (pat.startsWith('*.')) {
      const root = pat.slice(2);
      return !!root && host === root;
    }
    return false;
  } catch {
    return false;
  }
}

function exactOrSubdomain(host, pat) {
  return host === pat || host.endsWith(`.${pat}`);
}

function domainMatch(host, raw) {
  const pat = cleanPattern(raw);
  if (!pat) return false;
  return pat.includes('*') ? wildcardMatch(host, pat) : exactOrSubdomain(host, pat);
}

async function checkDomainFilters(host) {
  try {
    const wlEnabled = await Storage.getFlag('whitelistEnabled');
    const blEnabled = await Storage.getFlag('blacklistEnabled');
    const whitelist = await Storage.getValue('domainWhitelist', []);
    const blacklist = await Storage.getValue('domainBlacklist', []);
    if (wlEnabled && Array.isArray(whitelist) && whitelist.length) {
      const allowed = whitelist.some((d) => domainMatch(host, d));
      if (!allowed) return 'whitelist';
    }
    if (blEnabled && Array.isArray(blacklist) && blacklist.length) {
      const blocked = blacklist.some((d) => domainMatch(host, d));
      if (blocked) return 'blacklist';
    }
  } catch {}
  return null;
}

export async function processRequest(requestData) {
  await ensureStorageReady();
  if (!(await isGlobalEnabled())) return { count: 0, skipped: 'disabled' };

  const url = String(requestData?.url || '').toLowerCase();
  if (isUnsupportedProtocol(url)) return { count: 0, skipped: 'protocol' };
  if (await isFilteredByExtension(url)) return { count: 0, skipped: 'filtered' };

  const host = parseHost(url);
  const domainSkip = await checkDomainFilters(host);
  if (domainSkip) return { count: 0, skipped: domainSkip };

  const matches = RuleEngine.match(requestData);
  if (matches.length > 0) {
    Storage.saveRequest(requestData, matches).catch(() => {});
  }

  try {
    chrome.runtime.sendMessage({ type: 'newMatch', data: { requestData, matches } });
  } catch {}
  return { count: matches.length };
}
