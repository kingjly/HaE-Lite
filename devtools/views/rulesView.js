// Rules view renderer extracted from Panel to reduce panel.js size
// All operations delegate back into the Panel instance passed in

export function renderRules(panel) {
  const { rulesContainer } = panel;
  rulesContainer.innerHTML = '';
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
      <span>启用</span>
      <span>名称</span>
      <span>类别</span>
      <span>严重性</span>
      <span>敏感</span>
      <span>范围</span>
      <span>正则表达式</span>
      <span>操作</span>
    `;
  panel.rulesContainer.appendChild(header);
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
