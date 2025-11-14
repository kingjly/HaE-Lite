// Rules view renderer extracted from Panel to reduce panel.js size
// All operations delegate back into the Panel instance passed in

import { Storage } from '../../shared/storage.js';

const COL_COUNT = 8;
let _measureCanvas = null;
function _getFont() {
  try {
    return window.getComputedStyle(document.body).font || '13px system-ui';
  } catch {
    return '13px system-ui';
  }
}
function _measureText(text) {
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
  const ctx = _measureCanvas.getContext('2d');
  ctx.font = _getFont();
  return Math.ceil(ctx.measureText(String(text || '')).width);
}

export function renderRules(panel) {
  const { rulesContainer } = panel;
  rulesContainer.innerHTML = '';
  applyColWidths(panel);
  renderToolbar(panel);
  renderRuleForm(panel);
  const groups = buildGroups(panel._orderedRules());
  renderGroups(panel, groups);
}

function renderToolbar(panel) {
  const { rulesContainer } = panel;
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
    await panel.onImportYaml(text);
  });
  exportBtn.addEventListener('click', () => panel.onExportYaml());
  clearRulesBtn.addEventListener('click', () => panel.onClearRules());
  toolbar.appendChild(importBtn);
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(clearRulesBtn);
  toolbar.appendChild(fileInput);
  rulesContainer.appendChild(toolbar);
}

function buildGroups(list) {
  const groups = new Map();
  for (const r of list) {
    const cat = r.category || 'Uncategorized';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(r);
  }
  return groups;
}

function renderGroups(panel, groups) {
  const { rulesContainer, collapsedCategories } = panel;
  for (const [cat, list] of groups.entries()) {
    const group = document.createElement('div');
    group.className = 'rule-group';
    const header = document.createElement('div');
    header.className = 'rule-group-header';
    const title = document.createElement('span');
    title.className = 'rule-group-title';
    title.textContent = `${cat} (${list.length})`;
    const toggle = document.createElement('button');
    const collapsed = collapsedCategories.has(cat);
    toggle.textContent = collapsed ? '展开' : '收起';
    toggle.addEventListener('click', () => {
      if (collapsedCategories.has(cat)) collapsedCategories.delete(cat);
      else collapsedCategories.add(cat);
      panel.renderRules();
    });
    header.appendChild(title);
    header.appendChild(toggle);
    group.appendChild(header);
    if (!collapsed) {
      const frag = document.createDocumentFragment();
      list.forEach((r) => frag.appendChild(createRuleItem(panel, r)));
      group.appendChild(frag);
    }
    rulesContainer.appendChild(group);
  }
  const header = rulesContainer.querySelector('.rules-header');
  if (header) {
    for (let i = 0; i < COL_COUNT; i++) ensureColMin(panel, header, i);
  }
}

export function createRuleItem(panel, r) {
  const div = document.createElement('div');
  div.className = 'rule-item';
  const controls = buildRuleControls(panel, r);
  controls.forEach((el) => div.appendChild(el));
  div.appendChild(buildRuleActions(panel, r));
  return div;
}

function buildRuleControls(panel, r) {
  const enable = panel._makeCheckbox(panel.enabledRuleIds.has(r.id), (checked) =>
    panel.onRuleToggle(r.id, checked)
  );
  const name = panel._makeTextInput(r.name, '名称', (val) =>
    panel.onRuleInlineSave(r.id, { name: val })
  );
  const cat = panel._makeTextInput(r.category, '类别', (val) =>
    panel.onRuleInlineSave(r.id, { category: val })
  );
  const sev = panel._makeSelect(['low', 'medium', 'high'], r.severity || 'medium', (val) =>
    panel.onRuleInlineSave(r.id, { severity: val })
  );
  const sensDefault =
    r.sensitive === true || (r.sensitive === undefined && (r.severity || 'medium') === 'high');
  const sens = panel._makeCheckbox(sensDefault, (checked) =>
    panel.onRuleInlineSave(r.id, { sensitive: !!checked })
  );
  const scope = panel._makeSelect(
    [
      'any',
      'any header',
      'any body',
      'request',
      'request line',
      'request header',
      'request body',
      'response',
      'response line',
      'response header',
      'response body',
    ],
    panel._scopeToYaml(r.scope || 'any'),
    (val) => panel.onRuleInlineSave(r.id, { scope: val })
  );
  const pattern = panel._makeTextInput(r.pattern, '正则表达式', (val) =>
    panel.onRuleInlineSave(r.id, { pattern: val })
  );
  const headerEl = panel.rulesContainer.querySelector('.rules-header');
  name.addEventListener('input', () => ensureColMin(panel, headerEl, 1));
  cat.addEventListener('input', () => ensureColMin(panel, headerEl, 2));
  sev.addEventListener('change', () => ensureColMin(panel, headerEl, 3));
  scope.addEventListener('change', () => ensureColMin(panel, headerEl, 5));
  return [enable, name, cat, sev, sens, scope, pattern];
}

function buildRuleActions(panel, r) {
  const actions = document.createElement('div');
  actions.className = 'actions-cell';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn-delete';
  del.textContent = '删除';
  del.title = `ID: ${r.id}`;
  del.addEventListener('click', () => panel.onRuleDelete(r.id));
  actions.appendChild(del);
  return actions;
}

export function renderRuleForm(panel) {
  appendHeader(panel);
  const { catList, name, category, severity, sensitiveNew, scope, pattern } =
    buildFormInputs(panel);
  const actions = buildAddActions(panel, {
    name,
    category,
    severity,
    sensitiveNew,
    scope,
    pattern,
  });
  const row = buildFormRow({ name, category, severity, sensitiveNew, scope, pattern, actions });
  panel.rulesContainer.appendChild(catList);
  panel.rulesContainer.appendChild(row);
}

function appendHeader(panel) {
  const header = document.createElement('div');
  header.className = 'rules-header';
  header.innerHTML = `
      <span class="col-header" data-col="0"><span class="col-label">启用</span><span class="col-resizer" data-col="0"></span></span>
      <span class="col-header" data-col="1"><span class="col-label">名称</span><span class="col-resizer" data-col="1"></span></span>
      <span class="col-header" data-col="2"><span class="col-label">类别</span><span class="col-resizer" data-col="2"></span></span>
      <span class="col-header" data-col="3"><span class="col-label">严重性</span><span class="col-resizer" data-col="3"></span></span>
      <span class="col-header" data-col="4"><span class="col-label">敏感</span><span class="col-resizer" data-col="4"></span></span>
      <span class="col-header" data-col="5"><span class="col-label">范围</span><span class="col-resizer" data-col="5"></span></span>
      <span class="col-header" data-col="6"><span class="col-label">正则表达式</span><span class="col-resizer" data-col="6"></span></span>
      <span class="col-header" data-col="7"><span class="col-label">操作</span><span class="col-resizer" data-col="7"></span></span>
    `;
  panel.rulesContainer.appendChild(header);
  for (let i = 0; i < COL_COUNT; i++) ensureColMin(panel, header, i);
  bindColumnResize(panel, header);
}

function applyColWidths(panel) {
  Storage.getValue('rules.colWidths', []).then((arr) => {
    const vals = Array.isArray(arr) ? arr : [];
    for (let i = 0; i < COL_COUNT; i++) {
      const v = vals[i];
      if (i === 0) {
        const minEnableCol = Math.max(42, _measureText('启用') + 16);
        panel.rulesContainer.style.setProperty('--col-0', `${minEnableCol}px`);
        continue;
      }
      if (v && typeof v === 'string' && v.trim()) {
        panel.rulesContainer.style.setProperty(`--col-${i}`, v);
      } else {
        panel.rulesContainer.style.removeProperty(`--col-${i}`);
      }
    }
    for (let i = 0; i < COL_COUNT; i++) {
      ensureColMin(panel, null, i);
    }
  });
}

function bindColumnResize(panel, header) {
  const state = createResizeState();
  header.querySelectorAll('.col-resizer').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      const idx = Number(el.getAttribute('data-col')) || 0;
      handleResizeMouseDown(panel, header, state, idx, e);
    });
  });
}

function createResizeState() {
  return { dragging: null, startX: 0, startW: 0, minW: 0, threshold: 0 };
}

function handleResizeMove(panel, state, e) {
  if (state.dragging == null) return;
  const idx = state.dragging;
  const totalDx = e.clientX - state.startX;
  const base = state.startW + totalDx;
  const w = Math.max(state.minW, base);
  panel.rulesContainer.style.setProperty(`--col-${idx}`, `${w}px`);
}

async function handleResizeUp(panel, state, onMove, onUp) {
  if (state.dragging == null) return;
  state.dragging = null;
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onUp);
  try { document.body.style.cursor = ''; } catch {}
  const out = [];
  for (let i = 0; i < COL_COUNT; i++) {
    const v = panel.rulesContainer.style.getPropertyValue(`--col-${i}`);
    out.push(v ? v.trim() : '');
  }
  try {
    await Storage.setValue('rules.colWidths', out);
  } catch {}
}

function handleResizeMouseDown(panel, header, state, idx, e) {
  const onMove = (evt) => handleResizeMove(panel, state, evt);
  const onUp = () => handleResizeUp(panel, state, onMove, onUp);
  const cell = header.querySelectorAll('.col-header')[idx];
  const rect = cell.getBoundingClientRect();
  state.dragging = idx;
  state.startX = e.clientX;
  state.startW = rect.width;
  state.minW = computeMinWidth(panel, header, idx);
  if (state.startW < state.minW) {
    panel.rulesContainer.style.setProperty(`--col-${idx}`, `${state.minW}px`);
    state.startW = state.minW;
  }
  state.threshold = Math.max(0, state.minW - state.startW);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  try { document.body.style.cursor = 'col-resize'; } catch {}
  e.preventDefault();
  e.stopPropagation();
}

function computeMinWidth(panel, header, idx) {
  if (idx === 0) return Math.max(42, _measureText('启用') + 16);
  const label = header.querySelectorAll('.col-label')[idx];
  const labelW = label ? _measureText(label.textContent) : 0;
  const rows = panel.rulesContainer.querySelectorAll('.rule-item, .rule-new');
  const maxContentW = getMaxContentWidth(rows, idx);
  const base = Math.max(labelW, maxContentW);
  if (idx === 6) {
    const headerW = _measureText('正则表达式') + 16;
    return Math.max(headerW, Math.max(80, base + 24));
  }
  return Math.max(60, base + 24);
}

function getMaxContentWidth(rows, idx) {
  let max = 0;
  rows.forEach((row) => {
    const el = row.children[idx];
    if (!el) return;
    const w = measureCellWidth(el, idx);
    max = Math.max(max, w);
  });
  return max;
}

function measureCellWidth(el, idx) {
  const measureByIdx = {
    1: measureTextCell,
    2: measureTextCell,
    3: (e) => measureSelectMax(e, ['low', 'medium', 'high']) + getSelectExtra(e),
    4: () => 26,
    5: (e) => measureSelectMax(e) + getSelectExtra(e),
    7: (e) => measureButtons(e) || _measureText(e.textContent || ''),
  };
  const fn = measureByIdx[idx];
  return fn ? fn(el) : _measureText(el.textContent || '');
}

function measureTextCell(el) {
  const v = el.value || el.textContent || '';
  return _measureText(v);
}

function measureSelectMax(el, fallback) {
  const opts = el.querySelectorAll ? el.querySelectorAll('option, .sel-menu li') : [];
  let localMax = 0;
  if (opts.length) {
    opts.forEach((o) => (localMax = Math.max(localMax, _measureText(o.textContent))));
  } else if (Array.isArray(fallback)) {
    fallback.forEach((t) => (localMax = Math.max(localMax, _measureText(t))));
  }
  return localMax;
}

function getSelectExtra(el) {
  try {
    const target = el && el.tagName && el.tagName.toLowerCase() === 'select' ? el : el.querySelector('select') || el;
    const s = window.getComputedStyle(target);
    const pr = parseFloat(s.paddingRight) || 0;
    const pl = parseFloat(s.paddingLeft) || 0;
    const br = (parseFloat(s.borderLeftWidth) || 0) + (parseFloat(s.borderRightWidth) || 0);
    const arrow = 0;
    return pr + pl + br + arrow;
  } catch {
    return 32;
  }
}

function measureButtons(el) {
  const btns = el.querySelectorAll ? el.querySelectorAll('button') : [];
  let localMax = 0;
  btns.forEach((b) => (localMax = Math.max(localMax, _measureText(b.textContent))));
  return localMax;
}

function ensureColMin(panel, header, idx) {
  const h = header || panel.rulesContainer.querySelector('.rules-header');
  if (!h) return;
  const min = computeMinWidth(panel, h, idx);
  const cur = panel.rulesContainer.style.getPropertyValue(`--col-${idx}`);
  const px = parseFloat(cur);
  const v = Number.isFinite(px) && px > 0 ? px : 0;
  const next = Math.max(min, v);
  panel.rulesContainer.style.setProperty(`--col-${idx}`, `${next}px`);
}

 

function buildFormInputs(panel) {
  const rowInputs = {
    name: panel._makeTextInput('', '名称', () => {}),
    category: panel._makeTextInput('', '类别', () => {}),
    severity: panel._makeSelect(['low', 'medium', 'high'], 'medium', () => {}),
    sensitiveNew: panel._makeCheckbox(false, () => {}),
    scope: panel._makeSelect(
      [
        'any',
        'any header',
        'any body',
        'request',
        'request line',
        'request header',
        'request body',
        'response',
        'response line',
        'response header',
        'response body',
      ],
      'any',
      () => {}
    ),
    pattern: panel._makeTextInput('', '正则表达式', () => {}),
  };
  const catList = document.createElement('datalist');
  catList.id = 'category-list';
  const cats = [...new Set(panel.rules.map((r) => r.category).filter(Boolean))];
  cats.forEach((c) => {
    const o = document.createElement('option');
    o.value = c;
    catList.appendChild(o);
  });
  rowInputs.category.setAttribute('list', 'category-list');
  rowInputs.category.classList.add('datalist-input');
  return { catList, ...rowInputs };
}

function buildAddActions(panel, els) {
  const { name, category, severity, sensitiveNew, scope, pattern } = els;
  const actions = document.createElement('div');
  actions.className = 'actions-cell';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '添加';
  addBtn.className = 'btn-add';
  addBtn.addEventListener('click', () => {
    const rule = {
      id: panel._genId(name.value, pattern.value),
      name: name.value.trim(),
      category: category.value.trim() || 'Custom',
      severity: severity.value || 'medium',
      sensitive: !!sensitiveNew.checked,
      scope: panel._normScope(scope.value || 'any'),
      pattern: pattern.value.trim(),
    };
    panel.onSubmitNewRule(rule);
  });
  [name, category, severity, scope, pattern].forEach((el) => {
    el.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') addBtn.click();
    });
  });
  actions.appendChild(addBtn);
  return actions;
}

function buildFormRow(els) {
  const { name, category, severity, sensitiveNew, scope, pattern, actions } = els;
  const row = document.createElement('div');
  row.className = 'rule-new';
  const placeholder = document.createElement('span');
  placeholder.textContent = '';
  row.appendChild(placeholder);
  row.appendChild(name);
  row.appendChild(category);
  row.appendChild(severity);
  row.appendChild(sensitiveNew);
  row.appendChild(scope);
  row.appendChild(pattern);
  row.appendChild(actions);
  return row;
}
