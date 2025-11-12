// Unified UI controls: view switching and export/clear actions

export async function switchView(panel, view) {
  panel.view = ['rules', 'settings'].includes(view) ? view : 'results';
  updateButtons(panel);
  const showResults = panel.view === 'results';
  const showRules = panel.view === 'rules';
  const showSettings = panel.view === 'settings';
  toggleContainers(panel, showResults, showRules, showSettings);
  await handleRules(panel, showRules);
  await handleSettings(panel, showSettings);
}

function updateButtons(panel) {
  const buttons = panel.subtabs?.querySelectorAll('button') || [];
  buttons.forEach((b) => {
    const active = b.getAttribute('data-view') === panel.view;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function toggleContainers(panel, showResults, showRules, showSettings) {
  if (panel.rulesContainer) panel.rulesContainer.hidden = !showRules;
  if (panel.settingsContainer) panel.settingsContainer.hidden = !showSettings;
  if (panel.listContainer) panel.listContainer.hidden = !showResults;
  if (panel.detailContainer) panel.detailContainer.hidden = !showResults;
  if (panel.splitterEl) panel.splitterEl.hidden = !showResults;
  if (panel.mainEl) panel.mainEl.classList.toggle('analysis', showResults);
  if (panel.resultsContainer) panel.resultsContainer.hidden = !showResults;
  if (panel.resultsToolbar) panel.resultsToolbar.hidden = !showResults;
}

async function handleRules(panel, showRules) {
  if (!showRules) return;
  if (!panel.isPreview) panel.loadRules();
  panel.renderRules();
}

async function handleSettings(panel, showSettings) {
  if (!showSettings) return;
  if (!panel.isPreview && panel._canUseRuntime()) {
    await panel.initGlobalAndSettings();
  } else {
    panel.renderSettings();
  }
}

export function bindActionButtons(panel) {
  if (panel.exportBtn) {
    panel.exportBtn.addEventListener('click', () => handleExport(panel));
  }
  if (panel.clearBtn) {
    panel.clearBtn.addEventListener('click', () => handleClear(panel));
  }
}

function handleExport(panel) {
  if (panel.isPreview) return exportPreview(panel);
  return exportHistory(panel);
}

function exportPreview(panel) {
  const blob = new Blob([JSON.stringify(panel.requests || [], null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, `hae-export-preview-${Date.now()}.json`);
}

async function exportHistory(panel) {
  const ids = panel.getSelectedIds?.() || [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA', ids });
    if (!res?.ok) throw new Error(res?.error || 'unknown');
    const blob = new Blob([res.data], { type: 'application/json' });
    downloadBlob(blob, `hae-export-${Date.now()}.json`);
  } catch (err) {
    console.error('Export failed', err);
    alert('导出失败，请重试');
  }
}

function handleClear(panel) {
  if (panel.isPreview) return clearPreview(panel);
  return clearHistory(panel);
}

function clearPreview(panel) {
  panel.requests = [];
  if (panel.listContainer) panel.listContainer.innerHTML = '';
  if (panel.detailContainer) panel.detailContainer.innerHTML = '';
}

async function clearHistory(panel) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    if (!res?.ok) throw new Error(res?.error || 'clear failed');
    panel.requests = [];
    if (panel.listContainer) panel.listContainer.innerHTML = '';
    if (panel.detailContainer) panel.detailContainer.innerHTML = '';
  } catch (err) {
    console.error('Clear failed', err);
    alert('清空失败，请重试');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
