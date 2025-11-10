import { Storage } from './shared/storage.js';
import { RuleEngine } from './shared/ruleEngine.js';

// 初始化数据库与规则引擎
async function bootstrap() {
  try {
    await Storage.init();
    await RuleEngine.init();
    // 定时清理7天前数据（每小时一次）
    setInterval(
      () => {
        Storage.cleanExpired(7 * 24 * 60 * 60 * 1000);
      },
      60 * 60 * 1000
    );
    console.log('[HaE-Lite] background ready');
  } catch (e) {
    console.error('[HaE-Lite] init failed', e);
  }
}

// 点击扩展图标时，直接打开 HaE-Lite 面板页面（非DevTools环境也可浏览历史）
try {
  if (chrome?.action?.onClicked) {
    chrome.action.onClicked.addListener(() => {
      try {
        const url = chrome.runtime.getURL('devtools/panel.html');
        chrome.tabs.create({ url });
      } catch (e) {
        console.warn('Failed to open HaE-Lite panel tab:', e);
      }
    });
  }
} catch (_) {}

// 初始化完成后再启动 debugger 捕获，避免 Storage 尚未就绪
bootstrap().then(() => {
  try { initDebuggerCapture(); } catch {}
}).catch(() => {
  try { initDebuggerCapture(); } catch {}
});

// 统一的请求处理：复用现有过滤与匹配逻辑，供消息与 debugger 捕获共用
async function processRequestInternal(req) {
  if (!Storage.db) {
    try { await Storage.init(); } catch {}
  }
  // 全局开关
  const globalEnabled = await Storage.getValue('globalEnabled', true);
  if (!globalEnabled) return { count: 0, skipped: 'disabled' };

  // 协议过滤
  const url = String(req?.url || '').toLowerCase();
  if (url.startsWith('chrome-extension://') || url.startsWith('data:')) {
    return { count: 0, skipped: 'protocol' };
  }

  // 后缀过滤
  let list = [];
  try { list = await Storage.getValue('filterExtensions', []); } catch {}
  const qp = url.split('?')[0];
  if (Array.isArray(list) && list.length) {
    const hit = list.some((sfx) => {
      const s = String(sfx || '').trim().toLowerCase();
      if (!s) return false;
      return qp.endsWith(s.startsWith('.') ? s : `.${s}`);
    });
    if (hit) return { count: 0, skipped: 'filtered' };
  }

  // 域名白/黑名单过滤
  const parseHost = (u) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h.split(':')[0];
    } catch (_) {
      const m = String(u || '').toLowerCase().match(/^[a-z]+:\/\/([^\/]+)/);
      const raw = m ? m[1] : '';
      return String(raw || '').split(':')[0];
    }
  };
  const domainMatch = (host, raw) => {
    let pat = String(raw || '').trim().toLowerCase();
    pat = pat.replace(/^https?:\/\/|^wss?:\/\/|^ftp:\/\//, '');
    pat = pat.replace(/\/.*$/, '');
    pat = pat.split(':')[0];
    if (pat.startsWith('.')) pat = pat.slice(1);
    if (!pat) return false;
    if (pat.includes('*')) {
      const esc = pat
        .replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&')
        .replace(/\*/g, '.*');
      try {
        const re = new RegExp(`^${esc}$`);
        if (re.test(host)) return true;
        if (pat.startsWith('*.')) {
          const root = pat.slice(2);
          if (root && host === root) return true;
        }
        return false;
      } catch (_) { return false; }
    }
    if (host === pat) return true;
    return host.endsWith(`.${pat}`);
  };
  const host = parseHost(url);
  try {
    const wlEnabled = await Storage.getFlag('whitelistEnabled');
    const blEnabled = await Storage.getFlag('blacklistEnabled');
    const whitelist = await Storage.getValue('domainWhitelist', []);
    const blacklist = await Storage.getValue('domainBlacklist', []);
    if (wlEnabled && Array.isArray(whitelist) && whitelist.length) {
      const allowed = whitelist.some((d) => domainMatch(host, d));
      if (!allowed) return { count: 0, skipped: 'whitelist' };
    }
    if (blEnabled && Array.isArray(blacklist) && blacklist.length) {
      const blocked = blacklist.some((d) => domainMatch(host, d));
      if (blocked) return { count: 0, skipped: 'blacklist' };
    }
  } catch (_) {}

  const matches = RuleEngine.match(req);
  const payload = { requestData: req, matches };
  if (matches.length > 0) {
    Storage.saveRequest(req, matches).catch(() => {});
  }
  try { chrome.runtime.sendMessage({ type: 'newMatch', data: payload }); } catch {}
  return { count: matches.length };
}

// 消息处理
async function handleCaptureRequest(req, sendResponse) {
  try {
    const res = await processRequestInternal(req);
    sendResponse({ ok: true, count: res.count, skipped: res.skipped });
  } catch (error) {
    console.error('match error', error);
    sendResponse({ ok: false, error: String(error) });
  }
}

function handleQueryHistory(filter, limit, sendResponse) {
  Storage.queryHistory(filter || {}, limit || 100)
    .then((records) => sendResponse({ ok: true, records }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleExportData(ids, sendResponse) {
  Storage.exportData(ids || [])
    .then((json) => sendResponse({ ok: true, data: json }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleClearHistory(sendResponse) {
  Storage.clearHistory()
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleUpdateRules(enabledAll, enabledRules, sendResponse) {
  let ids = enabledRules;
  if (typeof enabledAll === 'boolean') ids = enabledAll ? RuleEngine.getRuleIds() : [];
  RuleEngine.setEnabled(ids || [])
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetEnabledRules(sendResponse) {
  try {
    const all = RuleEngine.getRuleIds();
    const enabled = Array.from(RuleEngine.enabledRules || []);
    sendResponse({ ok: true, enabled, all });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
}

function handleGetRules(sendResponse) {
  try {
    // 返回前做一次去重，避免出现同名规则重复
    if (typeof RuleEngine._dedupeInPlace === 'function') {
      RuleEngine._dedupeInPlace();
    }
    const list = (RuleEngine.rules || []).map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category || 'Unknown',
      severity: r.severity || 'medium',
      pattern: r.pattern || '',
      flags: r.flags || '',
      // 关键：返回scope与导入/导出相关字段，避免UI显示为any
      scope: r.scope || 'any',
      sensitive: r.sensitive === true,
      engine: r.engine || 'nfa',
      s_regex: r.s_regex || '',
      format: r.format || '{0}',
    }));
    sendResponse({ ok: true, rules: list });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
}

function handleAddRule(rule, sendResponse) {
  try {
    const exists =
      Array.isArray(RuleEngine.rules) && RuleEngine.rules.some((r) => r.id === rule?.id);
    const ok = exists ? RuleEngine.updateRule(rule) : RuleEngine.addRule(rule);
    sendResponse({ ok });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
}

function handleDeleteRule(id, sendResponse) {
  try {
    const ok = RuleEngine.deleteRule(id);
    sendResponse({ ok });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
}

function handleSetDefaultsEnabled(enabled, sendResponse) {
  Storage.setFlag('disableDefaults', !enabled)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleSetGlobalEnabled(enabled, sendResponse) {
  const val = !!enabled;
  Storage.setFlag('globalEnabled', val)
    .then(() => {
      try {
        globalEnabledCache = val;
        if (val) {
          attachAllHttpTabs();
        } else {
          for (const tabId of Array.from(attachedTabs)) detachFromTab(tabId);
        }
      } catch {}
      sendResponse({ ok: true });
    })
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetGlobalEnabled(sendResponse) {
  Storage.getFlag('globalEnabled').then((val) => {
    // 默认开启
    sendResponse({ ok: true, enabled: val !== false });
  }).catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetDefaultsEnabled(sendResponse) {
  Storage.getFlag('disableDefaults').then((flag) => {
    sendResponse({ ok: true, enabled: !flag });
  }).catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleSetFilterExts(list, sendResponse) {
  const arr = Array.isArray(list) ? list : [];
  Storage.setValue('filterExtensions', arr)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetFilterExts(sendResponse) {
  Storage.getValue('filterExtensions', [])
    .then((list) => sendResponse({ ok: true, list }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleSetWhitelistEnabled(enabled, sendResponse) {
  Storage.setFlag('whitelistEnabled', !!enabled)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetWhitelistEnabled(sendResponse) {
  Storage.getFlag('whitelistEnabled')
    .then((val) => sendResponse({ ok: true, enabled: !!val }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleSetWhitelistDomains(list, sendResponse) {
  const arr = Array.isArray(list) ? list : [];
  Storage.setValue('domainWhitelist', arr)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetWhitelistDomains(sendResponse) {
  Storage.getValue('domainWhitelist', [])
    .then((list) => sendResponse({ ok: true, list }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleSetBlacklistEnabled(enabled, sendResponse) {
  Storage.setFlag('blacklistEnabled', !!enabled)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetBlacklistEnabled(sendResponse) {
  Storage.getFlag('blacklistEnabled')
    .then((val) => sendResponse({ ok: true, enabled: !!val }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleSetBlacklistDomains(list, sendResponse) {
  const arr = Array.isArray(list) ? list : [];
  Storage.setValue('domainBlacklist', arr)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetBlacklistDomains(sendResponse) {
  Storage.getValue('domainBlacklist', [])
    .then((list) => sendResponse({ ok: true, list }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

const messageHandlers = {
  CAPTURE_REQUEST: (msg, sendResponse) => {
    handleCaptureRequest(msg.requestData, sendResponse);
    return true;
  },
  QUERY_HISTORY: (msg, sendResponse) => {
    handleQueryHistory(msg.filter, msg.limit, sendResponse);
    return true;
  },
  EXPORT_DATA: (msg, sendResponse) => {
    handleExportData(msg.ids, sendResponse);
    return true;
  },
  CLEAR_HISTORY: (_msg, sendResponse) => {
    handleClearHistory(sendResponse);
    return true;
  },
  UPDATE_RULES: (msg, sendResponse) => {
    handleUpdateRules(msg.enabledAll, msg.enabledRules, sendResponse);
    return true;
  },
  GET_RULE_IDS: (_msg, sendResponse) => {
    sendResponse({ ok: true, ids: RuleEngine.getRuleIds() });
    return false;
  },
  GET_ENABLED_RULES: (_msg, sendResponse) => {
    handleGetEnabledRules(sendResponse);
    return false;
  },
  GET_RULES: (_msg, sendResponse) => {
    handleGetRules(sendResponse);
    return false;
  },
  ADD_RULE: (msg, sendResponse) => {
    handleAddRule(msg.rule, sendResponse);
    return false;
  },
  DELETE_RULE: (msg, sendResponse) => {
    handleDeleteRule(msg.id, sendResponse);
    return false;
  },
  SET_DEFAULTS_ENABLED: (msg, sendResponse) => {
    handleSetDefaultsEnabled(!!msg.enabled, sendResponse);
    return true;
  },
  GET_DEFAULTS_ENABLED: (_msg, sendResponse) => {
    handleGetDefaultsEnabled(sendResponse);
    return true;
  },
  SET_GLOBAL_ENABLED: (msg, sendResponse) => {
    handleSetGlobalEnabled(!!msg.enabled, sendResponse);
    return true;
  },
  GET_GLOBAL_ENABLED: (_msg, sendResponse) => {
    handleGetGlobalEnabled(sendResponse);
    return true;
  },
  SET_FILTER_EXTS: (msg, sendResponse) => {
    handleSetFilterExts(msg.list, sendResponse);
    return true;
  },
  GET_FILTER_EXTS: (_msg, sendResponse) => {
    handleGetFilterExts(sendResponse);
    return true;
  },
  SET_WHITELIST_ENABLED: (msg, sendResponse) => {
    handleSetWhitelistEnabled(!!msg.enabled, sendResponse);
    return true;
  },
  GET_WHITELIST_ENABLED: (_msg, sendResponse) => {
    handleGetWhitelistEnabled(sendResponse);
    return true;
  },
  SET_WHITELIST_DOMAINS: (msg, sendResponse) => {
    handleSetWhitelistDomains(msg.list, sendResponse);
    return true;
  },
  GET_WHITELIST_DOMAINS: (_msg, sendResponse) => {
    handleGetWhitelistDomains(sendResponse);
    return true;
  },
  SET_BLACKLIST_ENABLED: (msg, sendResponse) => {
    handleSetBlacklistEnabled(!!msg.enabled, sendResponse);
    return true;
  },
  GET_BLACKLIST_ENABLED: (_msg, sendResponse) => {
    handleGetBlacklistEnabled(sendResponse);
    return true;
  },
  SET_BLACKLIST_DOMAINS: (msg, sendResponse) => {
    handleSetBlacklistDomains(msg.list, sendResponse);
    return true;
  },
  GET_BLACKLIST_DOMAINS: (_msg, sendResponse) => {
    handleGetBlacklistDomains(sendResponse);
    return true;
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = messageHandlers[message?.type];
  if (!handler) return false;
  const isAsync = handler(message, sendResponse);
  return !!isAsync;
});

// ========== Debugger 自动捕获 ==========
// 仅当全局开启时附加到 http/https 标签，捕获请求与响应正文
const attachedTabs = new Set();
const sessions = new Map(); // tabId -> Map(requestId -> partial)
let globalEnabledCache = true; // 缓存全局开关，避免频繁读存储
let debuggerListenersRegistered = false; // 防止重复注册事件监听

function isHttpUrl(u) {
  const s = String(u || '').toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
}

function isTextContentType(ct) {
  const s = String(ct || '').toLowerCase();
  return s.startsWith('text/') || s.includes('application/json') || s.includes('application/javascript') || s.includes('application/xml') || s.includes('application/x-www-form-urlencoded');
}

function decodeBody(body, base64, resHeaders) {
  if (!base64) return String(body || '');
  const ct = resHeaders?.['content-type'] || resHeaders?.['Content-Type'] || '';
  if (!isTextContentType(ct)) return ''; // 非文本体跳过，避免噪音
  try {
    return atob(String(body || ''));
  } catch { return ''; }
}

function getSession(tabId) {
  if (!sessions.has(tabId)) sessions.set(tabId, new Map());
  return sessions.get(tabId);
}

function attachToTab(tabId) {
  if (!globalEnabledCache) return; // 全局关闭时不附加
  if (attachedTabs.has(tabId)) return;
  try {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      try {
        chrome.debugger.sendCommand({ tabId }, 'Network.enable');
        attachedTabs.add(tabId);
      } catch (e) {
        try { chrome.debugger.detach({ tabId }); } catch {}
      }
    });
  } catch (_) {}
}

function detachFromTab(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try { chrome.debugger.detach({ tabId }); } catch {}
  attachedTabs.delete(tabId);
  sessions.delete(tabId);
}

async function initDebuggerCapture() {
  if (!Storage.db) {
    try { await Storage.init(); } catch {}
  }
  try { globalEnabledCache = await Storage.getValue('globalEnabled', true); } catch { globalEnabledCache = true; }

  try {
    if (!debuggerListenersRegistered) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && isHttpUrl(tab?.url)) attachToTab(tabId);
      });
      chrome.tabs.onActivated.addListener(({ tabId }) => {
        try { chrome.tabs.get(tabId, (tab) => { if (isHttpUrl(tab?.url)) attachToTab(tabId); }); } catch {}
      });
      chrome.tabs.onRemoved.addListener((tabId) => detachFromTab(tabId));
      chrome.debugger.onDetach.addListener((target) => detachFromTab(target.tabId));

      chrome.debugger.onEvent.addListener(async (source, method, params) => {
        const tabId = source?.tabId;
        if (!attachedTabs.has(tabId)) return;
        const sess = getSession(tabId);
        const id = params?.requestId;
        if (!id) return;
        if (method === 'Network.requestWillBeSent') {
          const req = params.request || {};
          const hdr = req.headers || {};
          sess.set(id, {
            url: req.url || '',
            method: req.method || 'GET',
            reqHeaders: hdr,
            reqBody: String(req.postData || ''),
          });
        } else if (method === 'Network.responseReceived') {
          const rec = sess.get(id) || {};
          const resp = params.response || {};
          rec.statusCode = resp.status || 0;
          rec.statusText = String(resp.statusText || '');
          rec.resHeaders = resp.headers || {};
          sess.set(id, rec);
        } else if (method === 'Network.loadingFinished') {
          const rec = sess.get(id);
          if (!rec) return;
          try {
            chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: id }, async (bodyObj) => {
              const resHeaders = rec.resHeaders || {};
              const resBody = decodeBody(bodyObj?.body || '', !!bodyObj?.base64Encoded, resHeaders);
              const reqHeaders = rec.reqHeaders || {};
              const headers = { ...reqHeaders, ...resHeaders };
              const requestData = {
                url: rec.url || '',
                method: rec.method || 'GET',
                statusCode: rec.statusCode || 0,
                statusText: rec.statusText || '',
                headers,
                body: resBody,
                reqHeaders,
                resHeaders,
                reqBody: rec.reqBody || '',
                resBody,
                timestamp: Date.now(),
              };
              await processRequestInternal(requestData);
              sess.delete(id);
            });
          } catch (_) {
            sess.delete(id);
          }
        }
      });
      debuggerListenersRegistered = true;
    }

    // 根据当前开关状态附加到已有标签
    if (globalEnabledCache) {
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs || []) if (isHttpUrl(t.url)) attachToTab(t.id);
      });
    } else {
      for (const tabId of Array.from(attachedTabs)) detachFromTab(tabId);
    }
  } catch (e) {
    console.warn('init debugger capture failed', e);
  }
}

function attachAllHttpTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs || []) if (isHttpUrl(t.url)) attachToTab(t.id);
  });
}
