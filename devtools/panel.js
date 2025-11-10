import { formatTime, escapeHtml, truncate, severityColor } from '../shared/utils.js';

class Panel {
  constructor() {
    this.requests = [];
    this.selectedRequest = null;
    this.filter = {};
    this.view = 'results';
    this.onlyMatched = false;
    this.rules = [];
    this.lastAddedRuleId = null;
    this.enabledRuleIds = new Set();
    this.isPreview = !(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    this.collapsedCategories = new Set();
    this.listContainer = document.getElementById('request-list');
    this.resultsContainer = document.getElementById('results-container');
    this.detailContainer = document.getElementById('request-detail');
    this.rulesContainer = document.getElementById('rules-config');
    this.settingsContainer = document.getElementById('settings-config');
    this.subtabs = document.getElementById('subtabs');
    this.resultsToolbar = document.getElementById('results-toolbar');
    this.onlyMatchedEl = document.getElementById('only-matched');
    this.filterForm = document.getElementById('filter-form');
    this.exportBtn = document.getElementById('export-btn');
    this.clearBtn = document.getElementById('clear-results');
    this.resetBtn = document.getElementById('reset-filter');
    this.globalToggle = document.getElementById('global-toggle');
    this.globalEnabled = true;
    this.filterExtensions = [];
    this.whitelistEnabled = false;
    this.whitelistDomains = [];
    this.blacklistEnabled = false;
    this.blacklistDomains = [];
    this.mainEl = document.querySelector('.main');
    this.splitterEl = document.getElementById('splitter');
    this.bindEvents();
    if (this.isPreview) {
      this.initPreviewData();
    } else {
      this.loadHistory();
      this.loadRules();
      this.listenRealtime();
      this.initGlobalAndSettings();
    }
    this.initSplitter();

    // 默认进入结果分析视图时启用左右分栏布局
    // 修复初始加载未设置 .main.analysis 导致上下堆叠的问题
    this.switchView('results');
  }

  _canUseRuntime() {
    try {
      return typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  bindEvents() {
    this.bindFilterEvents();
    this.bindActionButtons();

    this.subtabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const view = btn.getAttribute('data-view');
      if (view) {
        this.switchView(view);
        return;
      }
    });

    this.onlyMatchedEl.addEventListener('change', () => {
      this.onlyMatched = !!this.onlyMatchedEl.checked;
      this.renderRequests(this.requests);
    });

    if (this.globalToggle) {
      this.globalToggle.addEventListener('change', async () => {
        const enabled = !!this.globalToggle.checked;
        this.globalEnabled = enabled;
        if (this._canUseRuntime()) {
          try {
            await chrome.runtime.sendMessage({ type: 'SET_GLOBAL_ENABLED', enabled });
          } catch (e) {
            console.warn('set global enabled failed', e);
          }
        }
      });
    }
  }

  bindFilterEvents() {
    this.filterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.applyFilter({
        url: document.getElementById('filter-url').value.trim(),
        category: document.getElementById('filter-category').value.trim(),
      });
    });
    this.resetBtn.addEventListener('click', () => {
      document.getElementById('filter-url').value = '';
      document.getElementById('filter-category').value = '';
      this.applyFilter({});
    });
  }

  bindActionButtons() {
    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', async () => {
        if (this.isPreview) {
          const blob = new Blob([JSON.stringify(this.requests, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `hae-export-preview-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }
        const ids = this.getSelectedIds();
        try {
          const res = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA', ids });
          if (!res?.ok) throw new Error(res?.error || 'unknown');
          const blob = new Blob([res.data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `hae-export-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error('Export failed', err);
          alert('导出失败，请重试');
        }
      });
    }
    this.clearBtn.addEventListener('click', async () => {
      if (this.isPreview) {
        this.requests = [];
        this.listContainer.innerHTML = '';
        this.detailContainer.innerHTML = '';
        return;
      }
      try {
        const res = await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
        if (!res?.ok) throw new Error(res?.error || 'clear failed');
        this.requests = [];
        this.listContainer.innerHTML = '';
        this.detailContainer.innerHTML = '';
      } catch (err) {
        console.error('Clear failed', err);
        alert('清空失败，请重试');
      }
    });
  }

  listenRealtime() {
    if (!this._canUseRuntime()) return;
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === 'newMatch') {
          this.addRequest(msg.data);
        }
      });
    } catch (e) {
      console.warn('listen realtime failed', e);
    }
  }

  async loadHistory() {
    if (!this._canUseRuntime()) {
      // 运行在预览或扩展上下文失效时，使用现有内存数据
      this.renderRequests(this.requests || []);
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: 'QUERY_HISTORY', limit: 100 });
      if (res?.ok && Array.isArray(res.records)) {
        this.requests = res.records;
        this.renderRequests(this.requests);
      }
    } catch (e) {
      console.warn('load history failed', e);
    }
  }

  async loadRules() {
    if (!this._canUseRuntime()) {
      // 扩展上下文失效时，直接渲染当前内存规则
      if (this.view === 'rules') this.renderRules();
      return;
    }
    try {
      const resList = await chrome.runtime.sendMessage({ type: 'GET_RULES' });
      const resEnabled = await chrome.runtime.sendMessage({ type: 'GET_ENABLED_RULES' });
      if (resList?.ok && Array.isArray(resList.rules)) this.rules = resList.rules;
      this.enabledRuleIds = new Set(resEnabled?.enabled || []);
      // 若当前处于规则视图，规则加载完成后立即渲染
      if (this.view === 'rules') this.renderRules();
    } catch (e) {
      console.warn('load rules failed', e);
    }
  }

  addRequest(payload) {
    const record = {
      ...payload.requestData,
      // 去重匹配项
      matches: this._dedupeMatches(payload.matches),
      categories: [...new Set(payload.matches.map((m) => m.category))],
    };
    this.requests.unshift(record);
    this.renderRequests(this.requests);
  }

  applyFilter(filter) {
    this.filter = filter || {};
    const filtered = this.requests.filter((r) => {
      if (this.filter.url && !r.url.includes(this.filter.url)) return false;
      if (this.filter.category && !r.categories.includes(this.filter.category)) return false;
      if (this.onlyMatched && (!r.matches || r.matches.length === 0)) return false;
      return true;
    });
    this.renderRequests(filtered);
  }

  renderRequests(requests) {
    this.listContainer.innerHTML = '';
    const parseHost = (url) => {
      const u = String(url || '');
      if (!u) return '';
      try {
        return new URL(u).hostname.toLowerCase();
      } catch (_) {
        return u
          .replace(/^https?:\/\/|^wss?:\/\/|^ftp:\/\//, '')
          .replace(/\/.*$/, '')
          .split(':')[0]
          .toLowerCase();
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
        } catch (_) {
          return false;
        }
      }
      if (host === pat) return true;
      return host.endsWith(`.${pat}`);
    };
    // 应用域名白/黑名单过滤（使历史记录和实时流一致）
    const wlEnabled = !!this.whitelistEnabled;
    const blEnabled = !!this.blacklistEnabled;
    const whitelist = Array.isArray(this.whitelistDomains) ? this.whitelistDomains : [];
    const blacklist = Array.isArray(this.blacklistDomains) ? this.blacklistDomains : [];
    const prefiltered = (requests || []).filter((r) => {
      const rawUrl = String(r.url || '').toLowerCase();
      const scheme = rawUrl.split(':')[0];
      // 协议过滤：隐藏扩展与数据URI
      if (rawUrl.startsWith('chrome-extension://') || scheme === 'data') return false;
      const host = parseHost(rawUrl);
      if (wlEnabled && whitelist.length > 0) {
        return whitelist.some((p) => domainMatch(host, p));
      }
      if (blEnabled && blacklist.length > 0) {
        return !blacklist.some((p) => domainMatch(host, p));
      }
      return true;
    });
    const sevScore = (s) => (s === 'high' ? 3 : s === 'medium' ? 2 : 1);
    const maxSev = (r) => (r.matches || []).reduce((acc, m) => Math.max(acc, sevScore(m.severity)), 0);
    const isSensitive = (r) => (r.matches || []).some((m) => m.sensitive === true);
    const sorted = prefiltered.sort((a, b) => {
      const sa = isSensitive(a) ? 1 : 0;
      const sb = isSensitive(b) ? 1 : 0;
      if (sa !== sb) return sb - sa; // sensitive first
      const ma = maxSev(a);
      const mb = maxSev(b);
      if (ma !== mb) return mb - ma; // higher severity next
      return (b.timestamp || 0) - (a.timestamp || 0); // then newest
    });
    const finalList = this.onlyMatched
      ? sorted.filter((r) => (r.matches || []).length > 0)
      : sorted;
    finalList.forEach((req) => {
      const item = this.createRequestItem(req);
      this.listContainer.appendChild(item);
    });
  }

  createRequestItem(request) {
    const div = document.createElement('div');
    div.className = 'request-item';
    const sensitive = (request.matches || []).some((m) => m.sensitive === true);
    if (sensitive) div.classList.add('sensitive');
    const sev = severityColor(request);
    const names = Array.from(new Set((request.matches || []).map((m) => m.ruleName).filter(Boolean)));
    const nameSummary = names.length ? truncate(names.join(', '), 80) : '';
    const headerLookup = (headers, name) => {
      const h = headers || {};
      const found = Object.entries(h).find(([k]) => String(k || '').toLowerCase() === String(name || '').toLowerCase());
      return found ? found[1] : '';
    };
    const resCT = headerLookup(request.resHeaders, 'content-type') || headerLookup(request.headers, 'content-type');
    const resCLRaw = headerLookup(request.resHeaders, 'content-length') || headerLookup(request.headers, 'content-length');
    let resLen = parseInt(resCLRaw, 10);
    if (!Number.isFinite(resLen) || resLen < 0) {
      try { resLen = new TextEncoder().encode(String(request.resBody || '')).length; } catch (_) { resLen = String(request.resBody || '').length; }
    }
    div.innerHTML = `
      <div class="request-header">
        <span class="method ${escapeHtml(request.method || '')}">${escapeHtml(request.method || '')}</span>
        <span class="url">${escapeHtml(truncate(request.url || '', 80))}</span>
        <span class="length-badge" title="响应长度 (bytes)">${resLen}</span>
        <span class="badge ${sev}">${(request.matches || []).length}</span>
      </div>
      <div class="request-meta">
        <span class="time">${formatTime(request.timestamp || Date.now())}</span>
        ${resCT ? `<span class="ctype">${escapeHtml(resCT)}</span>` : ''}
        ${nameSummary ? `<span class="rule-names">命中规则：${escapeHtml(nameSummary)}</span>` : ''}
      </div>
    `;
    div.addEventListener('click', () => this.renderDetails(request));
    return div;
  }

  renderDetails(request) {
    const matches = request.matches || [];
    this.detailContainer.innerHTML = `
      <div class="detail-header">
        <h3>${escapeHtml((request.method || '') + ' ' + (request.url || ''))}</h3>
        <span class="status">${escapeHtml(String(request.statusCode || ''))}</span>
      </div>
      <div class="detail-tabs">
        <button data-tab="matches" class="active">匹配结果 (${matches.length})</button>
        <button data-tab="req">请求包</button>
        <button data-tab="res">响应包</button>
      </div>
      <div class="detail-content">${this.renderMatches(matches)}</div>
    `;

    // 绑定标签切换逻辑
    const tabs = this.detailContainer.querySelectorAll('.detail-tabs button');
    const contentEl = this.detailContainer.querySelector('.detail-content');
    const makeRawReq = () => {
      const method = String(request.method || 'GET');
      const url = String(request.url || '');
      const reqHeaders = request.reqHeaders || {};
      const headerLines = Object.entries(reqHeaders).map(([k, v]) => `${k}: ${v}`).join('\n');
      const reqBody = String(request.reqBody || '');
      return `${method} ${url}\n${headerLines}\n\n${reqBody}`;
    };
    const makeRawRes = () => {
      const status = String(request.statusCode || '');
      const statusText = String(request.statusText || '');
      const resHeaders = request.resHeaders || {};
      const headerLines = Object.entries(resHeaders).map(([k, v]) => `${k}: ${v}`).join('\n');
      const resBody = String(request.resBody || '');
      return `HTTP/1.1 ${status} ${statusText}\n${headerLines}\n\n${resBody}`;
    };
    const headerLookup = (headers, name) => {
      const h = headers || {};
      const found = Object.entries(h).find(([k]) => String(k || '').toLowerCase() === String(name || '').toLowerCase());
      return found ? found[1] : '';
    };
    const tryPretty = (text, contentType = '') => {
      const s = String(text || '').trim();
      // 尝试 JSON 格式化
      try {
        if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
          const obj = JSON.parse(s);
          return JSON.stringify(obj, null, 2);
        }
      } catch (_) {}
      // 尝试 XML/HTML 基础缩进（简单缩进，不做复杂美化）
      try {
        if (/^<.+>$/s.test(s)) {
          return s
            .replace(/>\s+</g, '>\n<')
            .split('\n')
            .map((line, i, arr) => {
              const open = (line.match(/<[^\/!][^>]*>/g) || []).length;
              const close = (line.match(/<\/[^>]+>/g) || []).length;
              const indentLevel = Math.max(0, (arr._indentLevel = (arr._indentLevel || 0) + open - close));
              return '  '.repeat(indentLevel) + line;
            })
            .join('\n');
        }
      } catch (_) {}
      // 尝试 JavaScript（单行打包）美化：基础缩进与分行
      try {
        const ct = String(contentType || '').toLowerCase();
        const looksJS = ct.includes('javascript') || (s.length > 500 && s.indexOf('\n') < 0 && /[;}]/.test(s));
        if (looksJS) {
          const beautifyJS = (code) => {
            let out = '';
            let indent = 0;
            let inStr = false;
            let strCh = '';
            let escape = false;
            let inTpl = false;
            let inRegex = false;
            for (let i = 0; i < code.length; i++) {
              const c = code[i];
              const prev = code[i - 1];
              if (inStr) {
                out += c;
                if (!escape && c === strCh) { inStr = false; strCh = ''; }
                escape = !escape && c === '\\';
                continue;
              }
              if (inTpl) {
                out += c;
                if (!escape && c === '`') { inTpl = false; }
                escape = !escape && c === '\\';
                continue;
              }
              if (inRegex) {
                out += c;
                if (!escape && c === '/') { inRegex = false; }
                escape = !escape && c === '\\';
                continue;
              }
              if (c === '"' || c === '\'' ) { inStr = true; strCh = c; out += c; continue; }
              if (c === '`') { inTpl = true; out += c; continue; }
              if (c === '/' && prev !== '/' && /[\(,=:\[\{\s]/.test(prev || ' ')) { inRegex = true; out += c; continue; }
              if (c === '{') {
                out += '{\n';
                indent++;
                out += '  '.repeat(indent);
                continue;
              }
              if (c === '}') {
                indent = Math.max(0, indent - 1);
                out += '\n' + '  '.repeat(indent) + '}';
                continue;
              }
              if (c === ';') {
                out += ';\n' + '  '.repeat(indent);
                continue;
              }
              if (c === ',') {
                out += ',\n' + '  '.repeat(indent);
                continue;
              }
              if (c === ')') {
                out += ')';
                continue;
              }
              if (c === '(') {
                out += '(';
                continue;
              }
              out += c;
            }
            return out;
          };
          return beautifyJS(s);
        }
      } catch (_) {}
      return s; // 原样返回
    };
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabs.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');
        if (tab === 'matches') {
          contentEl.innerHTML = this.renderMatches(matches);
        } else if (tab === 'req') {
          // 请求包视图（包含请求行+请求头+请求体），Raw/Pretty 在外框外切换
          const rawReq = makeRawReq();
          const reqBody = String(request.reqBody || '');
          const reqCT = headerLookup(request.reqHeaders, 'content-type') || '';
          const prettyReqBody = tryPretty(reqBody, reqCT) || reqBody;
          const prettyReq = (() => {
            const method = String(request.method || 'GET');
            const url = String(request.url || '');
            const reqHeaders = request.reqHeaders || {};
            const headerLines = Object.entries(reqHeaders).map(([k, v]) => `${k}: ${v}`).join('\n');
            return `${method} ${url}\n${headerLines}\n\n${prettyReqBody}`;
          })();
          contentEl.innerHTML = `
            <div class="packet">
              <div class="packet-controls">
                <div class="packet-title">请求包</div>
                <div class="packet-toggle">
                  <label><input type="radio" name="req-packet-mode" value="raw" checked /> Raw</label>
                  <label><input type="radio" name="req-packet-mode" value="pretty" /> Pretty</label>
                </div>
              </div>
              <div class="packet-frame"><pre class="packet-pre" data-kind="req">${escapeHtml(rawReq)}</pre></div>
            </div>
          `;
          const radios = contentEl.querySelectorAll('input[name="req-packet-mode"]');
          const pre = contentEl.querySelector('pre.packet-pre[data-kind="req"]');
          radios.forEach((r) => r.addEventListener('change', () => {
            const val = contentEl.querySelector('input[name="req-packet-mode"]:checked')?.value || 'raw';
            pre.textContent = val === 'pretty' ? (prettyReq || rawReq) : rawReq;
          }));
        } else if (tab === 'res') {
          // 响应包视图（包含状态行+响应头+响应体），Raw/Pretty 在外框外切换
          const rawRes = makeRawRes();
          const resBody = String(request.resBody || '');
          const resCT = headerLookup(request.resHeaders, 'content-type') || '';
          const prettyResBody = tryPretty(resBody, resCT) || resBody;
          const prettyRes = (() => {
            const status = String(request.statusCode || '');
            const statusText = String(request.statusText || '');
            const resHeaders = request.resHeaders || {};
            const headerLines = Object.entries(resHeaders).map(([k, v]) => `${k}: ${v}`).join('\n');
            return `HTTP/1.1 ${status} ${statusText}\n${headerLines}\n\n${prettyResBody}`;
          })();
          contentEl.innerHTML = `
            <div class="packet">
              <div class="packet-controls">
                <div class="packet-title">响应包</div>
                <div class="packet-toggle">
                  <label><input type="radio" name="res-packet-mode" value="raw" checked /> Raw</label>
                  <label><input type="radio" name="res-packet-mode" value="pretty" /> Pretty</label>
                </div>
              </div>
              <div class="packet-frame"><pre class="packet-pre" data-kind="res">${escapeHtml(rawRes)}</pre></div>
            </div>
          `;
          const radios = contentEl.querySelectorAll('input[name="res-packet-mode"]');
          const pre = contentEl.querySelector('pre.packet-pre[data-kind="res"]');
          radios.forEach((r) => r.addEventListener('change', () => {
            const val = contentEl.querySelector('input[name="res-packet-mode"]:checked')?.value || 'raw';
            pre.textContent = val === 'pretty' ? (prettyRes || rawRes) : rawRes;
          }));
        }
      });
    });
  }

  initSplitter() {
    if (!this.mainEl || !this.splitterEl) return;
    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const rect = this.mainEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const min = 200; // px
      const max = rect.width - 200;
      const clamped = Math.max(min, Math.min(max, x));
      const pct = (clamped / rect.width) * 100;
      this.mainEl.style.setProperty('--left', pct.toFixed(2) + '%');
    };
    const stop = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', stop);
    };
    this.splitterEl.addEventListener('mousedown', (e) => {
      dragging = true;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', stop);
      e.preventDefault();
    });
    this.splitterEl.addEventListener('dblclick', () => {
      this.mainEl.style.removeProperty('--left');
    });
  }

  renderMatches(matches) {
    const unique = this._dedupeMatches(matches);
    const grouped = (unique || []).reduce((acc, m) => {
      const k = m.category || 'Unknown';
      (acc[k] = acc[k] || []).push(m);
      return acc;
    }, {});
    let html = '';
    for (const [category, items] of Object.entries(grouped)) {
      html += `
        <div class="match-group">
          <h4>${escapeHtml(category)} (${items.length})</h4>
          <ul>
            ${items
              .map(
                (m) => `
              <li class="severity-${escapeHtml(m.severity || 'medium')}">
                <strong>${escapeHtml(m.ruleName || '')}</strong>
                <code>${escapeHtml(String(m.matched || ''))}</code>
                <pre class="context">${escapeHtml(String(m.context || ''))}</pre>
              </li>`
              )
              .join('')}
          </ul>
        </div>`;
    }
    return html || '<div class="match-group">暂无匹配</div>';
  }

  _dedupeMatches(matches) {
    const set = new Set();
    const out = [];
    for (const m of matches || []) {
      const key = `${m.ruleName || ''}|${m.category || ''}|${String(m.matched || '')}`;
      if (set.has(key)) continue;
      set.add(key);
      out.push(m);
    }
    return out;
  }

  getSelectedIds() {
    // 简化：当前不支持多选，导出全部历史（可拓展）
    return [];
  }

  async switchView(view) {
    this.view = ['rules', 'settings'].includes(view) ? view : 'results';
    const buttons = this.subtabs.querySelectorAll('button');
    buttons.forEach((b) => {
      const active = b.getAttribute('data-view') === this.view;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const showResults = this.view === 'results';
    const showRules = this.view === 'rules';
    const showSettings = this.view === 'settings';
    this.rulesContainer.hidden = !showRules;
    this.settingsContainer.hidden = !showSettings;
    this.listContainer.hidden = !showResults;
    this.detailContainer.hidden = !showResults;
    if (this.splitterEl) this.splitterEl.hidden = !showResults;
    if (this.mainEl) this.mainEl.classList.toggle('analysis', showResults);
    if (this.resultsContainer) this.resultsContainer.hidden = !showResults;
    if (this.resultsToolbar) this.resultsToolbar.hidden = !showResults;
    if (showRules) {
      if (!this.isPreview) this.loadRules();
      this.renderRules();
    }
    if (showSettings) {
      // 进入配置页时主动刷新一次设置，确保已保存的域名与后缀显示
      if (!this.isPreview && this._canUseRuntime()) {
        await this.initGlobalAndSettings();
      } else {
        this.renderSettings();
      }
    }
  }

  async initGlobalAndSettings() {
    // 初始化全局开关状态
    if (this._canUseRuntime()) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_GLOBAL_ENABLED' });
        const enabled = res?.enabled !== false;
        this.globalEnabled = enabled;
        if (this.globalToggle) this.globalToggle.checked = enabled;
      } catch (e) {
        console.warn('get global enabled failed', e);
      }
      try {
        const res2 = await chrome.runtime.sendMessage({ type: 'GET_FILTER_EXTS' });
        this.filterExtensions = Array.isArray(res2?.list) ? res2.list : [];
      } catch (e) {
        this.filterExtensions = [];
      }
      // 域名白/黑名单配置
      try {
        const r1 = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_ENABLED' });
        this.whitelistEnabled = !!r1?.enabled;
      } catch (_) {}
      try {
        const r2 = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
        this.whitelistDomains = Array.isArray(r2?.list) ? r2.list : [];
      } catch (_) { this.whitelistDomains = []; }
      try {
        const r3 = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_ENABLED' });
        this.blacklistEnabled = !!r3?.enabled;
      } catch (_) {}
      try {
        const r4 = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
        this.blacklistDomains = Array.isArray(r4?.list) ? r4.list : [];
      } catch (_) { this.blacklistDomains = []; }
      // 根据你的要求，持久禁用内置规则
      try {
        await chrome.runtime.sendMessage({ type: 'SET_DEFAULTS_ENABLED', enabled: false });
      } catch (e) {
        console.warn('disable defaults failed', e);
      }
    }
    this.renderSettings();
  }

  renderSettings() {
    if (!this.settingsContainer) return;
    const normExt = (s) => {
      let x = String(s || '').trim().toLowerCase();
      if (!x) return '';
      if (!x.startsWith('.')) x = `.${x}`;
      return x.replace(/[^a-z0-9\._-]/g, '');
    };
    const normDomain = (s) => {
      let x = String(s || '').trim().toLowerCase();
      x = x.replace(/^https?:\/\//, '');
      x = x.replace(/\/.*$/, '');
      x = x.split(':')[0];
      // 保留通配符前缀"*."，但移除纯"."前缀
      if (x.startsWith('.') && !x.startsWith('*.')) x = x.slice(1);
      // 允许通配符"*"，其余字符保持域名合法
      return x.replace(/[^a-z0-9\.\-\*]/g, '');
    };
    const renderChips = (list, id) => {
      const el = this.settingsContainer.querySelector(`#${id}`);
      el.innerHTML = '';
      const uniq = Array.from(new Set((list || []).filter((x) => !!x)));
      for (const val of uniq) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.setAttribute('data-val', val);
        chip.innerHTML = `${escapeHtml(val)} <button type="button" class="chip-remove" data-val="${escapeHtml(val)}" aria-label="移除">×</button>`;
        el.appendChild(chip);
      }
      // 追加一个“＋新增”chip
      const addChip = document.createElement('span');
      addChip.className = 'chip chip-add';
      addChip.innerHTML = '<span class="chip-plus">＋</span><span>新增</span>';
      el.appendChild(addChip);
    };

    this.settingsContainer.innerHTML = `
      <div class="config-section">
        <div class="section-title">静态文件过滤（后缀）</div>
        <div class="section-row">
          <div id="filter-chips" class="chips" aria-label="已过滤后缀"></div>
        </div>
        <div class="section-row" style="display:flex;gap:8px;align-items:center;">
          <input id="filter-exts" placeholder="批量：js,.css,png" value="${escapeHtml((this.filterExtensions||[]).join(', '))}" style="min-width:320px;" />
          <button type="button" id="save-filter">保存</button>
          <button type="button" id="clear-filter">清空</button>
        </div>
        <p class="section-tip">忽略以这些后缀结尾的请求。可使用加号chip新增单个后缀，或在上方批量输入。</p>
      </div>

      <div class="config-section">
        <div class="section-title">域名白名单</div>
        <div class="section-row" style="display:flex;gap:8px;align-items:center;">
          <label><input type="checkbox" id="whitelist-enabled" ${this.whitelistEnabled ? 'checked' : ''}/> 启用白名单</label>
        </div>
        <div class="section-row">
          <div id="whitelist-chips" class="chips" aria-label="白名单域名"></div>
        </div>
        <div class="section-row" style="display:flex;gap:8px;align-items:center;">
          <input id="whitelist-batch" placeholder="批量：api.example.com, *.foo.com; bar.test" style="min-width:320px;" />
          <button type="button" id="save-whitelist">保存</button>
          <button type="button" id="clear-whitelist">清空</button>
        </div>
        <p class="section-tip">启用后仅匹配白名单中的域名。可使用加号chip新增单个域名，或在上方批量输入（逗号/空格/分号分隔）。支持通配符（*），例如 *.example.com。</p>
      </div>

      <div class="config-section">
        <div class="section-title">域名黑名单</div>
        <div class="section-row" style="display:flex;gap:8px;align-items:center;">
          <label><input type="checkbox" id="blacklist-enabled" ${this.blacklistEnabled ? 'checked' : ''}/> 启用黑名单</label>
        </div>
        <div class="section-row">
          <div id="blacklist-chips" class="chips" aria-label="黑名单域名"></div>
        </div>
        <div class="section-row" style="display:flex;gap:8px;align-items:center;">
          <input id="blacklist-batch" placeholder="批量：api.example.com, *.foo.com; bar.test" style="min-width:320px;" />
          <button type="button" id="save-blacklist">保存</button>
          <button type="button" id="clear-blacklist">清空</button>
        </div>
        <p class="section-tip">启用后排除黑名单中的域名。可使用加号chip新增单个域名，或在上方批量输入（逗号/空格/分号分隔）。支持通配符（*），例如 *.example.com。</p>
      </div>
    `;

    // 初始渲染 chips
    renderChips(this.filterExtensions || [], 'filter-chips');
    renderChips(this.whitelistDomains || [], 'whitelist-chips');
    renderChips(this.blacklistDomains || [], 'blacklist-chips');

    // 通过加号chip新增后缀/域名（轻量编辑器）
    const openChipEditor = (containerId, placeholder, onSubmit) => {
      const container = this.settingsContainer.querySelector(`#${containerId}`);
      if (!container) return;
      // 若已存在编辑器，聚焦即可
      const existing = container.querySelector('.chip-editor input');
      if (existing) { existing.focus(); return; }
      const editor = document.createElement('span');
      editor.className = 'chip chip-editor';
      editor.innerHTML = `<input type="text" class="chip-editor-input" placeholder="${escapeHtml(placeholder)}" />`;
      container.appendChild(editor);
      const input = editor.querySelector('input');
      input.focus();
      const commit = async () => {
        const val = input.value || '';
        await onSubmit(val);
        editor.remove();
      };
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { await commit(); }
        else if (e.key === 'Escape') { editor.remove(); }
      });
      input.addEventListener('blur', async () => { await commit(); });
    };
    // 后缀批量保存
    const inputBatch = this.settingsContainer.querySelector('#filter-exts');
    const btnSaveFilter = this.settingsContainer.querySelector('#save-filter');
    btnSaveFilter?.addEventListener('click', async () => {
      const raw = String(inputBatch?.value || '').trim();
      const list = raw.split(',').map((s) => normExt(s)).filter((s) => !!s);
      this.filterExtensions = Array.from(new Set(list));
      renderChips(this.filterExtensions, 'filter-chips');
      if (this._canUseRuntime()) {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'SET_FILTER_EXTS', list: this.filterExtensions });
          if (!res?.ok) throw new Error(res?.error || 'save filter failed');
          alert('已保存过滤后缀');
        } catch (e) {
          console.warn('save filter failed', e);
          alert('保存失败');
        }
      }
    });
    const btnClearFilter = this.settingsContainer.querySelector('#clear-filter');
    btnClearFilter?.addEventListener('click', async () => {
      this.filterExtensions = [];
      renderChips([], 'filter-chips');
      const inputBatchEl = this.settingsContainer.querySelector('#filter-exts');
      if (inputBatchEl) inputBatchEl.value = '';
      if (this._canUseRuntime()) {
        try { await chrome.runtime.sendMessage({ type: 'SET_FILTER_EXTS', list: [] }); } catch (_) {}
      }
    });
    // 删除/新增后缀chip
    const filterChips = this.settingsContainer.querySelector('#filter-chips');
    filterChips?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.chip-remove');
      const add = e.target.closest('.chip-add');
      if (btn) {
        const val = btn.getAttribute('data-val') || '';
        const list = (this.filterExtensions || []).filter((x) => x !== val);
        this.filterExtensions = list;
        renderChips(list, 'filter-chips');
        if (this._canUseRuntime()) {
          try { await chrome.runtime.sendMessage({ type: 'SET_FILTER_EXTS', list }); } catch (_) {}
        }
      } else if (add) {
        openChipEditor('filter-chips', '例如 js 或 .js', async (val) => {
          const v = normExt(val);
          if (!v) return;
          const set = new Set(this.filterExtensions || []);
          set.add(v);
          const list = Array.from(set);
          this.filterExtensions = list;
          renderChips(list, 'filter-chips');
          if (this._canUseRuntime()) {
            try {
              const res = await chrome.runtime.sendMessage({ type: 'SET_FILTER_EXTS', list });
              if (!res?.ok) throw new Error('save failed');
            } catch (e) { console.warn('append ext failed', e); }
          }
        });
      }
    });

    // 白名单开关与保存
    const wlEnabledEl = this.settingsContainer.querySelector('#whitelist-enabled');
    wlEnabledEl?.addEventListener('change', async () => {
      const enabled = !!wlEnabledEl.checked;
      this.whitelistEnabled = enabled;
      if (this._canUseRuntime()) {
        try { await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_ENABLED', enabled }); } catch (_) {}
      }
    });
    const wlSave = this.settingsContainer.querySelector('#save-whitelist');
    wlSave?.addEventListener('click', async () => {
      const batchEl = this.settingsContainer.querySelector('#whitelist-batch');
      const batchRaw = String(batchEl?.value || '').trim();
      const batchList = batchRaw
        ? batchRaw.split(/[\s,;]+/).map((s) => normDomain(s)).filter(Boolean)
        : [];
      const setAll = new Set((this.whitelistDomains || []).map(normDomain).filter(Boolean));
      for (const d of batchList) setAll.add(d);
      const list = Array.from(setAll);
      this.whitelistDomains = list;
      renderChips(list, 'whitelist-chips');
      if (this._canUseRuntime()) {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_DOMAINS', list });
          if (!res?.ok) throw new Error('save failed');
          const r = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
          this.whitelistDomains = Array.isArray(r?.list) ? r.list : list;
          renderChips(this.whitelistDomains, 'whitelist-chips');
          alert('已保存白名单');
        } catch (e) { console.warn('save whitelist failed', e); alert('保存失败'); }
      }
      if (batchEl) batchEl.value = '';
    });
    const wlChips = this.settingsContainer.querySelector('#whitelist-chips');
    wlChips?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.chip-remove');
      const add = e.target.closest('.chip-add');
      if (btn) {
        const val = btn.getAttribute('data-val') || '';
        const list = (this.whitelistDomains || []).filter((x) => x !== val);
        this.whitelistDomains = list;
        renderChips(list, 'whitelist-chips');
        if (this._canUseRuntime()) {
          try {
            const res = await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_DOMAINS', list });
            if (!res?.ok) throw new Error('save failed');
            const r = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
            this.whitelistDomains = Array.isArray(r?.list) ? r.list : list;
            renderChips(this.whitelistDomains, 'whitelist-chips');
          } catch (_) {}
        }
      } else if (add) {
        openChipEditor('whitelist-chips', '例如 *.example.com 或 api.example.com', async (val) => {
          const d = normDomain(val);
          if (!d) return;
          const set = new Set(this.whitelistDomains || []);
          set.add(d);
          const list = Array.from(set);
          this.whitelistDomains = list;
          renderChips(list, 'whitelist-chips');
          if (this._canUseRuntime()) {
            try {
              const res = await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_DOMAINS', list });
              if (!res?.ok) throw new Error('save failed');
              const r = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
              this.whitelistDomains = Array.isArray(r?.list) ? r.list : list;
              renderChips(this.whitelistDomains, 'whitelist-chips');
            } catch (e) { console.warn('append whitelist failed', e); }
          }
        });
      }
    });
    const wlClear = this.settingsContainer.querySelector('#clear-whitelist');
    wlClear?.addEventListener('click', async () => {
      this.whitelistDomains = [];
      renderChips([], 'whitelist-chips');
      const wlBatchEl = this.settingsContainer.querySelector('#whitelist-batch');
      if (wlBatchEl) wlBatchEl.value = '';
      if (this._canUseRuntime()) {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_DOMAINS', list: [] });
          if (!res?.ok) throw new Error('save failed');
          const r = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
          this.whitelistDomains = Array.isArray(r?.list) ? r.list : [];
          renderChips(this.whitelistDomains, 'whitelist-chips');
        } catch (_) {}
      }
    });

    // 黑名单开关与保存
    const blEnabledEl = this.settingsContainer.querySelector('#blacklist-enabled');
    blEnabledEl?.addEventListener('change', async () => {
      const enabled = !!blEnabledEl.checked;
      this.blacklistEnabled = enabled;
      if (this._canUseRuntime()) {
        try { await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_ENABLED', enabled }); } catch (_) {}
      }
    });
    const blSave = this.settingsContainer.querySelector('#save-blacklist');
    blSave?.addEventListener('click', async () => {
      const batchEl = this.settingsContainer.querySelector('#blacklist-batch');
      const batchRaw = String(batchEl?.value || '').trim();
      const batchList = batchRaw
        ? batchRaw.split(/[\s,;]+/).map((s) => normDomain(s)).filter(Boolean)
        : [];
      const setAll = new Set((this.blacklistDomains || []).map(normDomain).filter(Boolean));
      for (const d of batchList) setAll.add(d);
      const list = Array.from(setAll);
      this.blacklistDomains = list;
      renderChips(list, 'blacklist-chips');
      if (this._canUseRuntime()) {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_DOMAINS', list });
          if (!res?.ok) throw new Error('save failed');
          const r = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
          this.blacklistDomains = Array.isArray(r?.list) ? r.list : list;
          renderChips(this.blacklistDomains, 'blacklist-chips');
          alert('已保存黑名单');
        } catch (e) { console.warn('save blacklist failed', e); alert('保存失败'); }
      }
      if (batchEl) batchEl.value = '';
    });
    const blChips = this.settingsContainer.querySelector('#blacklist-chips');
    blChips?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.chip-remove');
      const add = e.target.closest('.chip-add');
      if (btn) {
        const val = btn.getAttribute('data-val') || '';
        const list = (this.blacklistDomains || []).filter((x) => x !== val);
        this.blacklistDomains = list;
        renderChips(list, 'blacklist-chips');
        if (this._canUseRuntime()) {
          try {
            const res = await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_DOMAINS', list });
            if (!res?.ok) throw new Error('save failed');
            const r = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
            this.blacklistDomains = Array.isArray(r?.list) ? r.list : list;
            renderChips(this.blacklistDomains, 'blacklist-chips');
          } catch (_) {}
        }
      } else if (add) {
        openChipEditor('blacklist-chips', '例如 *.example.com 或 analytics.example.com', async (val) => {
          const d = normDomain(val);
          if (!d) return;
          const set = new Set(this.blacklistDomains || []);
          set.add(d);
          const list = Array.from(set);
          this.blacklistDomains = list;
          renderChips(list, 'blacklist-chips');
          if (this._canUseRuntime()) {
            try {
              const res = await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_DOMAINS', list });
              if (!res?.ok) throw new Error('save failed');
              const r = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
              this.blacklistDomains = Array.isArray(r?.list) ? r.list : list;
              renderChips(this.blacklistDomains, 'blacklist-chips');
            } catch (e) { console.warn('append blacklist failed', e); }
          }
        });
      }
    });
    const blClear = this.settingsContainer.querySelector('#clear-blacklist');
    blClear?.addEventListener('click', async () => {
      this.blacklistDomains = [];
      renderChips([], 'blacklist-chips');
      const blBatchEl = this.settingsContainer.querySelector('#blacklist-batch');
      if (blBatchEl) blBatchEl.value = '';
      if (this._canUseRuntime()) {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_DOMAINS', list: [] });
          if (!res?.ok) throw new Error('save failed');
          const r = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
          this.blacklistDomains = Array.isArray(r?.list) ? r.list : [];
          renderChips(this.blacklistDomains, 'blacklist-chips');
        } catch (_) {}
      }
    });
  }

  renderRules() {
    this.rulesContainer.innerHTML = '';
    // 工具栏（导入导出）
    const toolbar = document.createElement('div');
    toolbar.className = 'rules-toolbar';
    const importBtn = document.createElement('button');
    importBtn.textContent = '导入规则 (YAML)';
    const exportBtn = document.createElement('button');
    exportBtn.textContent = '导出规则 (YAML)';
    const clearRulesBtn = document.createElement('button');
    clearRulesBtn.textContent = '清空规则';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.yml,.yaml';
    fileInput.hidden = true;
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const text = await f.text();
      await this.onImportYaml(text);
    });
    exportBtn.addEventListener('click', () => this.onExportYaml());
    clearRulesBtn.addEventListener('click', () => this.onClearRules());
    toolbar.appendChild(importBtn);
    toolbar.appendChild(exportBtn);
    toolbar.appendChild(clearRulesBtn);
    toolbar.appendChild(fileInput);
    this.rulesContainer.appendChild(toolbar);

    // 表头 + 新增规则单行
    this.renderRuleForm();

    // 按类别分组并折叠
    const groups = new Map();
    for (const r of this._orderedRules()) {
      const cat = r.category || 'Uncategorized';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(r);
    }
    for (const [cat, list] of groups.entries()) {
      const group = document.createElement('div');
      group.className = 'rule-group';
      const header = document.createElement('div');
      header.className = 'rule-group-header';
      const title = document.createElement('span');
      title.className = 'rule-group-title';
      title.textContent = `${cat} (${list.length})`;
      const toggle = document.createElement('button');
      const collapsed = this.collapsedCategories.has(cat);
      toggle.textContent = collapsed ? '展开' : '收起';
      toggle.addEventListener('click', () => {
        if (this.collapsedCategories.has(cat)) this.collapsedCategories.delete(cat);
        else this.collapsedCategories.add(cat);
        this.renderRules();
      });
      header.appendChild(title);
      header.appendChild(toggle);
      group.appendChild(header);
      if (!collapsed) {
        const frag = document.createDocumentFragment();
        list.forEach((r) => frag.appendChild(this.createRuleItem(r)));
        group.appendChild(frag);
      }
      this.rulesContainer.appendChild(group);
    }
  }

  createRuleItem(r) {
    const div = document.createElement('div');
    div.className = 'rule-item';
    const enable = this._makeCheckbox(this.enabledRuleIds.has(r.id), (checked) =>
      this.onRuleToggle(r.id, checked)
    );
    const name = this._makeTextInput(r.name, '名称', (val) =>
      this.onRuleInlineSave(r.id, { name: val })
    );
    const cat = this._makeTextInput(r.category, '类别', (val) =>
      this.onRuleInlineSave(r.id, { category: val })
    );
    const sev = this._makeSelect(['low', 'medium', 'high'], r.severity || 'medium', (val) =>
      this.onRuleInlineSave(r.id, { severity: val })
    );
    const sensDefault = (r.sensitive === true) || ((r.sensitive === undefined) && ((r.severity || 'medium') === 'high'));
    const sens = this._makeCheckbox(sensDefault, (checked) =>
      this.onRuleInlineSave(r.id, { sensitive: !!checked })
    );
    const scope = this._makeSelect(
      ['any', 'any header', 'any body', 'request', 'request line', 'request header', 'request body', 'response', 'response line', 'response header', 'response body'],
      this._scopeToYaml(r.scope || 'any'),
      (val) => this.onRuleInlineSave(r.id, { scope: val })
    );
    const pattern = this._makeTextInput(r.pattern, '正则表达式', (val) =>
      this.onRuleInlineSave(r.id, { pattern: val })
    );
    const actions = document.createElement('div');
    actions.className = 'actions-cell';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-delete';
    del.textContent = '删除';
    del.title = `ID: ${r.id}`;
    del.addEventListener('click', () => this.onRuleDelete(r.id));
    actions.appendChild(del);
    div.appendChild(enable);
    div.appendChild(name);
    div.appendChild(cat);
    div.appendChild(sev);
    div.appendChild(sens);
    div.appendChild(scope);
    div.appendChild(pattern);
    div.appendChild(actions);
    return div;
  }

  _makeCheckbox(checked, onChange) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = !!checked;
    el.addEventListener('change', () => onChange(!!el.checked));
    return el;
  }

  _makeTextInput(value, placeholder, onBlur) {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = value || '';
    el.placeholder = placeholder || '';
    el.addEventListener('blur', () => onBlur(el.value));
    return el;
  }

  _makeSelect(options, current, onBlur) {
    const el = document.createElement('select');
    (options || []).forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === current) o.selected = true;
      el.appendChild(o);
    });
    el.addEventListener('blur', () => onBlur(el.value));
    return el;
  }

  renderRuleForm() {
    // 表头
    const header = document.createElement('div');
    header.className = 'rules-header';
    header.innerHTML = `
      <span>启用</span>
      <span>名称</span>
      <span>类别</span>
      <span>严重性</span>
      <span>敏感</span>
      <span>范围</span>
      <span>正则表达式</span>
      <span>操作</span>
    `;
    this.rulesContainer.appendChild(header);

    // 新增规则单行
    const row = document.createElement('div');
    row.className = 'rule-new';
    const placeholder = document.createElement('span');
    placeholder.textContent = '';
    const name = this._makeTextInput('', '名称', () => {});
    const category = this._makeTextInput('', '类别', () => {});
    // 类别建议
    const catList = document.createElement('datalist');
    catList.id = 'category-list';
    const cats = [...new Set(this.rules.map((r) => r.category).filter(Boolean))];
    cats.forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      catList.appendChild(o);
    });
    category.setAttribute('list', 'category-list');
    const severity = this._makeSelect(['low', 'medium', 'high'], 'medium', () => {});
    const sensitiveNew = this._makeCheckbox(false, () => {});
    const scope = this._makeSelect(
      ['any', 'any header', 'any body', 'request', 'request line', 'request header', 'request body', 'response', 'response line', 'response header', 'response body'],
      'any',
      () => {}
    );
    const pattern = this._makeTextInput('', '正则表达式', () => {});
    const actions = document.createElement('div');
    actions.className = 'actions-cell';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '添加';
    addBtn.className = 'btn-add';
    addBtn.addEventListener('click', () => {
      const rule = {
        id: this._genId(name.value, pattern.value),
        name: name.value.trim(),
        category: category.value.trim() || 'Custom',
        severity: severity.value || 'medium',
        sensitive: !!sensitiveNew.checked,
        scope: scope.value || 'any',
        pattern: pattern.value.trim(),
      };
      this.onSubmitNewRule(rule);
    });
    // Enter 提交
    [name, category, severity, scope, pattern].forEach((el) => {
      el.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') addBtn.click();
      });
    });
    actions.appendChild(addBtn);

    row.appendChild(placeholder);
    row.appendChild(name);
    row.appendChild(category);
    row.appendChild(severity);
    row.appendChild(sensitiveNew);
    row.appendChild(scope);
    row.appendChild(pattern);
    row.appendChild(actions);
    this.rulesContainer.appendChild(catList);
    this.rulesContainer.appendChild(row);
  }

  async onSubmitNewRule(rule) {
    try {
      if (!rule.name || !rule.pattern) {
        alert('请填写名称与正则表达式');
        return;
      }
      if (!this._canUseRuntime()) {
        // 扩展上下文不可用，转为本地预览模式
        this.isPreview = true;
        this.rules.push(rule);
        this.lastAddedRuleId = rule.id;
        this.renderRules();
        return;
      }
      const res = await chrome.runtime.sendMessage({ type: 'ADD_RULE', rule });
      if (!res?.ok) throw new Error(res?.error || 'add failed');
      this.lastAddedRuleId = rule.id;
      // 重新加载并渲染
      await this.loadRules();
      this.renderRules();
    } catch (e) {
      console.error('add rule failed', e);
      alert('新增规则失败，请检查正则表达式是否有效');
    }
  }

  _genId(name, pattern) {
    const base = `${String(name || 'rule').trim().toLowerCase()}-${Date.now().toString(36)}`;
    const rand = Math.random().toString(36).slice(2, 6);
    return `r-${base}-${rand}`;
  }

  async onImportYaml(text) {
    try {
      const list = this._parseHaEYaml(text);
      if (!Array.isArray(list) || list.length === 0) {
        alert('未解析到规则');
        return;
      }
      // 记录需要启用的规则ID（按 loaded 字段）
      const toEnableIds = new Set();
      // 批量保存（存在则更新）
      for (const r of list) {
        const exists = this.rules.some((x) => x.name === r.name && x.category === r.category);
        const rule = exists ? { ...r, id: this.rules.find((x) => x.name === r.name && x.category === r.category).id } : r;
        const canRuntime = this._canUseRuntime();
        // 预览模式或扩展上下文不可用：本地处理
        if (this.isPreview || !canRuntime) {
          if (exists) this._applyRuleLocal(rule.id, rule);
          else this.rules.push(rule);
          if (r.loaded) this.enabledRuleIds.add(rule.id);
          if (r.loaded) toEnableIds.add(rule.id);
        } else {
          try {
            const res = await chrome.runtime.sendMessage({ type: 'ADD_RULE', rule });
            if (!res?.ok) console.warn('import save failed for', rule.name);
            if (r.loaded) toEnableIds.add(rule.id);
          } catch (err) {
            // 扩展上下文失效：降级到本地并继续导入
            if (String(err || '').includes('Extension context invalidated')) {
              this.isPreview = true;
              if (exists) this._applyRuleLocal(rule.id, rule);
              else this.rules.push(rule);
              if (r.loaded) this.enabledRuleIds.add(rule.id);
              if (r.loaded) toEnableIds.add(rule.id);
            } else {
              throw err;
            }
          }
        }
      }
      // 同步启用状态：在运行时模式下，按导入的 loaded 字段替换对应规则的启用状态
      if (!this.isPreview && this._canUseRuntime()) {
        try {
          const resEnabled = await chrome.runtime.sendMessage({ type: 'GET_ENABLED_RULES' });
          const current = new Set(Array.isArray(resEnabled?.enabled) ? resEnabled.enabled : []);
          const importedIds = new Set(list.map((r) => r.id));
          // 先移除本次导入的所有规则，再添加 loaded=true 的规则
          importedIds.forEach((id) => current.delete(id));
          for (const id of toEnableIds) current.add(id);
          await chrome.runtime.sendMessage({ type: 'UPDATE_RULES', enabledRules: Array.from(current) });
        } catch (e) {
          console.warn('sync enabled rules failed', e);
        }
      }
      // 渲染最新规则
      if (this.isPreview || !this._canUseRuntime()) {
        this.renderRules();
      } else {
        await this.loadRules();
        this.renderRules();
      }
      alert(`已导入 ${list.length} 条规则`);
    } catch (e) {
      console.error('import yaml failed', e);
      alert('导入失败，请确认YAML格式');
    }
  }

  onExportYaml() {
    try {
      const yaml = this._toHaEYaml(this.rules, this.enabledRuleIds);
      const blob = new Blob([yaml], { type: 'text/yaml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Rules.yml';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('export yaml failed', e);
      alert('导出失败');
    }
  }

  async onClearRules() {
    try {
      // 预览模式：清空本地规则与启用集
      if (this.isPreview || !this._canUseRuntime()) {
        this.rules = [];
        this.enabledRuleIds = new Set();
        this.renderRules();
        return;
      }
      // 运行时：清空所有规则（包括内置）并持久禁用默认规则
      try {
        await chrome.runtime.sendMessage({ type: 'SET_DEFAULTS_ENABLED', enabled: false });
      } catch (_) {}
      const resRules = await chrome.runtime.sendMessage({ type: 'GET_RULES' });
      const all = Array.isArray(resRules?.rules) ? resRules.rules : [];
      const idsToDelete = all.filter((r) => r?.id).map((r) => r.id);
      for (const id of idsToDelete) {
        try {
          await chrome.runtime.sendMessage({ type: 'DELETE_RULE', id });
        } catch (_) {}
      }
      try {
        const resEnabled = await chrome.runtime.sendMessage({ type: 'GET_ENABLED_RULES' });
        const current = new Set(Array.isArray(resEnabled?.enabled) ? resEnabled.enabled : []);
        idsToDelete.forEach((id) => current.delete(id));
        await chrome.runtime.sendMessage({ type: 'UPDATE_RULES', enabledRules: Array.from(current) });
      } catch (e) {
        console.warn('update enabled after clear failed', e);
      }
      await this.loadRules();
      this.renderRules();
      alert('已清空所有规则（含内置），默认规则已禁用');
    } catch (e) {
      console.error('clear rules failed', e);
      alert('清空规则失败，请稍后重试');
    }
  }

  _parseHaEYaml(text) {
    const lines = String(text || '').split(/\r?\n/);
    const rules = [];
    let currentGroup = '';
    let cur = null;
    let lastKey = '';
    const push = () => {
      if (!cur) return;
      const name = String(cur.name || '').trim();
      const f = String(cur.f_regex || '').trim();
      if (!name || !f) { cur = null; lastKey = ''; return; }
      const id = this._genId(name, f);
      const severity = this._colorToSeverity(cur.color);
      const loaded = String(cur.loaded || '').toLowerCase() === 'true';
      const scope = this._normScope(cur.scope || 'any');
      const sensitive = String(cur.sensitive || '').toLowerCase() === 'true';
      const engine = String(cur.engine || 'nfa');
      const s_regex = String(cur.s_regex || '');
      const format = String(cur.format || '{0}');
      rules.push({ id, name, category: currentGroup || (cur.group || 'Custom'), severity, pattern: f, loaded, scope, sensitive, engine, s_regex, format });
      cur = null;
      lastKey = '';
    };
    for (let raw of lines) {
      const line = raw.trim(); // 允许缩进（去除前后空白）
      if (!line || line.startsWith('#')) continue;
      if (line === 'rules:' || line === '- rules:' || line === 'rule:') { continue; }
      const groupMatch = line.match(/^\-\s*group:\s*(.+)$/);
      if (groupMatch) { push(); currentGroup = groupMatch[1].trim(); continue; }
      const newRule = line.match(/^\-\s*name:\s*(.+)$/);
      if (newRule) { push(); cur = { name: newRule[1].trim(), group: currentGroup }; continue; }
      if (!cur) continue;
      const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
      if (kv) {
        const k = kv[1];
        let v = kv[2];
        v = v.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1').trim();
        cur[k] = (cur[k] ? cur[k] + ' ' : '') + v;
        lastKey = k;
      } else if (lastKey) {
        // 处理多行值（尤其是 f_regex）拼接
        cur[lastKey] = (cur[lastKey] || '') + ' ' + line;
      }
    }
    push();
    return rules;
  }

  _toHaEYaml(list, enabledSet) {
    const groups = new Map();
    for (const r of list) {
      const g = r.category || 'Custom';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    const sevToColor = (s) => (s === 'high' ? 'red' : s === 'medium' ? 'yellow' : 'green');
    const out = ['rules:'];
    for (const [group, rules] of groups.entries()) {
      out.push(`- group: ${group}`);
      out.push(`  rule:`);
      for (const r of rules) {
        const loaded = enabledSet.has(r.id) ? 'true' : 'false';
        out.push(`  - name: ${r.name}`);
        out.push(`    loaded: ${loaded}`);
        out.push(`    f_regex: ${r.pattern.includes(':') || r.pattern.includes(' ') ? `'${r.pattern}'` : r.pattern}`);
        out.push(`    s_regex: ${r.s_regex ? `'${String(r.s_regex).replace(/'/g, "''")}'` : "''"}`);
        out.push(`    format: ${r.format ? `'${String(r.format).replace(/'/g, "''")}'` : "'{0}'"}`);
        out.push(`    color: ${sevToColor(r.severity || 'medium')}`);
        out.push(`    scope: ${this._scopeToYaml(r.scope || 'any')}`);
        out.push(`    engine: ${r.engine || 'nfa'}`);
        out.push(`    sensitive: ${(r.sensitive === true) || ((r.sensitive === undefined) && (r.severity === 'high')) ? 'true' : 'false'}`);
      }
    }
    return out.join('\n');
  }

  _colorToSeverity(color) {
    const c = String(color || '').toLowerCase();
    if (c === 'red' || c === 'orange') return 'high';
    if (c === 'yellow' || c === 'green') return 'medium';
    return 'low';
  }

  _normScope(s) {
    const raw = String(s || '').trim().toLowerCase();
    if (!raw || raw === 'any' || raw === 'all') return 'any';
    if (['any header', 'any headers', 'header', 'headers'].includes(raw)) return 'any_headers';
    if (['any body', 'any bodies', 'body', 'bodies'].includes(raw)) return 'any_body';
    if (['request', 'req', 'request all'].includes(raw)) return 'request_all';
    if (['response', 'resp', 'response all'].includes(raw)) return 'response_all';
    if (['request line', 'request_line', 'req line', 'url'].includes(raw)) return 'request_line';
    if (['response line', 'response_line', 'resp line'].includes(raw)) return 'response_line';
    if (['request header', 'request headers', 'req header', 'req headers', 'request_header', 'req_header'].includes(raw)) return 'request_headers';
    if (['response header', 'response headers', 'resp header', 'resp headers', 'response_header', 'resp_header'].includes(raw)) return 'response_headers';
    if (['request body', 'req body', 'req_body', 'request_body'].includes(raw)) return 'request_body';
    if (['response body', 'resp body', 'resp_body', 'response_body'].includes(raw)) return 'response_body';
    return 'any';
  }

  _scopeToYaml(s) {
    const v = this._normScope(s);
    switch (v) {
      case 'any_headers':
        return 'any header';
      case 'any_body':
        return 'any body';
      case 'request_all':
        return 'request';
      case 'response_all':
        return 'response';
      case 'request_line':
        return 'request line';
      case 'response_line':
        return 'response line';
      case 'request_headers':
        return 'request header';
      case 'response_headers':
        return 'response header';
      case 'request_body':
        return 'request body';
      case 'response_body':
        return 'response body';
      case 'any':
      default:
        return 'any';
    }
  }

  async onRuleToggle(id, checked) {
    try {
      if (checked) this.enabledRuleIds.add(id);
      else this.enabledRuleIds.delete(id);
      const enabledRules = Array.from(this.enabledRuleIds);
      const res = await chrome.runtime.sendMessage({ type: 'UPDATE_RULES', enabledRules });
      if (!res?.ok) throw new Error(res?.error || 'update failed');
    } catch (e) {
      console.error('update rule failed', e);
      alert('更新规则失败');
    }
  }

  async onRuleInlineSave(id, patch) {
    try {
      const next = this._assembleRuleUpdate(id, patch);
      if (this.isPreview) {
        this._applyRuleLocal(id, next);
        return;
      }
      const res = await chrome.runtime.sendMessage({ type: 'ADD_RULE', rule: next });
      if (!res?.ok) throw new Error(res?.error || 'save failed');
      this._applyRuleLocal(id, next);
    } catch (e) {
      console.error('inline save failed', e);
      alert('保存失败，请检查正则表达式是否有效');
    }
  }

  async onRuleDelete(id) {
    try {
      if (this.isPreview || !this._canUseRuntime()) {
        this._removeRuleLocal(id);
        this.renderRules();
        return;
      }
      const res = await chrome.runtime.sendMessage({ type: 'DELETE_RULE', id });
      if (!res?.ok) throw new Error(res?.error || 'delete failed');
      this._removeRuleLocal(id);
      this.renderRules();
    } catch (e) {
      console.error('delete rule failed', e);
      alert('删除失败，请稍后重试');
    }
  }

  _assembleRuleUpdate(id, patch) {
    const cur = this.rules.find((x) => x.id === id) || {};
    const next = { id };
    ['name', 'category', 'severity', 'scope', 'pattern', 'flags'].forEach((key) => {
      const val = patch[key] !== undefined ? patch[key] : cur[key];
      if (val === undefined) {
        if (key === 'category') next[key] = 'Custom';
        else if (key === 'severity') next[key] = 'medium';
        else if (key === 'scope') next[key] = 'any';
        else next[key] = '';
      } else {
        next[key] = val;
      }
    });
    // 处理 sensitive 字段：若显式提供则保存；若当前有值则保留；否则保持未定义
    if (patch.sensitive !== undefined) {
      next.sensitive = !!patch.sensitive;
    } else if (cur.sensitive !== undefined) {
      next.sensitive = !!cur.sensitive;
    }
    return next;
  }

  _applyRuleLocal(id, next) {
    const idx = this.rules.findIndex((x) => x.id === id);
    if (idx >= 0) this.rules[idx] = next;
  }

  _removeRuleLocal(id) {
    const idx = this.rules.findIndex((x) => x.id === id);
    if (idx >= 0) this.rules.splice(idx, 1);
    this.enabledRuleIds.delete(id);
  }

  _orderedRules() {
    // 新增的规则优先显示在顶部；其余保持现有顺序
    if (!this.lastAddedRuleId) return this.rules.slice();
    const list = this.rules.slice();
    const idx = list.findIndex((r) => r.id === this.lastAddedRuleId);
    if (idx > 0) {
      const [r] = list.splice(idx, 1);
      list.unshift(r);
    }
    return list;
  }

  initPreviewData() {
    // 预览环境下填充示例数据，避免因 chrome API 缺失报错
    this.rules = [
      { id: 'xss-1', name: 'XSS Script Tag', category: 'XSS', severity: 'high', pattern: '(?i)(<script[\\s\\S]*?>)', scope: 'response body' },
      { id: 'sql-1', name: 'SQL Keyword', category: 'SQLi', severity: 'medium', pattern: '(?i)(SELECT|INSERT|UPDATE|DELETE)', scope: 'request' },
      { id: 'csrf-1', name: 'CSRF Token Missing', category: 'CSRF', severity: 'low', pattern: 'csrf_token=.*', scope: 'any header' },
    ];
    this.enabledRuleIds = new Set(['xss-1', 'sql-1']);
    this.renderRules();
    this.requests = [
      {
        url: 'https://example.com/api/search?q=%3Cscript%3Ealert(1)%3C/script%3E',
        method: 'GET',
        statusCode: 200,
        headers: {},
        body: '',
        timestamp: Date.now(),
        matches: [
          { category: 'XSS', severity: 'high', matched: '<script>alert(1)</script>', ruleName: 'XSS Script Tag', context: 'query string' },
        ],
        categories: ['XSS'],
      },
      {
        url: 'https://example.com/login',
        method: 'POST',
        statusCode: 302,
        headers: {},
        body: 'username=test&password=123',
        timestamp: Date.now() - 5000,
        matches: [],
        categories: [],
      },
    ];
    this.renderRequests(this.requests);
  }
}

// 捕获网络请求并转发到后台进行匹配（预览环境下跳过）
if (typeof chrome !== 'undefined' && chrome.devtools?.network) {
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    try {
      request.getContent((body) => {
        const url = request.request?.url || '';
        if (url.startsWith('chrome://')) return; // 过滤内置URL
        const requestData = toRequestData(request, body);
        try {
          if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({ type: 'CAPTURE_REQUEST', requestData });
          }
        } catch (err) {
          // 扩展上下文失效时忽略发送，避免报错
        }
      });
    } catch (e) {
      console.warn('capture failed', e);
    }
  });
}

function toRequestData(request, body) {
  const req = request.request || {};
  const res = request.response || {};
  const headersReq = Object.fromEntries((req.headers || []).map((h) => [h.name, h.value]));
  const headersRes = Object.fromEntries((res.headers || []).map((h) => [h.name, h.value]));
  let reqBody = '';
  try {
    if (typeof req.postData === 'string') reqBody = req.postData;
    else if (req.postData && typeof req.postData.text === 'string') reqBody = req.postData.text;
  } catch (_) {}
  const resBody = body || '';
  const statusText = String(res.statusText || '');
  return {
    url: req.url || '',
    method: req.method || 'GET',
    statusCode: res.status || 0,
    statusText,
    headers: { ...headersReq, ...headersRes },
    body: resBody,
    reqHeaders: headersReq,
    resHeaders: headersRes,
    reqBody,
    resBody,
    timestamp: Date.now(),
  };
}

new Panel();
