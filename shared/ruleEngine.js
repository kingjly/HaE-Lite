import { DEFAULT_RULES } from './rules.js';
import { Storage } from './storage.js';

export class RuleEngine {
  static rules = [];
  static enabledRules = new Set();

  static async init(customRules = []) {
    let useDefaults = true;
    try {
      const disabled = await Storage.getFlag('disableDefaults');
      useDefaults = !disabled;
    } catch {}
    const base = [
      ...(useDefaults ? DEFAULT_RULES : []),
      ...(Array.isArray(customRules) ? customRules : []),
    ];
    let saved = [];
    try {
      saved = await Storage.getRules();
    } catch {}
    // 去重并以已保存规则覆盖默认规则（按 id 合并）
    const byId = new Map();
    for (const r of base) byId.set(r.id, r);
    for (const r of saved) byId.set(r.id, r);
    this.rules = [...byId.values()];
    try {
      const cfg = await Storage.getConfig();
      const ids = Array.isArray(cfg?.enabledRules) && cfg.enabledRules.length > 0
        ? cfg.enabledRules
        : this.rules
            .filter((r) => r.loaded !== false)
            .map((r) => r.id);
      this.enabledRules = new Set(ids);
    } catch {
      // 默认只启用 loaded!==false 的规则（无 loaded 字段视为启用）
      this.enabledRules = new Set(this.rules.filter((r) => r.loaded !== false).map((r) => r.id));
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
          sensitive: rule.sensitive === true || ((rule.sensitive === undefined) && (rule.severity === 'high')),
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
    const raw = String(s || '').trim().toLowerCase();
    if (!raw || raw === 'any' || raw === 'all') return 'any';
    if (['any header', 'any headers', 'header', 'headers'].includes(raw)) return 'any_headers';
    if (['any body', 'any bodies', 'body', 'bodies'].includes(raw)) return 'any_body';
    if (['request', 'req', 'request all'].includes(raw)) return 'request_all';
    if (['response', 'resp', 'response all'].includes(raw)) return 'response_all';
    if (['request line', 'request_line', 'req line', 'url'].includes(raw)) return 'request_line';
    if (['response line', 'response_line', 'resp line'].includes(raw)) return 'response_line';
    if (['request header', 'request headers', 'req header', 'req headers', 'request_header', 'req_header'].includes(raw))
      return 'request_headers';
    if (['response header', 'response headers', 'resp header', 'resp headers', 'response_header', 'resp_header'].includes(raw))
      return 'response_headers';
    if (['request body', 'req body', 'req_body', 'request_body'].includes(raw))
      return 'request_body';
    if (['response body', 'resp body', 'resp_body', 'response_body'].includes(raw))
      return 'response_body';
    return 'any';
  }

  static _textForScope(req, scope) {
    const reqHeaders = req.reqHeaders || {};
    const resHeaders = req.resHeaders || {};
    const reqBody = String(req.reqBody || '');
    const resBody = String(req.resBody !== undefined ? req.resBody : req.body || '');
    const joinObj = (obj) => {
      try {
        return Object.entries(obj || {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
      } catch {
        return JSON.stringify(obj || {});
      }
    };
    const lineReq = `${String(req.method || '')} ${String(req.url || '')}`.trim();
    const lineResp = `HTTP ${req.statusCode || 0}${req.statusText ? ' ' + req.statusText : ''}`;
    switch (scope) {
      case 'request_line':
        return lineReq;
      case 'response_line':
        return lineResp;
      case 'request_headers':
        return joinObj(reqHeaders);
      case 'response_headers':
        return joinObj(resHeaders);
      case 'any_headers':
        return [joinObj(reqHeaders), joinObj(resHeaders)].filter(Boolean).join('\n');
      case 'request_body':
        return reqBody;
      case 'response_body':
        return resBody;
      case 'any_body':
        return [reqBody, resBody].filter(Boolean).join('\n');
      case 'request_all':
        return [lineReq, joinObj(reqHeaders), reqBody].filter(Boolean).join('\n');
      case 'response_all':
        return [lineResp, joinObj(resHeaders), resBody].filter(Boolean).join('\n');
      case 'any':
      default:
        return [lineReq, lineResp, joinObj(reqHeaders), joinObj(resHeaders), reqBody, resBody]
          .filter(Boolean)
          .join('\n');
    }
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
