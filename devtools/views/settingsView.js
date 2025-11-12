import { escapeHtml } from '../../shared/utils.js';

// Settings view renderer extracted from Panel to reduce panel.js size
export function renderSettings(panel) {
  if (!panel?.settingsContainer) return;
  panel.settingsContainer.innerHTML = buildSettingsMarkup(panel);
  renderChips(panel, panel.filterExtensions || [], 'filter-chips');
  renderChips(panel, panel.whitelistDomains || [], 'whitelist-chips');
  renderChips(panel, panel.blacklistDomains || [], 'blacklist-chips');
  bindFilterControls(panel);
  bindWhitelistControls(panel);
  bindBlacklistControls(panel);
}

function buildSettingsMarkup(panel) {
  const extsVal = escapeHtml((panel.filterExtensions || []).join(', '));
  return `
    <div class="config-section">
      <div class="section-title">静态文件过滤（后缀）</div>
      <div class="section-row">
        <div id="filter-chips" class="chips" aria-label="已过滤后缀"></div>
      </div>
      <div class="section-row" style="display:flex;gap:8px;align-items:center;">
        <input id="filter-exts" placeholder="批量：js,.css,png" value="${extsVal}" style="min-width:320px;" />
        <button type="button" id="save-filter">保存</button>
        <button type="button" id="clear-filter">清空</button>
      </div>
      <p class="section-tip">忽略以这些后缀结尾的请求。可使用加号chip新增单个后缀，或在上方批量输入。</p>
    </div>

    <div class="config-section">
      <div class="section-title">域名白名单</div>
      <div class="section-row" style="display:flex;gap:8px;align-items:center;">
        <label><input type="checkbox" id="whitelist-enabled" ${panel.whitelistEnabled ? 'checked' : ''}/> 启用白名单</label>
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
        <label><input type="checkbox" id="blacklist-enabled" ${panel.blacklistEnabled ? 'checked' : ''}/> 启用黑名单</label>
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
}

function renderChips(panel, list, id) {
  const el = panel.settingsContainer.querySelector(`#${id}`);
  if (!el) return;
  el.innerHTML = '';
  const uniq = Array.from(new Set((list || []).filter((x) => !!x)));
  for (const val of uniq) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.setAttribute('data-val', val);
    chip.innerHTML = `${escapeHtml(val)} <button type="button" class="chip-remove" data-val="${escapeHtml(val)}" aria-label="移除">×</button>`;
    el.appendChild(chip);
  }
  const addChip = document.createElement('span');
  addChip.className = 'chip chip-add';
  addChip.innerHTML = '<span class="chip-plus">＋</span><span>新增</span>';
  el.appendChild(addChip);
}

function openChipEditor(panel, containerId, placeholder, onSubmit) {
  const container = panel.settingsContainer.querySelector(`#${containerId}`);
  if (!container) return;
  const existing = container.querySelector('.chip-editor input');
  if (existing) {
    existing.focus();
    return;
  }
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
    if (e.key === 'Enter') {
      await commit();
    } else if (e.key === 'Escape') {
      editor.remove();
    }
  });
  input.addEventListener('blur', async () => {
    await commit();
  });
}

function normExt(s) {
  let x = String(s || '')
    .trim()
    .toLowerCase();
  if (!x) return '';
  if (!x.startsWith('.')) x = `.${x}`;
  return x.replace(/[^a-z0-9\._-]/g, '');
}

function normDomain(s) {
  let x = String(s || '')
    .trim()
    .toLowerCase();
  x = x.replace(/^https?:\/\//, '');
  x = x.replace(/\/.*$/, '');
  x = x.split(':')[0];
  if (x.startsWith('.') && !x.startsWith('*.')) x = x.slice(1);
  return x.replace(/[^a-z0-9\.\-\*]/g, '');
}

function bindFilterControls(panel) {
  const inputBatch = panel.settingsContainer.querySelector('#filter-exts');
  const btnSaveFilter = panel.settingsContainer.querySelector('#save-filter');
  btnSaveFilter?.addEventListener('click', async () => {
    await saveFilterExtensions(panel, String(inputBatch?.value || '').trim());
  });
  const btnClearFilter = panel.settingsContainer.querySelector('#clear-filter');
  btnClearFilter?.addEventListener('click', async () => {
    await clearFilterExtensions(panel);
  });
  const filterChips = panel.settingsContainer.querySelector('#filter-chips');
  filterChips?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.chip-remove');
    const add = e.target.closest('.chip-add');
    if (btn) {
      const val = btn.getAttribute('data-val') || '';
      await removeFilterExt(panel, val);
    } else if (add) {
      openChipEditor(panel, 'filter-chips', '例如 js 或 .js', async (val) => {
        await addFilterExt(panel, val);
      });
    }
  });
}

async function saveFilterExtensions(panel, raw) {
  const list = String(raw || '')
    .split(',')
    .map((s) => normExt(s))
    .filter((s) => !!s);
  panel.filterExtensions = Array.from(new Set(list));
  renderChips(panel, panel.filterExtensions, 'filter-chips');
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SET_FILTER_EXTS',
        list: panel.filterExtensions,
      });
      if (!res?.ok) throw new Error(res?.error || 'save filter failed');
      alert('已保存过滤后缀');
    } catch (e) {
      console.warn('save filter failed', e);
      alert('保存失败');
    }
  }
}

async function clearFilterExtensions(panel) {
  panel.filterExtensions = [];
  renderChips(panel, [], 'filter-chips');
  const inputBatchEl = panel.settingsContainer.querySelector('#filter-exts');
  if (inputBatchEl) inputBatchEl.value = '';
  if (panel._canUseRuntime()) {
    try {
      await chrome.runtime.sendMessage({ type: 'SET_FILTER_EXTS', list: [] });
    } catch {}
  }
}

async function removeFilterExt(panel, val) {
  const list = (panel.filterExtensions || []).filter((x) => x !== val);
  panel.filterExtensions = list;
  renderChips(panel, list, 'filter-chips');
  if (panel._canUseRuntime()) {
    try {
      await chrome.runtime.sendMessage({ type: 'SET_FILTER_EXTS', list });
    } catch {}
  }
}

async function addFilterExt(panel, val) {
  const v = normExt(val);
  if (!v) return;
  const set = new Set(panel.filterExtensions || []);
  set.add(v);
  const list = Array.from(set);
  panel.filterExtensions = list;
  renderChips(panel, list, 'filter-chips');
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SET_FILTER_EXTS', list });
      if (!res?.ok) throw new Error('save failed');
    } catch (e) {
      console.warn('append ext failed', e);
    }
  }
}

function bindWhitelistControls(panel) {
  const wlEnabledEl = panel.settingsContainer.querySelector('#whitelist-enabled');
  wlEnabledEl?.addEventListener('change', async () => {
    await toggleWhitelistEnabled(panel, !!wlEnabledEl.checked);
  });
  const wlSave = panel.settingsContainer.querySelector('#save-whitelist');
  wlSave?.addEventListener('click', async () => {
    const batchEl = panel.settingsContainer.querySelector('#whitelist-batch');
    await saveWhitelistBatch(panel, String(batchEl?.value || '').trim());
  });
  const wlClear = panel.settingsContainer.querySelector('#clear-whitelist');
  wlClear?.addEventListener('click', async () => {
    await clearWhitelist(panel);
  });
  const wlChips = panel.settingsContainer.querySelector('#whitelist-chips');
  wlChips?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.chip-remove');
    const add = e.target.closest('.chip-add');
    if (btn) {
      const val = btn.getAttribute('data-val') || '';
      await removeWhitelistDomain(panel, val);
    } else if (add) {
      openChipEditor(
        panel,
        'whitelist-chips',
        '例如 *.example.com 或 api.example.com',
        async (val) => {
          await addWhitelistDomain(panel, val);
        }
      );
    }
  });
}

async function toggleWhitelistEnabled(panel, enabled) {
  panel.whitelistEnabled = !!enabled;
  if (panel._canUseRuntime()) {
    try {
      await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_ENABLED', enabled: !!enabled });
    } catch {}
  }
}

async function saveWhitelistBatch(panel, raw) {
  const list = String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => normDomain(s))
    .filter((s) => !!s);
  panel.whitelistDomains = Array.from(new Set(list));
  renderChips(panel, panel.whitelistDomains, 'whitelist-chips');
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SET_WHITELIST_DOMAINS',
        list: panel.whitelistDomains,
      });
      if (!res?.ok) throw new Error(res?.error || 'save whitelist failed');
      alert('已保存白名单');
    } catch (e) {
      console.warn('save whitelist failed', e);
      alert('保存失败');
    }
  }
}

async function clearWhitelist(panel) {
  panel.whitelistDomains = [];
  renderChips(panel, [], 'whitelist-chips');
  const wlBatchEl = panel.settingsContainer.querySelector('#whitelist-batch');
  if (wlBatchEl) wlBatchEl.value = '';
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_DOMAINS', list: [] });
      if (!res?.ok) throw new Error('save failed');
      const r = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
      panel.whitelistDomains = Array.isArray(r?.list) ? r.list : [];
      renderChips(panel, panel.whitelistDomains, 'whitelist-chips');
    } catch {}
  }
}

async function removeWhitelistDomain(panel, val) {
  const list = (panel.whitelistDomains || []).filter((x) => x !== val);
  panel.whitelistDomains = list;
  renderChips(panel, list, 'whitelist-chips');
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_DOMAINS', list });
      if (!res?.ok) throw new Error('save failed');
      const r = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
      panel.whitelistDomains = Array.isArray(r?.list) ? r.list : list;
      renderChips(panel, panel.whitelistDomains, 'whitelist-chips');
    } catch {}
  }
}

async function addWhitelistDomain(panel, val) {
  const d = normDomain(val);
  if (!d) return;
  const set = new Set(panel.whitelistDomains || []);
  set.add(d);
  const list = Array.from(set);
  panel.whitelistDomains = list;
  renderChips(panel, list, 'whitelist-chips');
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SET_WHITELIST_DOMAINS', list });
      if (!res?.ok) throw new Error('save failed');
      const r = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST_DOMAINS' });
      panel.whitelistDomains = Array.isArray(r?.list) ? r.list : list;
      renderChips(panel, panel.whitelistDomains, 'whitelist-chips');
    } catch {}
  }
}

function bindBlacklistControls(panel) {
  const blEnabledEl = panel.settingsContainer.querySelector('#blacklist-enabled');
  blEnabledEl?.addEventListener('change', async () => {
    await toggleBlacklistEnabled(panel, !!blEnabledEl.checked);
  });
  const blSave = panel.settingsContainer.querySelector('#save-blacklist');
  blSave?.addEventListener('click', async () => {
    const batchEl = panel.settingsContainer.querySelector('#blacklist-batch');
    await saveBlacklistBatch(panel, String(batchEl?.value || '').trim());
  });
  const blChips = panel.settingsContainer.querySelector('#blacklist-chips');
  blChips?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.chip-remove');
    const add = e.target.closest('.chip-add');
    if (btn) {
      const val = btn.getAttribute('data-val') || '';
      await removeBlacklistDomain(panel, val);
    } else if (add) {
      openChipEditor(
        panel,
        'blacklist-chips',
        '例如 *.example.com 或 analytics.example.com',
        async (val) => {
          await addBlacklistDomain(panel, val);
        }
      );
    }
  });
  const blClear = panel.settingsContainer.querySelector('#clear-blacklist');
  blClear?.addEventListener('click', async () => {
    await clearBlacklist(panel);
  });
}

async function toggleBlacklistEnabled(panel, enabled) {
  panel.blacklistEnabled = !!enabled;
  if (panel._canUseRuntime()) {
    try {
      await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_ENABLED', enabled: !!enabled });
    } catch {}
  }
}

async function saveBlacklistBatch(panel, raw) {
  const list = String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => normDomain(s))
    .filter((s) => !!s);
  panel.blacklistDomains = Array.from(new Set(list));
  renderChips(panel, panel.blacklistDomains, 'blacklist-chips');
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SET_BLACKLIST_DOMAINS',
        list: panel.blacklistDomains,
      });
      if (!res?.ok) throw new Error(res?.error || 'save blacklist failed');
      alert('已保存黑名单');
    } catch (e) {
      console.warn('save blacklist failed', e);
      alert('保存失败');
    }
  }
}

async function clearBlacklist(panel) {
  panel.blacklistDomains = [];
  renderChips(panel, [], 'blacklist-chips');
  const blBatchEl = panel.settingsContainer.querySelector('#blacklist-batch');
  if (blBatchEl) blBatchEl.value = '';
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_DOMAINS', list: [] });
      if (!res?.ok) throw new Error('save failed');
      const r = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
      panel.blacklistDomains = Array.isArray(r?.list) ? r.list : [];
      renderChips(panel, panel.blacklistDomains, 'blacklist-chips');
    } catch {}
  }
}

async function removeBlacklistDomain(panel, val) {
  const list = (panel.blacklistDomains || []).filter((x) => x !== val);
  panel.blacklistDomains = list;
  renderChips(panel, list, 'blacklist-chips');
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_DOMAINS', list });
      if (!res?.ok) throw new Error('save failed');
      const r = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
      panel.blacklistDomains = Array.isArray(r?.list) ? r.list : list;
      renderChips(panel, panel.blacklistDomains, 'blacklist-chips');
    } catch {}
  }
}

async function addBlacklistDomain(panel, val) {
  const d = normDomain(val);
  if (!d) return;
  const set = new Set(panel.blacklistDomains || []);
  set.add(d);
  const list = Array.from(set);
  panel.blacklistDomains = list;
  renderChips(panel, list, 'blacklist-chips');
  if (panel._canUseRuntime()) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SET_BLACKLIST_DOMAINS', list });
      if (!res?.ok) throw new Error('save failed');
      const r = await chrome.runtime.sendMessage({ type: 'GET_BLACKLIST_DOMAINS' });
      panel.blacklistDomains = Array.isArray(r?.list) ? r.list : list;
      renderChips(panel, panel.blacklistDomains, 'blacklist-chips');
    } catch (e) {
      console.warn('append blacklist failed', e);
    }
  }
}
