// Rules actions extracted to reduce panel.js size and complexity

export async function onSubmitNewRule(panel, rule) {
  try {
    if (!rule.name || !rule.pattern) {
      alert('请填写名称与正则表达式');
      return;
    }
    if (!panel._canUseRuntime()) {
      panel.isPreview = true;
      panel.rules.push(rule);
      panel.lastAddedRuleId = rule.id;
      panel.renderRules();
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'ADD_RULE', rule });
    if (!res?.ok) throw new Error(res?.error || 'add failed');
    panel.lastAddedRuleId = rule.id;
    await panel.loadRules();
    panel.renderRules();
  } catch (e) {
    console.error('add rule failed', e);
    alert('新增规则失败，请检查正则表达式是否有效');
  }
}

export async function onImportYaml(panel, text) {
  try {
    const list = panel._parseHaEYaml(text);
    if (!Array.isArray(list) || list.length === 0) {
      alert('未解析到规则');
      return;
    }
    const toEnableIds = new Set(list.filter((r) => r.loaded).map((r) => r.id));
    await importYamlProcess(panel, list, toEnableIds);
    if (panel.isPreview || !panel._canUseRuntime()) {
      panel.renderRules();
    } else {
      await panel.loadRules();
      panel.renderRules();
    }
    alert(`已导入 ${list.length} 条规则`);
  } catch (e) {
    console.error('import yaml failed', e);
    alert('导入失败，请确认YAML格式');
  }
}

export function onExportYaml(panel) {
  try {
    const yaml = panel._toHaEYaml(panel.rules, panel.enabledRuleIds);
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

export async function onClearRules(panel) {
  try {
    if (panel.isPreview || !panel._canUseRuntime()) {
      clearRulesLocal(panel);
      return;
    }
    await clearRulesRuntime(panel);
    await panel.loadRules();
    panel.renderRules();
    alert('已清空所有规则（含内置），默认规则已禁用');
  } catch (e) {
    console.error('clear rules failed', e);
    alert('清空规则失败，请稍后重试');
  }
}

export async function importYamlProcess(panel, list, toEnableIds) {
  if (panel.isPreview || !panel._canUseRuntime()) {
    await importRulesLocal(panel, list);
    return;
  }
  try {
    await importRulesRuntime(panel, list);
    await syncEnabledRuntime(panel, toEnableIds, new Set(list.map((r) => r.id)));
  } catch (err) {
    if (String(err || '').includes('Extension context invalidated')) {
      panel.isPreview = true;
      await importRulesLocal(panel, list);
    } else {
      throw err;
    }
  }
}

export async function importRulesLocal(panel, list) {
  const toEnable = new Set();
  for (const r of list) {
    const exists = panel.rules.some((x) => x.name === r.name && x.category === r.category);
    const rule = exists
      ? { ...r, id: panel.rules.find((x) => x.name === r.name && x.category === r.category).id }
      : r;
    if (exists) applyRuleLocal(panel, rule.id, rule);
    else panel.rules.push(rule);
    if (r.loaded) {
      panel.enabledRuleIds.add(rule.id);
      toEnable.add(rule.id);
    }
  }
  return toEnable;
}

export async function importRulesRuntime(panel, list) {
  for (const r of list) {
    const exists = panel.rules.some((x) => x.name === r.name && x.category === r.category);
    const rule = exists
      ? { ...r, id: panel.rules.find((x) => x.name === r.name && x.category === r.category).id }
      : r;
    const res = await chrome.runtime.sendMessage({ type: 'ADD_RULE', rule });
    if (!res?.ok) console.warn('import save failed for', rule.name);
  }
}

export async function syncEnabledRuntime(panel, toEnableIds, importedIdsSet) {
  const resEnabled = await chrome.runtime.sendMessage({ type: 'GET_ENABLED_RULES' });
  const current = new Set(Array.isArray(resEnabled?.enabled) ? resEnabled.enabled : []);
  importedIdsSet.forEach((id) => current.delete(id));
  for (const id of toEnableIds) current.add(id);
  await chrome.runtime.sendMessage({ type: 'UPDATE_RULES', enabledRules: Array.from(current) });
}

export function clearRulesLocal(panel) {
  panel.rules = [];
  panel.enabledRuleIds = new Set();
  panel.renderRules();
}

export async function clearRulesRuntime(panel) {
  try {
    await chrome.runtime.sendMessage({ type: 'SET_DEFAULTS_ENABLED', enabled: false });
  } catch {}
  const resRules = await chrome.runtime.sendMessage({ type: 'GET_RULES' });
  const all = Array.isArray(resRules?.rules) ? resRules.rules : [];
  const idsToDelete = all.filter((r) => r?.id).map((r) => r.id);
  await deleteRulesByIds(panel, idsToDelete);
  try {
    const resEnabled = await chrome.runtime.sendMessage({ type: 'GET_ENABLED_RULES' });
    const current = new Set(Array.isArray(resEnabled?.enabled) ? resEnabled.enabled : []);
    idsToDelete.forEach((id) => current.delete(id));
    await chrome.runtime.sendMessage({ type: 'UPDATE_RULES', enabledRules: Array.from(current) });
  } catch {}
}

export async function deleteRulesByIds(panel, ids) {
  for (const id of ids) {
    try {
      await chrome.runtime.sendMessage({ type: 'DELETE_RULE', id });
    } catch {}
  }
}

export function assembleRuleUpdate(panel, id, patch) {
  const cur = panel.rules.find((x) => x.id === id) || {};
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
  if (patch.sensitive !== undefined) next.sensitive = !!patch.sensitive;
  else if (cur.sensitive !== undefined) next.sensitive = !!cur.sensitive;
  return next;
}

export function applyRuleLocal(panel, id, next) {
  const idx = panel.rules.findIndex((x) => x.id === id);
  if (idx >= 0) panel.rules[idx] = next;
}

export function removeRuleLocal(panel, id) {
  const idx = panel.rules.findIndex((x) => x.id === id);
  if (idx >= 0) panel.rules.splice(idx, 1);
  panel.enabledRuleIds.delete(id);
}

export function orderedRules(panel) {
  if (!panel.lastAddedRuleId) return panel.rules.slice();
  const list = panel.rules.slice();
  const idx = list.findIndex((r) => r.id === panel.lastAddedRuleId);
  if (idx > 0) {
    const [r] = list.splice(idx, 1);
    list.unshift(r);
  }
  return list;
}
