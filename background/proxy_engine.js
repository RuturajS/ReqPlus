// ReqPlus Proxy Engine – Service Worker (Manifest V3)
// Blended Interception: webRequest for Global History + Debugger for "Burp-style" Intercept

import { SessionStore } from '../storage/session_store.js';

// ─── State ────────────────────────────────────────────────────────────────────
let interceptEnabled = false;
let captureEnabled = true;
let debuggedTabs = new Set();
let panelPorts = new Map();     // tabId → port (DevTools panel connection)

// ─── Global Capture (Passive) ────────────────────────────────────────────────
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!captureEnabled || isInternalRequest(details)) return;

    // We only use webRequest for logging history.
    // We DON'T block here because that's restricted in MV3.
    const entry = buildRequestEntry(details);
    SessionStore.saveRequest(entry);
    broadcastAll({ type: 'NEW_REQUEST', request: entry });
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// ─── DevTools Panel Connection ────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'reqplus-panel') {
    port.onMessage.addListener((msg) => {
      if (msg.type === 'PANEL_INIT') {
        const tabId = msg.tabId;
        panelPorts.set(tabId, port);
        port._tabId = tabId;
        if (interceptEnabled) attachDebugger(tabId);
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
      if (interceptEnabled) {
        // Attach to all active panels
        for (const tabId of panelPorts.keys()) attachDebugger(tabId);
      } else {
        for (const tabId of debuggedTabs) detachDebugger(tabId);
      }
      broadcastAll({ type: 'INTERCEPT_STATUS', enabled: interceptEnabled });
      break;

    case 'SET_CAPTURE':
      captureEnabled = msg.enabled;
      break;

    case 'FORWARD_REQUEST':
      chrome.debugger.sendCommand({ tabId: port._tabId }, "Fetch.continueRequest", {
        requestId: msg.requestId
      });
      break;

    case 'DROP_REQUEST':
      chrome.debugger.sendCommand({ tabId: port._tabId }, "Fetch.failRequest", {
        requestId: msg.requestId,
        errorReason: "Aborted"
      });
      break;

    case 'GET_CORE_STATUS':
      port.postMessage({ type: 'CORE_STATUS', intercept: interceptEnabled, capture: captureEnabled });
      break;

    case 'GET_HISTORY':
      SessionStore.getAll().then(requests => {
        port.postMessage({ type: 'HISTORY_DATA', requests: requests.slice(-100) });
      });
      break;
  }
}

// ─── Debugger Engine (For Intercept) ──────────────────────────────────────────
async function attachDebugger(tabId) {
  if (debuggedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggedTabs.add(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }]
    });
    console.log(`[ReqPlus] Intercept active on tab ${tabId}`);
  } catch (e) {
    console.warn(`[ReqPlus] Could not attach debugger to tab ${tabId}: ${e.message}`);
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
    if (!interceptEnabled) {
      chrome.debugger.sendCommand(source, "Fetch.continueRequest", { requestId: params.requestId });
      return;
    }
    const req = params.request;
    const entry = {
      id: params.requestId,
      method: req.method,
      url: req.url,
      host: new URL(req.url).hostname,
      headers: req.headers,
      body: req.postData ? atob(req.postData) : '',
      tab: source.tabId
    };
    broadcastAll({ type: 'INTERCEPTED', request: entry });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildRequestEntry(details) {
  const url = new URL(details.url);
  return {
    id: details.requestId,
    timestamp: Date.now(),
    method: details.method,
    url: details.url,
    host: url.hostname,
    path: url.pathname,
    type: details.type,
    tab: details.tabId
  };
}

function isInternalRequest(details) {
  return details.url.startsWith('chrome-extension://') || details.url.startsWith('devtools://');
}

function broadcastAll(msg) {
  for (const port of panelPorts.values()) {
    try { port.postMessage(msg); } catch (_) { }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_CORE_STATUS') {
    sendResponse({ intercept: interceptEnabled, capture: captureEnabled });
  }
  return true;
});
