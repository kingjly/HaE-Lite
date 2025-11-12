function headersToObject(arr) {
  try {
    return Object.fromEntries((arr || []).map((h) => [h.name, h.value]));
  } catch {
    const out = {};
    for (const h of arr || []) out[h.name] = h.value;
    return out;
  }
}

function extractReqBody(req) {
  try {
    if (typeof req.postData === 'string') return req.postData;
    if (req.postData && typeof req.postData.text === 'string') return req.postData.text;
  } catch {}
  return '';
}

function buildStatusText(res) {
  return String(res.statusText || '');
}

export function toRequestData(request, body) {
  const req = request.request || {};
  const res = request.response || {};
  const headersReq = headersToObject(req.headers || []);
  const headersRes = headersToObject(res.headers || []);
  const reqBody = extractReqBody(req);
  const resBody = body || '';
  const statusText = buildStatusText(res);
  return {
    url: req.url || '',
    method: req.method || 'GET',
    statusCode: res.status || 0,
    statusText,
    headers: { ...headersReq, ...headersRes },
    body: resBody,
    reqHeaders: headersReq,
    resHeaders: headersRes,
    reqBody,
    resBody,
    timestamp: Date.now(),
  };
}

export function startNetworkCapture() {
  if (typeof chrome === 'undefined' || !chrome.devtools?.network) return;
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    try {
      request.getContent((body) => {
        const url = request.request?.url || '';
        if (url.startsWith('chrome://')) return;
        const requestData = toRequestData(request, body);
        try {
          if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({ type: 'CAPTURE_REQUEST', requestData });
          }
        } catch {}
      });
    } catch (e) {
      console.warn('capture failed', e);
    }
  });
}
