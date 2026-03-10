// ReqPlus Proxy Engine – Service Worker (Manifest V3)
// Intercepts and modifies requests using the Debugger API (Burp Suite style)

import { SessionStore } from '../storage/session_store.js';

// ─── State ────────────────────────────────────────────────────────────────────
let interceptEnabled = false;
let captureEnabled = true;
let debuggedTabs = new Set();
let interceptQueue = new Map(); // requestId → { resolve, reject, request }
let panelPorts = new Map();     // tabId → port (DevTools panel connection)
const pendingResponses = new Map();

// ─── DevTools Panel Connection ────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'reqplus-panel') {
    port.onMessage.addListener((msg) => {
      if (msg.type === 'PANEL_INIT') {
        panelPorts.set(msg.tabId, port);
        port._tabId = msg.tabId;
        attachDebugger(msg.tabId);
        port.postMessage({ type: 'READY' });
      } else {
        handlePanelMessage(msg, port);
      }
    });

    port.onDisconnect.addListener(() => {
      if (port._tabId !== undefined) {
        panelPorts.delete(port._tabId);
        detachDebugger(port._tabId);
      }
    });
  }
});

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
      const { requestId, modifications } = msg;
      chrome.debugger.sendCommand({ tabId: port._tabId }, "Fetch.continueRequest", {
        requestId: requestId,
        url: modifications.url,
        method: modifications.method,
        postData: modifications.body ? btoa(modifications.body) : undefined,
        headers: objToHeadersArray(modifications.headers)
      });
      break;
    }

    case 'DROP_REQUEST':
      chrome.debugger.sendCommand({ tabId: port._tabId }, "Fetch.failRequest", {
        requestId: msg.requestId,
        errorReason: "Aborted"
      });
      break;

    case 'REPLAY_REQUEST':
      replayRequest(msg.request).then(resp => {
        port.postMessage({ type: 'REPLAY_RESPONSE', id: msg.id, response: resp });
      });
      break;

    case 'GET_HISTORY':
      SessionStore.getAll().then(requests => {
        port.postMessage({ type: 'HISTORY_DATA', requests });
      });
      break;
  }
}

// ─── Debugger Engine ──────────────────────────────────────────────────────────
async function attachDebugger(tabId) {
  if (debuggedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggedTabs.add(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }]
    });
    console.log(`[ReqPlus] Debugger attached to tab ${tabId}`);
  } catch (e) {
    console.error(`[ReqPlus] Failed to attach debugger: ${e.message}`);
  }
}

async function detachDebugger(tabId) {
  if (!debuggedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
    debuggedTabs.delete(tabId);
  } catch (e) { }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === "Fetch.requestPaused") {
    const { requestId, request } = params;
    const entry = buildRequestFromDebugger(requestId, request, source.tabId);

    if (captureEnabled) {
      SessionStore.saveRequest(entry);
      broadcastAll({ type: 'NEW_REQUEST', request: entry });
    }

    if (interceptEnabled) {
      broadcastAll({ type: 'INTERCEPTED', request: entry });
    } else {
      chrome.debugger.sendCommand(source, "Fetch.continueRequest", { requestId });
    }
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildRequestFromDebugger(requestId, request, tabId) {
  const url = new URL(request.url);
  const params = {};
  url.searchParams.forEach((v, k) => params[k] = v);

  return {
    id: requestId,
    timestamp: Date.now(),
    method: request.method,
    url: request.url,
    host: url.hostname,
    path: url.pathname,
    headers: request.headers,
    body: request.postData ? atob(request.postData) : '',
    params,
    tab: tabId,
    status: null,
    time: null,
    size: null,
    completed: false
  };
}

function objToHeadersArray(obj = {}) {
  return Object.entries(obj).map(([name, value]) => ({ name, value }));
}

function broadcastAll(msg) {
  for (const port of panelPorts.values()) {
    try { port.postMessage(msg); } catch (_) { }
  }
}

async function replayRequest(req) {
  const start = Date.now();
  try {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' ? req.body : undefined
    });
    const body = await response.text();
    const headers = {};
    response.headers.forEach((v, k) => headers[k] = v);
    return {
      status: response.status,
      headers,
      body,
      time: Date.now() - start,
      size: body.length
    };
  } catch (err) {
    return { error: err.message };
  }
}

chrome.runtime.onInstalled.addListener(() => console.log('[ReqPlus] Ready.'));
