import { RequestParser } from '../core/request_parser.js';
import { DiffEngine } from '../core/diff_engine.js';
import { PayloadEngine } from '../core/payload_engine.js';

// ─── Constants & Globals ──────────────────────────────────────────────────────
const TAB_ID = chrome.devtools.inspectedWindow.tabId;
let port;
let historyData = [];
let selectedRequest = null;
let currentInterceptedRequest = null;
let repeaterTabs = []; // [{ id, url, request, response }]
let nextRepeaterTabId = 1;

// ─── Initialization ──────────────────────────────────────────────────────────
function init() {
    setupPort();
    setupNav();
    setupProxyControls();
    setupRepeaterControls();
    setupIntruderControls();
    setupLogger();
    setupSplitPanes();
    setupCommandPalette();
    setupContextMenu();

    // Refresh history
    port.postMessage({ type: 'GET_HISTORY' });
    port.postMessage({ type: 'GET_CORE_STATUS' });

    // Ensure we have at least one empty repeater tab
    addRepeaterTab();
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

// ─── Proxy ─────────────────────────────────────────────────────────
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

    document.getElementById('sendToRepeaterFromProxy').onclick = () => {
        const raw = document.getElementById('interceptEditor').value;
        const req = RequestParser.parseRaw(raw);
        req.url = currentInterceptedRequest.url;
        addRepeaterTab(req);
        switchTab('repeater');
    };

    document.getElementById('clearProxyBtn').onclick = () => {
        historyData = [];
        document.getElementById('proxyTableBody').innerHTML = '';
        updateStatusCount();
        port.postMessage({ type: 'CLEAR_HISTORY' });
    };
}

function addRequestToTables(req) {
    if (historyData.some(h => h.id === req.id)) return;
    historyData.push(req);
    appendRequestRow(req, 'proxyTableBody');
    updateStatusCount();
}

function appendRequestRow(req, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.dataset.id = req.id;
    tr.onclick = (e) => selectRequest(req, tr);
    tr.oncontextmenu = (e) => {
        e.preventDefault();
        selectRequest(req, tr);
        showContextMenu(e.pageX, e.pageY, req);
    };

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

    const detail = document.getElementById('proxyDetail');
    detail.classList.remove('hidden');
    detail.innerHTML = `
        <div class="pane-header"><span>Request Detail (${req.method} ${req.host})</span></div>
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

// ─── Context Menu ─────────────────────────────────────────────────────────────
function setupContextMenu() {
    const menu = document.getElementById('ctxMenu');
    document.addEventListener('click', () => menu.classList.add('hidden'));

    menu.querySelectorAll('.ctx-item').forEach(item => {
        item.onclick = (e) => {
            const action = item.dataset.action;
            if (!selectedRequest) return;

            switch (action) {
                case 'send-repeater':
                    addRepeaterTab(selectedRequest);
                    switchTab('repeater');
                    break;
                case 'send-intruder':
                    sendToIntruder(selectedRequest);
                    switchTab('intruder');
                    break;
                case 'copy-url':
                    copyToClipboard(selectedRequest.url);
                    break;
            }
        };
    });
}

function showContextMenu(x, y, req) {
    const menu = document.getElementById('ctxMenu');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');
}

// ─── Repeater ─────────────────────────────────────────────────────────────
function setupRepeaterControls() {
    document.getElementById('addRepeaterTab').onclick = () => addRepeaterTab();
}

function addRepeaterTab(req = null) {
    const rid = nextRepeaterTabId++;
    const tabData = {
        id: rid,
        url: req ? req.url : '',
        request: req ? RequestParser.toRaw(req) : ''
    };
    repeaterTabs.push(tabData);

    // Create Tab Button
    const btn = document.createElement('button');
    btn.className = 'repeater-tab';
    btn.textContent = `Tab ${repeaterTabs.length}`;
    btn.dataset.rid = rid;
    btn.onclick = () => switchRepeaterTab(rid);

    // Insert before the "+" button
    const addBtn = document.getElementById('addRepeaterTab');
    addBtn.parentNode.insertBefore(btn, addBtn);

    // Create Instance UI
    const container = document.getElementById('repeaterContent');
    const instance = document.createElement('div');
    instance.className = 'repeater-instance';
    instance.id = `repInstance${rid}`;
    instance.innerHTML = `
        <div class="rep-controls">
            <input class="rep-url" id="repUrl${rid}" type="text" placeholder="URL" value="${tabData.url}">
            <button class="btn-primary" id="repSend${rid}">Send</button>
            <span class="rep-timing" id="repTiming${rid}"></span>
        </div>
        <div class="rep-split">
            <div class="rep-pane">
                <div class="pane-header"><span>Request</span></div>
                <textarea class="raw-editor" id="reqEditor${rid}" spellcheck="false">${tabData.request}</textarea>
            </div>
            <div class="rep-pane">
                <div class="pane-header"><span>Response</span> <span class="resp-status" id="respStatus${rid}"></span></div>
                <div class="resp-raw" id="respRaw${rid}"></div>
            </div>
        </div>
    `;
    container.appendChild(instance);

    document.getElementById(`repSend${rid}`).onclick = () => sendRepeater(rid);
    switchRepeaterTab(rid);
}

function switchRepeaterTab(rid) {
    document.querySelectorAll('.repeater-tab').forEach(b => b.classList.toggle('active', b.dataset.rid == rid));
    document.querySelectorAll('.repeater-instance').forEach(i => i.classList.toggle('active', i.id == `repInstance${rid}`));
}

async function sendRepeater(rid) {
    const raw = document.getElementById(`reqEditor${rid}`).value;
    const url = document.getElementById(`repUrl${rid}`).value;
    const req = RequestParser.parseRaw(raw);
    req.url = url;

    const btn = document.getElementById(`repSend${rid}`);
    btn.disabled = true;
    btn.textContent = 'Sending...';

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
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send';
    }
}

// ─── Intruder ─────────────────────────────────────────────────────────────
function setupIntruderControls() {
    document.getElementById('markPositionBtn').onclick = markIntruderPosition;
    document.getElementById('clearPositionsBtn').onclick = () => {
        const editor = document.getElementById('intruderEditor');
        editor.value = editor.value.replace(/§/g, '');
    };
}

function sendToIntruder(req) {
    document.getElementById('intruderEditor').value = RequestParser.toRaw(req);
}

function markIntruderPosition() {
    const editor = document.getElementById('intruderEditor');
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end) return;
    const text = editor.value;
    editor.value = text.substring(0, start) + '§' + text.substring(start, end) + '§' + text.substring(end);
}

// ─── UI Helpers ─────────────────────────────────────────────────────────────
function setupNav() {
    document.querySelectorAll('.tab-bar .tab-btn').forEach(btn => {
        btn.onclick = () => switchTab(btn.dataset.tab);
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn, .tab-panel').forEach(el => el.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
}

function log(msg, level = 'info') {
    const container = document.getElementById('logContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `log-entry log-${level}`;
    div.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> <span class="log-msg">${msg}</span>`;
    container.prepend(div);
}

function setupLogger() {
    document.getElementById('clearLogBtn').onclick = () => document.getElementById('logContainer').innerHTML = '';
}

function setupSplitPanes() { }

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

function updateInterceptToggle(on) {
    const t = document.getElementById('interceptToggle');
    if (t) t.checked = on;
    const el = document.getElementById('statusIntercept');
    if (el) {
        el.textContent = `Intercept: ${on ? 'ON' : 'OFF'}`;
        el.className = on ? 'status-intercept on' : 'status-intercept';
    }
}

function updateCaptureStatus(on) {
    const el = document.getElementById('statusCapture');
    if (el) {
        el.textContent = `Capture: ${on ? 'ON' : 'OFF'}`;
        el.className = on ? 'status-capture on' : 'status-capture';
    }
}

function updateStatusCount() {
    const el = document.getElementById('statusCount');
    if (el) el.textContent = `${historyData.length} requests`;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => log('Copied to clipboard', 'info'));
}

window.addEventListener('load', init);
