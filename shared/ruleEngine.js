import { Storage } from './storage.js';

export class RuleEngine {
  static rules = [];
  static enabledRules = new Set();
  static SCOPE_SYNONYM_MAP = {
    any: new Set(['any', 'all']),
    any_headers: new Set(['any header', 'any headers', 'header', 'headers']),
    any_body: new Set(['any body', 'any bodies', 'body', 'bodies']),
    request_all: new Set(['request', 'req', 'request all']),
    response_all: new Set(['response', 'resp', 'response all']),
    request_line: new Set(['request line', 'request_line', 'req line', 'url']),
    response_line: new Set(['response line', 'response_line', 'resp line']),
    request_headers: new Set([
      'request header',
      'request headers',
      'req header',
      'req headers',
      'request_header',
      'req_header',
    ]),
    response_headers: new Set([
      'response header',
      'response headers',
      'resp header',
      'resp headers',
      'response_header',
      'resp_header',
    ]),
    request_body: new Set(['request body', 'req body', 'req_body', 'request_body']),
    response_body: new Set(['response body', 'resp body', 'resp_body', 'response_body']),
  };

  static async init(customRules = []) {
    const base = Array.isArray(customRules) ? customRules : [];
    const saved = await this._loadSavedRules();
    this.rules = this._mergeRules(base, saved);
    this.enabledRules = await this._loadEnabledRules(this.rules);
  }

  static async _loadSavedRules() {
    try {
      const saved = await Storage.getRules();
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  static _mergeRules(base, saved) {
    const byId = new Map();
    for (const r of base || []) if (r?.id) byId.set(r.id, r);
    for (const r of saved || []) if (r?.id) byId.set(r.id, r);
    return [...byId.values()];
  }

  static async _loadEnabledRules(rules) {
    try {
      const cfg = await Storage.getConfig();
      const ids =
        Array.isArray(cfg?.enabledRules) && cfg.enabledRules.length > 0
          ? cfg.enabledRules
          : (rules || []).filter((r) => r.loaded !== false).map((r) => r.id);
      return new Set(ids);
    } catch {
      return new Set((rules || []).filter((r) => r.loaded !== false).map((r) => r.id));
    }
  }

  static match(requestData) {
    const results = [];
    for (const rule of this.rules) {
      if (!this.enabledRules.has(rule.id)) continue;
      const scope = this._normScope(rule.scope);
      const text = this._textForScope(requestData, scope);
      const matches = this._matchOneRule(text, rule);
      if (matches.length > 0) results.push(...matches);
    }
    return results;
  }

  static _ctx(text, index, len) {
    const start = Math.max(0, index - len);
    const end = Math.min(text.length, index + len);
    return text.slice(start, end);
  }

  static _matchOneRule(text, rule) {
    try {
      const { source, flags } = this._normalizeRegexSource(rule.pattern, rule.flags);
      const re = new RegExp(source, flags);
      const matches = [];
      // Use matchAll to avoid manual while/exec loop
      const iter = text.matchAll(re);
      let count = 0;
      for (const m of iter) {
        matches.push({
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          matched: m[0],
          context: this._ctx(text, m.index ?? 0, 50),
          severity: rule.severity || 'medium',
          sensitive:
            rule.sensitive === true || (rule.sensitive === undefined && rule.severity === 'high'),
        });
        count++;
        if (count > 1000) break; // safety guard
      }
      return matches;
    } catch (e) {
      console.warn('rule error', rule.id, e);
      this.enabledRules.delete(rule.id);
      return [];
    }
  }

  static async setEnabled(ids) {
    const set = new Set(Array.isArray(ids) ? ids : []);
    this.enabledRules = set;
    await Storage.setConfig({ key: 'enabledRules', value: [...set] });
  }

  static addRule(rule) {
    if (!rule || !rule.id || !rule.pattern || !rule.name) return false;
    try {
      const { source, flags } = this._normalizeRegexSource(rule.pattern, rule.flags);
      new RegExp(source, flags);
    } catch {
      return false;
    }
    // 若已存在则覆盖，避免重复
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
    // 仅在未明确 loaded=false 时默认启用
    if (rule.loaded !== false) this.enabledRules.add(rule.id);
    Storage.saveRule(rule).catch(() => {});
    this._dedupeInPlace();
    return true;
  }

  static updateRule(rule) {
    if (!rule || !rule.id || !rule.pattern || !rule.name) return false;
    try {
      // Validate regex
      const { source, flags } = this._normalizeRegexSource(rule.pattern, rule.flags);
      new RegExp(source, flags);
    } catch {
      return false;
    }
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
    // 保持现有启用状态；仅在明确 loaded=true 时启用，loaded=false 时禁用
    const hasLoaded = Object.prototype.hasOwnProperty.call(rule, 'loaded');
    if (hasLoaded) {
      if (rule.loaded === true) this.enabledRules.add(rule.id);
      else this.enabledRules.delete(rule.id);
    }
    Storage.saveRule(rule).catch(() => {});
    this._dedupeInPlace();
    return true;
  }

  static _normalizeRegexSource(pattern, flags) {
    let src = String(pattern || '');
    const set = new Set();
    // Combined inline flags at beginning: (?imsuy)
    const head = src.match(/^\(\?([gimsuy]+)\)/);
    if (head) {
      for (const ch of head[1]) set.add(ch);
      src = src.replace(/^\(\?([gimsuy]+)\)/, '');
    }
    // Single inline flags anywhere: (?i), (?m), (?s), (?u), (?y)
    for (const ch of ['i', 'm', 's', 'u', 'y']) {
      const re = new RegExp(`\\(\\?${ch}\\)`, 'g');
      if (re.test(src)) {
        set.add(ch);
        src = src.replace(re, '');
      }
    }
    // Merge provided flags for backward compatibility
    for (const ch of String(flags || '').split('')) set.add(ch);
    // Always global for matchAll
    set.add('g');
    // Keep supported flags order
    const order = ['g', 'i', 'm', 's', 'u', 'y'];
    const outFlags = order.filter((ch) => set.has(ch)).join('');
    return { source: src, flags: outFlags };
  }

  static getRuleIds() {
    return this.rules.map((r) => r.id);
  }

  static deleteRule(id) {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.rules.splice(idx, 1);
    this.enabledRules.delete(id);
    Storage.deleteRule(id).catch(() => {});
    return true;
  }

  static _normScope(s) {
    const raw = String(s || '')
      .trim()
      .toLowerCase();
    if (!raw) return 'any';
    for (const [key, set] of Object.entries(this.SCOPE_SYNONYM_MAP)) {
      if (set.has(raw)) return key;
    }
    return 'any';
  }

  static _joinObj(obj) {
    try {
      return Object.entries(obj || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    } catch {
      return JSON.stringify(obj || {});
    }
  }

  static _buildSegments(req) {
    const reqHeaders = req.reqHeaders || {};
    const resHeaders = req.resHeaders || {};
    const reqBody = String(req.reqBody || '');
    const resBody = String(req.resBody !== undefined ? req.resBody : req.body || '');
    const lineReq = `${String(req.method || '')} ${String(req.url || '')}`.trim();
    const lineResp = `HTTP ${req.statusCode || 0}${req.statusText ? ' ' + req.statusText : ''}`;
    const jReq = this._joinObj(reqHeaders);
    const jRes = this._joinObj(resHeaders);
    return {
      request_line: lineReq,
      response_line: lineResp,
      request_headers: jReq,
      response_headers: jRes,
      any_headers: [jReq, jRes].filter(Boolean).join('\n'),
      request_body: reqBody,
      response_body: resBody,
      any_body: [reqBody, resBody].filter(Boolean).join('\n'),
      request_all: [lineReq, jReq, reqBody].filter(Boolean).join('\n'),
      response_all: [lineResp, jRes, resBody].filter(Boolean).join('\n'),
      any: [lineReq, lineResp, jReq, jRes, reqBody, resBody].filter(Boolean).join('\n'),
    };
  }

  static _textForScope(req, scope) {
    const seg = this._buildSegments(req);
    const key = this._normScope(scope);
    return seg[key] || seg.any;
  }

  static _dedupeInPlace() {
    const byId = new Map();
    for (const r of this.rules) {
      if (!r?.id) continue;
      byId.set(r.id, r);
    }
    this.rules = [...byId.values()];
  }
}
