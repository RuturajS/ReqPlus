import { RequestParser } from '../core/request_parser.js';
import { DiffEngine } from '../core/diff_engine.js';
import { PayloadEngine } from '../core/payload_engine.js';

// ─── Constants & Globals ──────────────────────────────────────────────────────
const TAB_ID = chrome.devtools.inspectedWindow.tabId;
let port;
let historyData = [];
let selectedRequest = null;
let currentInterceptedRequest = null;
let repeaterTabs = [{ id: 0, url: '', request: '', response: null, view: 'raw' }];
let activeRepeaterTabId = 0;
let nextRepeaterTabId = 1;
let intruderPositions = [];

// ─── Initialization ──────────────────────────────────────────────────────────
function init() {
    setupPort();
    setupNav();
    setupProxyControls();
    setupHistoryControls();
    setupRepeaterControls();
    setupIntruderControls();
    setupLogger();
    setupSplitPanes();
    setupCommandPalette();

    // Refresh history
    port.postMessage({ type: 'GET_HISTORY' });
    port.postMessage({ type: 'GET_CORE_STATUS' });
}

// ─── Communication ────────────────────────────────────────────────────────────
function setupPort() {
    port = chrome.runtime.connect({ name: 'reqplus-panel' });
    port.postMessage({ type: 'PANEL_INIT', tabId: TAB_ID });

    port.onMessage.addListener((msg) => {
        switch (msg.type) {
            case 'READY': log('Engine connected', 'info'); break;
            case 'NEW_REQUEST': addRequestToTables(msg.request); break;
            case 'INTERCEPTED': showIntercepted(msg.request); break;
            case 'HISTORY_DATA': renderAllHistory(msg.requests); break;
            case 'CORE_STATUS':
                updateInterceptToggle(msg.intercept);
                updateCaptureStatus(msg.capture);
                break;
            case 'INTERCEPT_STATUS': updateInterceptToggle(msg.enabled); break;
        }
    });
}

// ─── Proxy & History ─────────────────────────────────────────────────────────
function setupProxyControls() {
    const toggle = document.getElementById('interceptToggle');
    toggle.onchange = () => port.postMessage({ type: 'SET_INTERCEPT', enabled: toggle.checked });

    const captureToggle = document.getElementById('captureToggle');
    captureToggle.onchange = () => port.postMessage({ type: 'SET_CAPTURE', enabled: captureToggle.checked });

    document.getElementById('forwardBtn').onclick = () => {
        const raw = document.getElementById('interceptEditor').value;
        const mods = RequestParser.parseRaw(raw);
        port.postMessage({ type: 'FORWARD_REQUEST', requestId: currentInterceptedRequest.id, modifications: mods });
        hideIntercepted();
    };

    document.getElementById('dropBtn').onclick = () => {
        port.postMessage({ type: 'DROP_REQUEST', requestId: currentInterceptedRequest.id });
        hideIntercepted();
    };
}

function addRequestToTables(req) {
    if (historyData.some(h => h.id === req.id)) return;
    historyData.push(req);
    appendRequestRow(req, 'proxyTableBody');
    appendRequestRow(req, 'historyTableBody');
    updateStatusCount();
}

function appendRequestRow(req, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.dataset.id = req.id;
    tr.onclick = () => selectRequest(req, tr);

    const mCls = `m-${req.method.toLowerCase()}`;
    tr.innerHTML = `
        <td class="col-id">${historyData.length}</td>
        <td class="col-method"><span class="method-badge ${mCls}">${req.method}</span></td>
        <td class="col-host">${req.host}</td>
        <td class="col-path">${req.path}</td>
        <td class="col-status">...</td>
        <td class="col-size">-</td>
        <td class="col-time">-</td>
        <td class="col-tags"></td>
    `;
    tbody.appendChild(tr);
    if (tbody.children.length > 500) tbody.removeChild(tbody.firstChild);
}

function selectRequest(req, tr) {
    document.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
    tr.classList.add('selected');
    selectedRequest = req;

    // Update detail pane (simplified)
    const detail = document.getElementById('proxyDetail');
    detail.classList.remove('hidden');
    detail.innerHTML = `
        <div class="pane-header"><span>Request Detail</span></div>
        <textarea class="raw-editor" readonly>${RequestParser.toRaw(req)}</textarea>
    `;
}

function showIntercepted(req) {
    currentInterceptedRequest = req;
    document.getElementById('interceptPanel').classList.remove('hidden');
    document.getElementById('interceptEditor').value = RequestParser.toRaw(req);
}

function hideIntercepted() {
    document.getElementById('interceptPanel').classList.add('hidden');
    currentInterceptedRequest = null;
}

function updateInterceptToggle(on) {
    const t = document.getElementById('interceptToggle');
    t.checked = on;
    document.getElementById('statusIntercept').textContent = `Intercept: ${on ? 'ON' : 'OFF'}`;
    document.getElementById('statusIntercept').className = on ? 'status-intercept on' : 'status-intercept';
}

function updateCaptureStatus(on) {
    document.getElementById('statusCapture').textContent = `Capture: ${on ? 'ON' : 'OFF'}`;
    document.getElementById('statusCapture').className = on ? 'status-capture on' : 'status-capture';
}

function updateStatusCount() {
    document.getElementById('statusCount').textContent = `${historyData.length} requests`;
}

// ─── Repeater ─────────────────────────────────────────────────────────────
function setupRepeaterControls() {
    document.getElementById('repSend0').onclick = () => sendRepeater(0);
}

async function sendRepeater(rid) {
    const raw = document.getElementById(`reqEditor${rid}`).value;
    const req = RequestParser.parseRaw(raw);
    req.url = document.getElementById(`repUrl${rid}`).value || req.url;

    log(`Repeater sending to ${req.url}...`, 'info');
    const start = Date.now();
    try {
        const response = await fetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.method !== 'GET' ? req.body : undefined
        });
        const body = await response.text();
        const elapsed = Date.now() - start;

        document.getElementById(`respRaw${rid}`).textContent = body;
        document.getElementById(`respStatus${rid}`).textContent = `${response.status} ${response.statusText}`;
        document.getElementById(`repTiming${rid}`).textContent = `${elapsed}ms`;
    } catch (e) {
        log(`Repeater Error: ${e.message}`, 'error');
    }
}

// ─── Logger ─────────────────────────────────────────────────────────────
function log(msg, level = 'info') {
    const container = document.getElementById('logContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `log-entry log-${level}`;
    div.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> <span class="log-msg">${msg}</span>`;
    container.prepend(div);
}

// ─── UI Helpers ─────────────────────────────────────────────────────────────
function setupNav() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn, .tab-panel').forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        };
    });
}

function setupSplitPanes() {
    // Simple drag simulation or just hide/show
}

function setupCommandPalette() {
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            document.getElementById('paletteOverlay').classList.toggle('hidden');
        }
    });
}

function renderAllHistory(requests) {
    historyData = requests;
    document.getElementById('proxyTableBody').innerHTML = '';
    requests.forEach(req => appendRequestRow(req, 'proxyTableBody'));
    updateStatusCount();
}

// ─── Start ──────────────────────────────────────────────────────────────────
window.addEventListener('load', init);
