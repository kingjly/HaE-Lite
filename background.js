import { Storage } from './shared/storage.js';
import { RuleEngine } from './shared/ruleEngine.js';
import { DEFAULT_FILTER_EXTS } from './shared/utils.js';
import { processRequest } from './background/requestProcessor.js';
import {
  initDebuggerCapture as initDebuggerCaptureImpl,
  attachAllHttpTabs as attachAllHttpTabsImpl,
  detachAllTabs,
  setGlobalEnabledCache,
} from './background/captureInit.js';

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
    const name = e && e.name ? e.name : '';
    const msg = e && e.message ? e.message : String(e);
    console.warn(`[HaE-Lite] init warn (${name})`, msg);
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
} catch {}

// 初始化完成后再启动 debugger 捕获，避免 Storage 尚未就绪
bootstrap()
  .then(() => {
    try {
      initDebuggerCapture();
    } catch {}
  })
  .catch(() => {
    try {
      initDebuggerCapture();
    } catch {}
  });

// 统一的请求处理：复用现有过滤与匹配逻辑，供消息与 debugger 捕获共用
async function processRequestInternal(req) {
  return processRequest(req);
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
        setGlobalEnabledCache(val);
        if (val) {
          attachAllHttpTabsImpl();
        } else {
          detachAllTabs();
        }
      } catch {}
      sendResponse({ ok: true });
    })
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetGlobalEnabled(sendResponse) {
  Storage.getFlag('globalEnabled')
    .then((val) => {
      // 默认开启
      sendResponse({ ok: true, enabled: val !== false });
    })
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetDefaultsEnabled(sendResponse) {
  Storage.getFlag('disableDefaults')
    .then((flag) => {
      sendResponse({ ok: true, enabled: !flag });
    })
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleSetFilterExts(list, sendResponse) {
  const arr = Array.isArray(list) ? list : [];
  Storage.setValue('filterExtensions', arr)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
}

function handleGetFilterExts(sendResponse) {
  Storage.getValue('filterExtensions', DEFAULT_FILTER_EXTS)
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

async function initDebuggerCapture() {
  return initDebuggerCaptureImpl();
}
