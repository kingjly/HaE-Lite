import { escapeHtml, genRuleId } from '../shared/utils.js';
import { startNetworkCapture } from './networkCapture.js';
import { renderSettings as renderSettingsView } from './views/settingsView.js';
import {
  renderRules as renderRulesView,
  renderRuleForm as renderRuleFormView,
  createRuleItem as createRuleItemView,
} from './views/rulesView.js';
import { createUiSelect as createUiSelectView } from './views/uiSelect.js';
import { initPreviewData as initPreviewDataView } from './views/previewInit.js';
import {
  renderRequests as renderRequestsView,
  createRequestItem as createRequestItemView,
  renderDetails as renderDetailsView,
} from './views/requestsView.js';
import {
  switchView as switchViewView,
  bindActionButtons as bindActionButtonsView,
} from './views/uiControls.js';
import { initGlobalAndSettings as initGlobalAndSettingsView } from './views/settingsInit.js';
import {
  onSubmitNewRule as onSubmitNewRuleView,
  onImportYaml as onImportYamlView,
  onExportYaml as onExportYamlView,
  onClearRules as onClearRulesView,
  assembleRuleUpdate as assembleRuleUpdateView,
  applyRuleLocal as applyRuleLocalView,
  removeRuleLocal as removeRuleLocalView,
  orderedRules as orderedRulesView,
  importYamlProcess as importYamlProcessView,
  importRulesLocal as importRulesLocalView,
  importRulesRuntime as importRulesRuntimeView,
  syncEnabledRuntime as syncEnabledRuntimeView,
  clearRulesLocal as clearRulesLocalView,
  clearRulesRuntime as clearRulesRuntimeView,
  deleteRulesByIds as deleteRulesByIdsView,
} from './views/rulesActions.js';
import { parseHaEYaml, toHaEYaml, normScope, scopeToYaml, colorToSeverity } from './yamlUtils.js';

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
    } catch {
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
    return bindActionButtonsView(this);
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
    return renderRequestsView(this, requests);
  }

  createRequestItem(request) {
    return createRequestItemView(this, request);
  }

  renderDetails(request) {
    return renderDetailsView(this, request);
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
    return [];
  }

  async switchView(view) {
    return switchViewView(this, view);
  }

  async initGlobalAndSettings() {
    return initGlobalAndSettingsView(this);
  }

  renderSettings() {
    if (!this.settingsContainer) return;
    renderSettingsView(this);
  }

  renderRules() {
    return renderRulesView(this);
  }

  createRuleItem(r) {
    return createRuleItemView(this, r);
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
    return createUiSelectView(options, current, onBlur);
  }

  renderRuleForm() {
    return renderRuleFormView(this);
  }

  async onSubmitNewRule(rule) {
    return onSubmitNewRuleView(this, rule);
  }

  _genId(name, pattern) {
    return genRuleId(name, pattern);
  }

  async onImportYaml(text) {
    return onImportYamlView(this, text);
  }

  onExportYaml() {
    return onExportYamlView(this);
  }

  async onClearRules() {
    return onClearRulesView(this);
  }

  async _importYamlProcess(list, toEnableIds) {
    // Backward compatibility wrapper
    return importYamlProcessView(this, list, toEnableIds);
  }

  async _importRulesLocal(list) {
    return importRulesLocalView(this, list);
  }

  async _importRulesRuntime(list) {
    return importRulesRuntimeView(this, list);
  }

  async _syncEnabledRuntime(toEnableIds, importedIdsSet) {
    return syncEnabledRuntimeView(this, toEnableIds, importedIdsSet);
  }

  _clearRulesLocal() {
    return clearRulesLocalView(this);
  }

  async _clearRulesRuntime() {
    return clearRulesRuntimeView(this);
  }

  async _deleteRulesByIds(ids) {
    return deleteRulesByIdsView(this, ids);
  }

  _parseHaEYaml(text) {
    const result = parseHaEYaml(text);
    return Array.isArray(result) ? result : Array.isArray(result?.rules) ? result.rules : [];
  }

  _toHaEYaml(list, enabledSet) {
    return toHaEYaml(list, enabledSet);
  }

  _colorToSeverity(color) {
    return colorToSeverity(color);
  }

  _normScope(s) {
    return normScope(s);
  }

  _scopeToYaml(s) {
    return scopeToYaml(s);
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
    return assembleRuleUpdateView(this, id, patch);
  }

  _applyRuleLocal(id, next) {
    return applyRuleLocalView(this, id, next);
  }

  _removeRuleLocal(id) {
    return removeRuleLocalView(this, id);
  }

  _orderedRules() {
    return orderedRulesView(this);
  }

  initPreviewData() {
    return initPreviewDataView(this);
  }
}
if (typeof chrome !== 'undefined' && chrome.devtools?.network) startNetworkCapture(); new Panel();
