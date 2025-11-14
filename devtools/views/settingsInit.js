// Split settings initialization into small helpers to reduce complexity

export async function initGlobalAndSettings(panel) {
  if (panel._canUseRuntime()) {
    await fetchGlobalEnabled(panel);
    await fetchFilterExts(panel);
    await fetchWhitelist(panel);
    await fetchBlacklist(panel);
    await disableDefaults(panel);
  }
  panel.renderSettings();
}

async function fetchGlobalEnabled(panel) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_GLOBAL_ENABLED' });
    const enabled = res?.enabled !== false;
    panel.globalEnabled = enabled;
    if (panel.globalToggle) panel.globalToggle.checked = enabled;
  } catch (e) {
    console.warn('get global enabled failed', e);
    panel.globalEnabled = true;
    if (panel.globalToggle) panel.globalToggle.checked = true;
  }
}

async function fetchFilterExts(panel) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_FILTER_EXTS' });
    panel.filterExtensions = Array.isArray(res?.list) ? res.list : [];
  } catch {
    panel.filterExtensions = [];
  }
}

async function fetchWhitelist(panel) {
  try {
    const r1 = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_ENABLED' });
    panel.whitelistEnabled = !!r1?.enabled;
  } catch {}
  try {
    const r2 = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
    panel.whitelistDomains = Array.isArray(r2?.list) ? r2.list : [];
  } catch {
    panel.whitelistDomains = [];
  }
}

async function fetchBlacklist(panel) {
  try {
    const r3 = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_ENABLED' });
    panel.blacklistEnabled = !!r3?.enabled;
  } catch {}
  try {
    const r4 = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
    panel.blacklistDomains = Array.isArray(r4?.list) ? r4.list : [];
  } catch {
    panel.blacklistDomains = [];
  }
}

async function disableDefaults() {
  try {
    await chrome.runtime.sendMessage({ type: 'SET_DEFAULTS_ENABLED', enabled: false });
  } catch (e) {
    console.warn('disable defaults failed', e);
  }
}
