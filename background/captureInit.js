import { Storage } from '../shared/storage.js';
import { processRequest } from './requestProcessor.js';

const attachedTabs = new Set();
const sessions = new Map(); // tabId -> Map(requestId -> partial)
let globalEnabledCache = true;
let listenersRegistered = false;

export function setGlobalEnabledCache(val) {
  globalEnabledCache = !!val;
}

function isHttpUrl(u) {
  const s = String(u || '').toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
}

function isTextContentType(ct) {
  const s = String(ct || '').toLowerCase();
  return (
    s.startsWith('text/') ||
    s.includes('application/json') ||
    s.includes('application/javascript') ||
    s.includes('application/xml') ||
    s.includes('application/x-www-form-urlencoded')
  );
}

function decodeBody(body, base64, resHeaders) {
  if (!base64) return String(body || '');
  const ct = resHeaders?.['content-type'] || resHeaders?.['Content-Type'] || '';
  if (!isTextContentType(ct)) return '';
  try {
    return atob(String(body || ''));
  } catch {
    return '';
  }
}

function getSession(tabId) {
  if (!sessions.has(tabId)) sessions.set(tabId, new Map());
  return sessions.get(tabId);
}

export function attachToTab(tabId) {
  if (!globalEnabledCache) return;
  if (attachedTabs.has(tabId)) return;
  try {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      try {
        chrome.debugger.sendCommand({ tabId }, 'Network.enable');
        attachedTabs.add(tabId);
      } catch {}
    });
  } catch {}
}

export function detachFromTab(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try {
    chrome.debugger.detach({ tabId });
  } catch {}
  attachedTabs.delete(tabId);
  sessions.delete(tabId);
}

export function detachAllTabs() {
  for (const tabId of Array.from(attachedTabs)) detachFromTab(tabId);
}

function onUpdated(tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && isHttpUrl(tab?.url)) attachToTab(tabId);
}

function onActivated({ tabId }) {
  try {
    chrome.tabs.get(tabId, (tab) => {
      if (isHttpUrl(tab?.url)) attachToTab(tabId);
    });
  } catch {}
}

function onDetach(target) {
  detachFromTab(target.tabId);
}

function handleRequestWillBeSent(sess, id, params) {
  const req = params.request || {};
  const hdr = req.headers || {};
  sess.set(id, {
    url: req.url || '',
    method: req.method || 'GET',
    reqHeaders: hdr,
    reqBody: String(req.postData || ''),
  });
}

function handleResponseReceived(sess, id, params) {
  const rec = sess.get(id) || {};
  const resp = params.response || {};
  rec.statusCode = resp.status || 0;
  rec.statusText = String(resp.statusText || '');
  rec.resHeaders = resp.headers || {};
  sess.set(id, rec);
}

function toRequestData(rec, resBody) {
  const reqHeaders = rec.reqHeaders || {};
  const resHeaders = rec.resHeaders || {};
  const headers = { ...reqHeaders, ...resHeaders };
  return {
    url: rec.url || '',
    method: rec.method || 'GET',
    statusCode: rec.statusCode || 0,
    statusText: String(rec.statusText || ''),
    headers,
    body: resBody,
    reqHeaders,
    resHeaders,
    reqBody: rec.reqBody || '',
    resBody,
    timestamp: Date.now(),
  };
}

function getResponseBody(source, requestId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId }, (bodyObj) =>
        resolve(bodyObj || { body: '', base64Encoded: false })
      );
    } catch (e) {
      reject(e);
    }
  });
}

async function handleLoadingFinished(source, sess, id) {
  const rec = sess.get(id);
  if (!rec) return;
  try {
    const bodyObj = await getResponseBody(source, id);
    const resBody = decodeBody(bodyObj?.body || '', !!bodyObj?.base64Encoded, rec.resHeaders || {});
    const requestData = toRequestData(rec, resBody);
    await processRequest(requestData);
    sess.delete(id);
  } catch {
    sess.delete(id);
  }
}

function onDebuggerEvent(source, method, params) {
  const tabId = source?.tabId;
  if (!attachedTabs.has(tabId)) return;
  const sess = getSession(tabId);
  const id = params?.requestId;
  if (!id) return;
  if (method === 'Network.requestWillBeSent') return handleRequestWillBeSent(sess, id, params);
  if (method === 'Network.responseReceived') return handleResponseReceived(sess, id, params);
  if (method === 'Network.loadingFinished') return handleLoadingFinished(source, sess, id);
}

function registerListeners() {
  if (listenersRegistered) return;
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onRemoved.addListener((tabId) => detachFromTab(tabId));
  chrome.debugger.onDetach.addListener(onDetach);
  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  listenersRegistered = true;
}

async function ensureEnv() {
  if (!Storage.db) {
    try {
      await Storage.init();
    } catch {}
  }
  try {
    globalEnabledCache = await Storage.getValue('globalEnabled', true);
  } catch {
    globalEnabledCache = true;
  }
}

export async function initDebuggerCapture() {
  await ensureEnv();
  try {
    registerListeners();
    if (globalEnabledCache) {
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs || []) if (isHttpUrl(t.url)) attachToTab(t.id);
      });
    } else {
      for (const tabId of Array.from(attachedTabs)) detachFromTab(tabId);
    }
  } catch (e) {
    console.warn('init debugger capture failed', e);
  }
}

export function attachAllHttpTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs || []) if (isHttpUrl(t.url)) attachToTab(t.id);
  });
}
