import { formatTime, escapeHtml, truncate, severityColor } from '../../shared/utils.js';
// Inline lightweight pretty printers (merged from formatters2.js)
function tryPretty(text, contentType = '') {
  const s = String(text || '').trim();
  const ct = String(contentType || '').toLowerCase();
  const json = prettyJSON(s);
  if (json !== null) return json;
  if (/^<.+>$/s.test(s)) return prettyMarkup(s);
  if (ct.includes('javascript')) return prettyJS(s);
  return s;
}

function prettyJSON(s) {
  try {
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      const obj = JSON.parse(s);
      return JSON.stringify(obj, null, 2);
    }
  } catch {}
  return null;
}

function prettyMarkup(s) {
  const lines = s.replace(/>\s+</g, '>\n<').split('\n');
  let indent = 0;
  return lines
    .map((line) => {
      const open = (String(line).match(/<(?!\/|!)[^>]*>/g) || []).length;
      const close = (String(line).match(/<\/[^>]+>/g) || []).length;
      indent = Math.max(0, indent + open - close);
      return '  '.repeat(Math.max(0, indent - (close > open ? 1 : 0))) + line;
    })
    .join('\n');
}

function prettyJS(code) {
  let out = '';
  let indent = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') {
      out += '{\n';
      indent++;
      out += '  '.repeat(indent);
    } else if (c === '}') {
      indent = Math.max(0, indent - 1);
      out += '\n' + '  '.repeat(indent) + '}';
    } else if (c === ';' || c === ',') {
      out += c + '\n' + '  '.repeat(indent);
    } else {
      out += c;
    }
  }
  return out;
}

export function renderRequests(panel, requests) {
  panel.listContainer.innerHTML = '';
  const finalList = filterSortRequests(panel, requests);
  finalList.forEach((req) => {
    const item = createRequestItem(panel, req);
    panel.listContainer.appendChild(item);
  });
}

function filterSortRequests(panel, requests) {
  const wlEnabled = !!panel.whitelistEnabled;
  const blEnabled = !!panel.blacklistEnabled;
  const whitelist = Array.isArray(panel.whitelistDomains) ? panel.whitelistDomains : [];
  const blacklist = Array.isArray(panel.blacklistDomains) ? panel.blacklistDomains : [];
  const prefiltered = (requests || []).filter((r) => {
    const rawUrl = String(r.url || '').toLowerCase();
    const scheme = rawUrl.split(':')[0];
    if (rawUrl.startsWith('chrome-extension://') || scheme === 'data') return false;
    const host = parseHost(rawUrl);
    if (wlEnabled && whitelist.length > 0) return whitelist.some((p) => domainMatch(host, p));
    if (blEnabled && blacklist.length > 0) return !blacklist.some((p) => domainMatch(host, p));
    return true;
  });
  const sevScore = (s) => (s === 'high' ? 3 : s === 'medium' ? 2 : 1);
  const maxSev = (r) =>
    (r.matches || []).reduce((acc, m) => Math.max(acc, sevScore(m.severity)), 0);
  const isSensitive = (r) => (r.matches || []).some((m) => m.sensitive === true);
  const sorted = prefiltered.sort((a, b) => {
    const sa = isSensitive(a) ? 1 : 0;
    const sb = isSensitive(b) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const ma = maxSev(a);
    const mb = maxSev(b);
    if (ma !== mb) return mb - ma;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  const filtered = panel.onlyMatched ? sorted.filter((r) => (r.matches || []).length > 0) : sorted;
  return filtered;
}

function parseHost(url) {
  const u = String(url || '');
  if (!u) return '';
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return u
      .replace(/^https?:\/\/|^wss?:\/\/|^ftp:\/\//, '')
      .replace(/\/.*$/, '')
      .split(':')[0]
      .toLowerCase();
  }
}

function domainMatch(host, raw) {
  const pat = cleanPattern(raw);
  if (!pat) return false;
  return pat.includes('*') ? wildcardMatch(host, pat) : exactOrSubdomain(host, pat);
}

function cleanPattern(raw) {
  let pat = String(raw || '')
    .trim()
    .toLowerCase();
  pat = pat.replace(/^https?:\/\/|^wss?:\/\/|^ftp:\/\//, '');
  pat = pat.replace(/\/.*$/, '');
  pat = pat.split(':')[0];
  if (pat.startsWith('.')) pat = pat.slice(1);
  return pat;
}

function wildcardMatch(host, pat) {
  const esc = pat.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
  try {
    const re = new RegExp(`^${esc}$`);
    if (re.test(host)) return true;
    if (pat.startsWith('*.')) {
      const root = pat.slice(2);
      if (root && host === root) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function exactOrSubdomain(host, pat) {
  return host === pat || host.endsWith(`.${pat}`);
}

export function createRequestItem(panel, request) {
  const div = document.createElement('div');
  div.className = 'request-item';
  if (isSensitiveReq(request)) div.classList.add('sensitive');
  const sev = severityColor(request);
  const nameSummary = getNameSummary(getRuleNames(request));
  const resCT = getResCT(request);
  const resLen = computeResLen(request);
  div.innerHTML = `
      <div class="request-header">
        <span class="method ${escapeHtml(request.method || '')}">${escapeHtml(request.method || '')}</span>
        <span class="url">${escapeHtml(truncate(request.url || '', 80))}</span>
        <div class="metrics">
          <span class="length-badge" title="响应长度 (bytes)">${resLen}</span>
          <span class="badge ${sev}">${(request.matches || []).length}</span>
        </div>
      </div>
      <div class="request-meta">
        <span class="time">${formatTime(request.timestamp || Date.now())}</span>
        ${resCT ? `<span class="ctype">${escapeHtml(resCT)}</span>` : ''}
        ${nameSummary ? `<span class="rule-names">命中规则：${escapeHtml(nameSummary)}</span>` : ''}
      </div>
    `;
  div.addEventListener('click', () => renderDetails(panel, request));
  return div;
}

function isSensitiveReq(request) {
  return (request.matches || []).some((m) => m.sensitive === true);
}

function getRuleNames(request) {
  return Array.from(new Set((request.matches || []).map((m) => m.ruleName).filter(Boolean)));
}

function getNameSummary(names) {
  return names.length ? truncate(names.join(', '), 80) : '';
}

function getResCT(request) {
  return (
    headerLookup(request.resHeaders, 'content-type') ||
    headerLookup(request.headers, 'content-type')
  );
}

function computeResLen(request) {
  const headerLookupLocal = (headers, name) => headerLookup(headers, name);
  const resCLRaw =
    headerLookupLocal(request.resHeaders, 'content-length') ||
    headerLookupLocal(request.headers, 'content-length');
  let resLen = parseInt(resCLRaw, 10);
  if (!Number.isFinite(resLen) || resLen < 0) {
    try {
      resLen = new TextEncoder().encode(String(request.resBody || '')).length;
    } catch {
      resLen = String(request.resBody || '').length;
    }
  }
  return resLen;
}

function headerLookup(headers, name) {
  const h = headers || {};
  const found = Object.entries(h).find(
    ([k]) => String(k || '').toLowerCase() === String(name || '').toLowerCase()
  );
  return found ? found[1] : '';
}

export function renderDetails(panel, request) {
  const matches = request.matches || [];
  panel.detailContainer.innerHTML = `
      <div class="detail-header">
        <h3>${escapeHtml((request.method || '') + ' ' + (request.url || ''))}</h3>
        <span class="status">${escapeHtml(String(request.statusCode || ''))}</span>
      </div>
      <div class="detail-tabs">
        <button data-tab="matches" class="active">匹配结果 (${matches.length})</button>
        <button data-tab="req">请求包</button>
        <button data-tab="res">响应包</button>
      </div>
      <div class="detail-content">${panel.renderMatches(matches)}</div>
    `;
  bindDetailTabs(panel, request);
}

function bindDetailTabs(panel, request) {
  const tabs = panel.detailContainer.querySelectorAll('.detail-tabs button');
  const contentEl = panel.detailContainer.querySelector('.detail-content');
  const rawReq = makeRawReq(request);
  const rawRes = makeRawRes(request);
  const prettyReq = buildPrettyReq(request);
  const prettyRes = buildPrettyRes(request);
  tabs.forEach((btn) =>
    btn.addEventListener('click', () =>
      onTabClick({ btn, tabs, contentEl, panel, request, rawReq, prettyReq, rawRes, prettyRes })
    )
  );
}

function onTabClick(ctx) {
  const { btn, tabs, contentEl, panel, request, rawReq, prettyReq, rawRes, prettyRes } = ctx;
  tabs.forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.getAttribute('data-tab');
  if (tab === 'matches') return renderMatchesTab(contentEl, panel, request);
  if (tab === 'req') return renderReqTab(contentEl, rawReq, prettyReq);
  return renderResTab(contentEl, rawRes, prettyRes);
}

function renderMatchesTab(contentEl, panel, request) {
  contentEl.innerHTML = panel.renderMatches(request.matches || []);
}

function renderReqTab(contentEl, rawReq, prettyReq) {
  contentEl.innerHTML = buildPacket('请求包', 'req', rawReq);
  bindPacketToggle(contentEl, 'req', rawReq, prettyReq);
}

function renderResTab(contentEl, rawRes, prettyRes) {
  contentEl.innerHTML = buildPacket('响应包', 'res', rawRes);
  bindPacketToggle(contentEl, 'res', rawRes, prettyRes);
}

function buildPrettyReq(request) {
  const reqCT = headerLookup(request.reqHeaders, 'content-type') || '';
  const prettyReqBody =
    tryPretty(String(request.reqBody || ''), reqCT) || String(request.reqBody || '');
  return `${String(request.method || 'GET')} ${String(request.url || '')}\n${headersToLines(request.reqHeaders)}\n\n${prettyReqBody}`;
}

function buildPrettyRes(request) {
  const resCT = headerLookup(request.resHeaders, 'content-type') || '';
  const prettyResBody =
    tryPretty(String(request.resBody || ''), resCT) || String(request.resBody || '');
  return `HTTP/1.1 ${String(request.statusCode || '')} ${String(request.statusText || '')}\n${headersToLines(request.resHeaders)}\n\n${prettyResBody}`;
}

function headersToLines(headers) {
  const h = headers || {};
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function buildPacket(title, kind, raw) {
  return `
    <div class="packet">
      <div class="packet-controls">
        <div class="packet-title">${escapeHtml(title)}</div>
        <div class="packet-toggle">
          <label><input type="radio" name="${kind}-packet-mode" value="raw" checked /> Raw</label>
          <label><input type="radio" name="${kind}-packet-mode" value="pretty" /> Pretty</label>
        </div>
      </div>
      <div class="packet-frame"><pre class="packet-pre" data-kind="${kind}">${escapeHtml(raw)}</pre></div>
    </div>`;
}

function bindPacketToggle(contentEl, kind, raw, pretty) {
  const radios = contentEl.querySelectorAll(`input[name="${kind}-packet-mode"]`);
  const pre = contentEl.querySelector(`pre.packet-pre[data-kind="${kind}"]`);
  radios.forEach((r) =>
    r.addEventListener('change', () => {
      const val =
        contentEl.querySelector(`input[name="${kind}-packet-mode"]:checked`)?.value || 'raw';
      pre.textContent = val === 'pretty' ? pretty || raw : raw;
    })
  );
}

function makeRawReq(request) {
  const method = String(request.method || 'GET');
  const url = String(request.url || '');
  return `${method} ${url}\n${headersToLines(request.reqHeaders)}\n\n${String(request.reqBody || '')}`;
}

function makeRawRes(request) {
  const status = String(request.statusCode || '');
  const statusText = String(request.statusText || '');
  return `HTTP/1.1 ${status} ${statusText}\n${headersToLines(request.resHeaders)}\n\n${String(request.resBody || '')}`;
}
