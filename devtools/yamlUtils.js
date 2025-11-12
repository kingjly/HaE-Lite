import { genRuleId } from '../shared/utils.js';

const SCOPE_SYNONYM_MAP = {
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

const SCOPE_TO_YAML = {
  any_headers: 'any header',
  any_body: 'any body',
  request_all: 'request',
  response_all: 'response',
  request_line: 'request line',
  response_line: 'response line',
  request_headers: 'request header',
  response_headers: 'response header',
  request_body: 'request body',
  response_body: 'response body',
  any: 'any',
};

export function colorToSeverity(color) {
  const c = String(color || '').toLowerCase();
  if (c === 'red' || c === 'orange') return 'high';
  if (c === 'yellow' || c === 'green') return 'medium';
  return 'low';
}

export function normScope(s) {
  const raw = String(s || '')
    .trim()
    .toLowerCase();
  if (!raw) return 'any';
  for (const [key, set] of Object.entries(SCOPE_SYNONYM_MAP)) {
    if (set.has(raw)) return key;
  }
  return 'any';
}

export function scopeToYaml(s) {
  const v = normScope(s);
  return SCOPE_TO_YAML[v] || 'any';
}

export function parseHaEYaml(text) {
  const rules = [];
  const state = { currentGroup: '', cur: null, lastKey: '' };
  const lines = String(text || '').split(/\r?\n/);

  for (const raw of lines) {
    const line = sanitize(raw);
    if (isSkippable(line)) continue;
    applyLine(line, state, rules);
  }
  pushCurrent(state, rules);
  return rules;
}

export function toHaEYaml(list, enabledSet) {
  const groups = groupByCategory(list || []);
  const out = ['rules:'];
  for (const [group, rules] of groups.entries()) {
    out.push(`- group: ${group}`);
    out.push('  rule:');
    for (const r of rules) {
      const lines = buildRuleYamlLines(r, enabledSet);
      for (const ln of lines) out.push(ln);
    }
  }
  return out.join('\n');
}

function sanitize(raw) {
  return String(raw || '').trim();
}

function isSkippable(line) {
  return (
    !line || line.startsWith('#') || line === 'rules:' || line === '- rules:' || line === 'rule:'
  );
}

function matchGroup(line) {
  const m = line.match(/^\-\s*group:\s*(.+)$/);
  return m ? m[1].trim() : null;
}

function matchNewRule(line) {
  const m = line.match(/^\-\s*name:\s*(.+)$/);
  return m ? m[1].trim() : null;
}

function matchKV(line) {
  const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
  if (!m) return null;
  const k = m[1];
  const v = dequote(m[2]);
  return [k, v];
}

function dequote(v) {
  return String(v || '')
    .replace(/^'(.*)'$/, '$1')
    .replace(/^"(.*)"$/, '$1')
    .trim();
}

function pushCurrent(state, rules) {
  const cur = state.cur;
  if (!cur) return;
  const name = trimStr(cur.name);
  const f = trimStr(cur.f_regex);
  if (!name || !f) {
    state.cur = null;
    state.lastKey = '';
    return;
  }
  const id = genRuleId(name, f);
  const severity = colorToSeverity(cur.color);
  const loaded = toBoolFlag(cur.loaded);
  const scope = normScope(cur.scope || 'any');
  const sensitive = toBoolFlag(cur.sensitive);
  const engine = toStringDefault(cur.engine, 'nfa');
  const s_regex = toStringDefault(cur.s_regex, '');
  const format = toStringDefault(cur.format, '{0}');
  const category = getCategoryValue(state.currentGroup, cur.group);
  rules.push({
    id,
    name,
    category,
    severity,
    pattern: f,
    loaded,
    scope,
    sensitive,
    engine,
    s_regex,
    format,
  });
  state.cur = null;
  state.lastKey = '';
}

function applyLine(line, state, rules) {
  const group = matchGroup(line);
  if (group) {
    pushCurrent(state, rules);
    state.currentGroup = group;
    return;
  }
  const newName = matchNewRule(line);
  if (newName) {
    pushCurrent(state, rules);
    state.cur = { name: newName, group: state.currentGroup };
    return;
  }
  if (!state.cur) return;
  const kv = matchKV(line);
  if (kv) {
    const [k, v] = kv;
    state.cur[k] = (state.cur[k] ? state.cur[k] + ' ' : '') + v;
    state.lastKey = k;
    return;
  }
  if (state.lastKey) state.cur[state.lastKey] = (state.cur[state.lastKey] || '') + ' ' + line;
}

function groupByCategory(list) {
  const groups = new Map();
  for (const r of list) {
    const g = r.category || 'Custom';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  return groups;
}

function severityToColor(s) {
  return s === 'high' ? 'red' : s === 'medium' ? 'yellow' : 'green';
}

function buildRuleYamlLines(r, enabledSet) {
  const loaded = enabledSet.has(r.id) ? 'true' : 'false';
  const lines = [];
  lines.push(`  - name: ${r.name}`);
  lines.push(`    loaded: ${loaded}`);
  lines.push(
    `    f_regex: ${needsQuote(r.pattern) ? "'" + escapeSingleQuotes(r.pattern) + "'" : r.pattern}`
  );
  lines.push(`    s_regex: ${quoteYaml(r.s_regex)}`);
  lines.push(`    format: ${quoteYaml(r.format || '{0}')}`);
  lines.push(`    color: ${severityToColor(r.severity || 'medium')}`);
  lines.push(`    scope: ${scopeToYaml(r.scope || 'any')}`);
  lines.push(`    engine: ${r.engine || 'nfa'}`);
  lines.push(`    sensitive: ${isSensitiveRule(r) ? 'true' : 'false'}`);
  return lines;
}

function escapeSingleQuotes(str) {
  return String(str || '').replace(/'/g, "''");
}

function needsQuote(str) {
  const s = String(str || '');
  return s.includes(':') || s.includes(' ');
}

function quoteYaml(val) {
  if (!val) return "''";
  return `'${escapeSingleQuotes(val)}'`;
}

function trimStr(val) {
  return String(val || '').trim();
}

function toStringDefault(val, def) {
  const s = String(val || '').trim();
  return s ? s : def;
}

function toBoolFlag(val) {
  return String(val || '').toLowerCase() === 'true';
}

function getCategoryValue(group, ruleGroup) {
  if (group && group.trim()) return group.trim();
  const rg = String(ruleGroup || '').trim();
  return rg || 'Custom';
}

function isSensitiveRule(r) {
  if (r.sensitive === true) return true;
  return r.sensitive === undefined && r.severity === 'high';
}
