// ReqPlus Proxy Engine – Service Worker (Manifest V3)
// Intercepts all HTTP/HTTPS requests, stores them, relays to panel

import { SessionStore } from '../storage/session_store.js';

// ─── State ────────────────────────────────────────────────────────────────────
let interceptEnabled = false;
let interceptQueue = new Map(); // requestId → { resolve, reject, request }
let panelPorts = new Map();     // tabId → port (DevTools panel connection)
let captureEnabled = true;
const pendingResponses = new Map(); // requestId → response timing start

// ─── DevTools Panel Connection ────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'reqplus-panel') {
    const tabId = port.sender?.tab?.id ?? -1;

    // A DevTools panel always sends its target tabId as first message
    port.onMessage.addListener((msg) => {
      if (msg.type === 'PANEL_INIT') {
        panelPorts.set(msg.tabId, port);
        port._tabId = msg.tabId;
        port.postMessage({ type: 'READY' });
      } else {
        handlePanelMessage(msg, port);
      }
    });

    port.onDisconnect.addListener(() => {
      if (port._tabId !== undefined) {
        panelPorts.delete(port._tabId);
      }
    });
  }
});

// ─── Message from Panel ───────────────────────────────────────────────────────
function handlePanelMessage(msg, port) {
  switch (msg.type) {
    case 'SET_INTERCEPT':
      interceptEnabled = msg.enabled;
      broadcastAll({ type: 'INTERCEPT_STATUS', enabled: interceptEnabled });
      break;

    case 'SET_CAPTURE':
      captureEnabled = msg.enabled;
      break;

    case 'FORWARD_REQUEST': {
      const queued = interceptQueue.get(msg.requestId);
      if (queued) {
        queued.resolve(msg.modifications || {});
        interceptQueue.delete(msg.requestId);
      }
      break;
    }

    case 'DROP_REQUEST': {
      const queued = interceptQueue.get(msg.requestId);
      if (queued) {
        queued.resolve({ cancel: true });
        interceptQueue.delete(msg.requestId);
      }
      break;
    }

    case 'REPLAY_REQUEST':
      replayRequest(msg.request).then((resp) => {
        port.postMessage({ type: 'REPLAY_RESPONSE', id: msg.id, response: resp });
      });
      break;

    case 'INTRUDER_RUN':
      runIntruder(msg.config, port);
      break;

    case 'CLEAR_HISTORY':
      SessionStore.clearAll();
      broadcastAll({ type: 'HISTORY_CLEARED' });
      break;

    case 'EXPORT_SESSION':
      SessionStore.exportAll().then((data) => {
        port.postMessage({ type: 'EXPORT_DATA', data });
      });
      break;

    case 'IMPORT_SESSION':
      SessionStore.importAll(msg.data).then(() => {
        port.postMessage({ type: 'IMPORT_DONE' });
      });
      break;

    case 'GET_HISTORY':
      SessionStore.getAll().then((requests) => {
        port.postMessage({ type: 'HISTORY_DATA', requests });
      });
      break;
  }
}

// ─── Broadcast to all connected panels ───────────────────────────────────────
function broadcastAll(msg) {
  for (const port of panelPorts.values()) {
    try { port.postMessage(msg); } catch (_) { }
  }
}

function broadcastToTab(tabId, msg) {
  const port = panelPorts.get(tabId);
  if (port) {
    try { port.postMessage(msg); } catch (_) { }
  } else {
    // broadcast to all if no specific tab
    broadcastAll(msg);
  }
}

// ─── Request Interception via webRequest ──────────────────────────────────────
// We use declarativeNetRequest for blocking + webRequest for observation
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!captureEnabled) return;
    if (isInternalRequest(details)) return;

    const requestId = details.requestId;
    const entry = buildRequestEntry(details);

    pendingResponses.set(requestId, Date.now());

    // Store immediately for history
    SessionStore.saveRequest(entry);

    // Broadcast new request to all panels
    broadcastAll({ type: 'NEW_REQUEST', request: entry });

    // Note: Manual interception (blocking/modifying) is limited in MV3.
    // For a full "Pause/Forward" experience, one would typically use the Debugger API.
    // For now, we capture and log everything correctly.
    if (interceptEnabled) {
      broadcastAll({ type: 'INTERCEPTED_LOG', request: entry });
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!captureEnabled) return;
    if (isInternalRequest(details)) return;

    const stored = SessionStore.getById(details.requestId);
    if (stored) {
      SessionStore.updateRequest(details.requestId, {
        headers: headersArrayToObj(details.requestHeaders)
      });
      broadcastAll({
        type: 'REQUEST_HEADERS',
        requestId: details.requestId,
        headers: details.requestHeaders
      });
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!captureEnabled) return;
    if (isInternalRequest(details)) return;

    const start = pendingResponses.get(details.requestId);
    const elapsed = start ? Date.now() - start : 0;

    SessionStore.updateRequest(details.requestId, {
      status: details.statusCode,
      statusLine: details.statusLine,
      responseHeaders: headersArrayToObj(details.responseHeaders),
      time: elapsed
    });

    broadcastAll({
      type: 'RESPONSE_HEADERS',
      requestId: details.requestId,
      status: details.statusCode,
      statusLine: details.statusLine,
      responseHeaders: details.responseHeaders,
      time: elapsed
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!captureEnabled) return;
    pendingResponses.delete(details.requestId);

    SessionStore.updateRequest(details.requestId, {
      completed: true,
      finalStatus: details.statusCode
    });

    broadcastAll({
      type: 'REQUEST_COMPLETE',
      requestId: details.requestId,
      status: details.statusCode
    });
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    pendingResponses.delete(details.requestId);
    SessionStore.updateRequest(details.requestId, {
      error: details.error,
      completed: true
    });
    broadcastAll({
      type: 'REQUEST_ERROR',
      requestId: details.requestId,
      error: details.error
    });
  },
  { urls: ['<all_urls>'] }
);

// ─── Replay Engine ────────────────────────────────────────────────────────────
async function replayRequest(req) {
  const start = Date.now();
  try {
    const opts = {
      method: req.method,
      headers: req.headers || {},
      redirect: 'follow'
    };

    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      opts.body = req.body;
    }

    const response = await fetch(req.url, opts);
    const elapsed = Date.now() - start;
    const respHeaders = {};
    response.headers.forEach((v, k) => { respHeaders[k] = v; });

    let body = '';
    const contentType = respHeaders['content-type'] || '';
    if (contentType.includes('json') || contentType.includes('text')) {
      body = await response.text();
    } else {
      body = '[Binary content]';
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      body,
      time: elapsed,
      size: body.length
    };
  } catch (err) {
    return { error: err.message, time: Date.now() - start };
  }
}

// ─── Intruder Engine ─────────────────────────────────────────────────────────
async function runIntruder(config, port) {
  const { request, positions, payloadSets, attackType } = config;
  const results = [];
  const payloads = generatePayloadCombinations(attackType, payloadSets, positions);

  for (let i = 0; i < payloads.length; i++) {
    const combo = payloads[i];
    const req = injectPayloads(request, positions, combo);
    const resp = await replayRequest(req);

    const result = {
      index: i,
      payloads: combo,
      status: resp.status,
      size: resp.size || (resp.body || '').length,
      time: resp.time,
      error: resp.error
    };
    results.push(result);

    port.postMessage({ type: 'INTRUDER_RESULT', result, total: payloads.length });

    // Small pause to avoid rate-limiting
    await sleep(50);
  }

  port.postMessage({ type: 'INTRUDER_DONE', results });
}

function generatePayloadCombinations(attackType, payloadSets, positions) {
  const sets = payloadSets.map(s => s.payloads || []);
  if (sets.length === 0) return [];

  switch (attackType) {
    case 'sniper': {
      const combos = [];
      positions.forEach((_, pi) => {
        (sets[0] || []).forEach(payload => {
          const combo = positions.map((_, i) => i === pi ? payload : '§original§');
          combos.push(combo);
        });
      });
      return combos;
    }
    case 'battering_ram': {
      return (sets[0] || []).map(p => positions.map(() => p));
    }
    case 'pitchfork': {
      const len = Math.min(...sets.map(s => s.length));
      return Array.from({ length: len }, (_, i) => sets.map(s => s[i] ?? ''));
    }
    case 'cluster_bomb': {
      return cartesianProduct(sets);
    }
    default:
      return (sets[0] || []).map(p => [p]);
  }
}

function cartesianProduct(arrays) {
  return arrays.reduce((acc, arr) =>
    acc.flatMap(a => arr.map(b => [...a, b])), [[]]
  );
}

function injectPayloads(request, positions, payloads) {
  let url = request.url;
  let body = request.body || '';

  positions.forEach((pos, i) => {
    const val = payloads[i] ?? '';
    if (pos.location === 'url') {
      url = url.replace(pos.marker, encodeURIComponent(val));
    } else if (pos.location === 'body') {
      body = body.replace(pos.marker, val);
    }
  });

  return { ...request, url, body };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildRequestEntry(details) {
  const url = new URL(details.url);
  const params = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });

  let bodyStr = '';
  if (details.requestBody) {
    if (details.requestBody.raw) {
      try {
        const bytes = details.requestBody.raw.map(b => b.bytes);
        const merged = new Uint8Array(bytes.reduce((a, b) => [...a, ...new Uint8Array(b)], []));
        bodyStr = new TextDecoder().decode(merged);
      } catch (_) { }
    } else if (details.requestBody.formData) {
      bodyStr = new URLSearchParams(details.requestBody.formData).toString();
    }
  }

  return {
    id: details.requestId,
    timestamp: Date.now(),
    method: details.method,
    url: details.url,
    host: url.hostname,
    path: url.pathname,
    scheme: url.protocol.replace(':', ''),
    params,
    body: bodyStr,
    headers: {},
    status: null,
    statusLine: null,
    responseHeaders: {},
    time: null,
    size: null,
    completed: false,
    error: null,
    tags: [],
    tab: details.tabId,
    type: details.type,
    initiator: details.initiator || ''
  };
}

function isInternalRequest(details) {
  return details.url.startsWith('chrome-extension://') ||
    details.url.startsWith('chrome://') ||
    details.url.startsWith('devtools://');
}

function headersArrayToObj(headers = []) {
  const obj = {};
  headers.forEach(h => { obj[h.name.toLowerCase()] = h.value; });
  return obj;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Keep service worker alive
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ReqPlus] Extension installed.');
});
