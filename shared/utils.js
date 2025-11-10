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
