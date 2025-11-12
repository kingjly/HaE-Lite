export function formatTime(ts) {
  try {
    const d = new Date(ts || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}:${pad(d.getSeconds())}`;
  } catch {
    return '';
  }
}

export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

export function severityColor(request) {
  const matches = request.matches || [];
  const sev = matches.reduce((acc, m) => Math.max(acc, sevScore(m.severity)), 0);
  return sev >= 3 ? 'bad' : sev >= 2 ? 'warn' : 'good';
}

function sevScore(s) {
  if (s === 'high') return 3;
  if (s === 'medium') return 2;
  return 1;
}

function _hashPattern(p) {
  const s = String(p || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).slice(0, 5);
}

export function genRuleId(name, pattern) {
  const baseName = String(name || 'rule')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  const ph = _hashPattern(pattern);
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `r-${baseName}-${ph}-${ts}-${rand}`;
}

// 默认的静态资源后缀过滤列表（初始值，可在设置中修改）
export const DEFAULT_FILTER_EXTS = [
  '.7z',
  '.apk',
  '.avi',
  '.bak',
  '.bat',
  '.bin',
  '.bmp',
  '.bz2',
  '.css',
  '.dll',
  '.doc',
  '.docx',
  '.eot',
  '.exe',
  '.flv',
  '.gif',
  '.gz',
  '.ico',
  '.iso',
  '.jar',
  '.jpg',
  '.jpeg',
  '.log',
  '.map',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.msi',
  '.ogg',
  '.old',
  '.otf',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.rar',
  '.rtf',
  '.save',
  '.sh',
  '.svg',
  '.swp',
  '.tar',
  '.tmp',
  '.ttf',
  '.txt',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.wmv',
  '.xls',
  '.xlsx',
  '.xz',
  '.zip',
  '.backup',
];
