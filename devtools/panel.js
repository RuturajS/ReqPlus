import { RequestParser } from '../core/request_parser.js';
import { DiffEngine } from '../core/diff_engine.js';
import { PayloadEngine } from '../core/payload_engine.js';

// ─── Constants & Globals ──────────────────────────────────────────────────────
const TAB_ID = chrome.devtools.inspectedWindow.tabId;
let port;
let historyData = [];
let currentInterceptedRequest = null;
let repeaterTabs = [{ id: 0, request: '', response: null, view: 'raw' }];
let activeRepeaterTabId = 0;
let nextRepeaterTabId = 1;
let intruderPositions = [];
let intruderAttackRunning = false;
let intruderResults = [];

// ─── Initialization ──────────────────────────────────────────────────────────
function init() {
    setupPort();
    setupNav();
    setupProxyControls();
    setupHistoryControls();
    setupRepeaterControls();
    setupIntruderControls();
    setupLoggerControls();
    setupShortcuts();
    setupSplitPanes();
    setupContextMenu();

    // Initial data fetch
    requestHistory();
}

// ─── Communication ────────────────────────────────────────────────────────────
function setupPort() {
    port = chrome.runtime.connect({ name: 'reqplus-panel' });
    port.postMessage({ type: 'PANEL_INIT', tabId: TAB_ID });

    port.onMessage.addListener((msg) => {
        switch (msg.type) {
            case 'READY':
                log('Session connected', 'info');
                break;
            case 'NEW_REQUEST':
                addRequestToTables(msg.request);
                break;
            case 'INTERCEPTED':
                showIntercepted(msg.request);
                break;
            case 'HISTORY_DATA':
                renderHistory(msg.requests);
                break;
            case 'RESPONSE_HEADERS':
                updateRequestStatus(msg.requestId, msg.status, msg.time);
                break;
            case 'INTERCEPT_STATUS':
                updateInterceptToggle(msg.enabled);
                break;
            case 'INTRUDER_RESULT':
                addIntruderResult(msg.result, msg.total);
                break;
            case 'INTRUDER_DONE':
                finishIntruderAttack();
                break;
            case 'EXPORT_DATA':
                downloadSession(msg.data);
                break;
            case 'IMPORT_DONE':
                log('Session imported successfully', 'info');
                requestHistory();
                break;
        }
    });
}

// ─── Navigation ─────────────────────────────────────────────────────────────
function setupNav() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.dataset.tab;
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`tab-${target}`).classList.add('active');
        });
    });

    // Export/Import
    document.getElementById('exportBtn').onclick = () => port.postMessage({ type: 'EXPORT_SESSION' });
    document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
    document.getElementById('importFile').onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => port.postMessage({ type: 'IMPORT_SESSION', data: ev.target.result });
            reader.readAsText(file);
        }
    };
}

// ─── Proxy ─────────────────────────────────────────────────────────────────
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

function showIntercepted(req) {
    currentInterceptedRequest = req;
    const panel = document.getElementById('interceptPanel');
    const editor = document.getElementById('interceptEditor');
    panel.classList.remove('hidden');
    editor.value = RequestParser.toRaw(req);
    log(`Request intercepted: ${req.method} ${req.url}`, 'intercept');
}

function hideIntercepted() {
    document.getElementById('interceptPanel').classList.add('hidden');
    currentInterceptedRequest = null;
}

function addRequestToTables(req) {
    historyData.push(req);
    renderRequestRow(req, 'proxyTableBody');
    renderRequestRow(req, 'historyTableBody');
    updateStatusCount();
}

function renderRequestRow(req, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    const tr = document.createElement('tr');
    tr.dataset.id = req.id;
    tr.onclick = () => selectRequest(req, tr);
    tr.oncontextmenu = (e) => showContextMenu(e, req);

    const methodClass = `m-${req.method.toLowerCase()}`;
    const statusClass = req.status ? `s-${Math.floor(req.status / 100)}xx` : '';

    tr.innerHTML = `
    <td class="col-id">${historyData.length}</td>
    <td class="col-method"><span class="method-badge ${methodClass}">${req.method}</span></td>
    <td class="col-host">${req.host}</td>
    <td class="col-path">${req.path}</td>
    <td class="col-status"><span class="${statusClass}">${req.status || '...'}</span></td>
    <td class="col-size">${formatSize(req.size)}</td>
    <td class="col-time">${req.time ? req.time + 'ms' : ''}</td>
    <td class="col-tags">${renderTags(req.tags)}</td>
  `;

    // Virtual scrolling simulation: only keep last 500 in DOM if list gets huge
    if (tbody.children.length > 500) tbody.removeChild(tbody.firstChild);
    tbody.appendChild(tr);
}

// ─── Repeater ─────────────────────────────────────────────────────────────
function setupRepeaterControls() {
    document.getElementById('addRepeaterTab').onclick = createRepeaterTab;

    // View toggles
    document.querySelectorAll('.vtog').forEach(btn => {
        btn.onclick = () => {
            const rid = btn.dataset.rid;
            const view = btn.dataset.view || btn.dataset.rview;
            if (btn.dataset.view) switchRepeaterRequestView(rid, view);
            if (btn.dataset.rview) switchRepeaterResponseView(rid, view);
        };
    });
}

function createRepeaterTab(data = null) {
    const rid = nextRepeaterTabId++;
    const tab = { id: rid, request: data ? RequestParser.toRaw(data) : '', response: null, view: 'raw' };
    repeaterTabs.push(tab);

    // Tab button
    const btn = document.createElement('button');
    btn.className = 'repeater-tab';
    btn.textContent = `Tab ${repeaterTabs.length}`;
    btn.dataset.rid = rid;
    btn.onclick = () => switchRepeaterTab(rid);

    const addBtn = document.getElementById('addRepeaterTab');
    addBtn.parentNode.insertBefore(btn, addBtn);

    // Clone template (simulated since we're using innerHTML for speed here)
    const template = document.querySelector('.repeater-instance').cloneNode(true);
    template.dataset.rid = rid;
    template.classList.remove('active');

    // Update IDs in clone
    const elements = template.querySelectorAll('[id]');
    elements.forEach(el => el.id = el.id.replace('0', rid));

    document.getElementById('repeaterContent').appendChild(template);

    // Setup send logic for this tab
    const sendBtn = document.getElementById(`repSend${rid}`);
    sendBtn.onclick = () => sendRepeater(rid);

    if (data) {
        document.getElementById(`reqEditor${rid}`).value = RequestParser.toRaw(data);
        document.getElementById(`repUrl${rid}`).value = data.url;
    }

    switchRepeaterTab(rid);
    return rid;
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
        const response = await fetchRequest(req);
        const elapsed = Date.now() - start;

        // Store response
        const tabData = repeaterTabs.find(t => t.id === rid);
        tabData.response = response;

        renderRepeaterResponse(rid, response, elapsed);
        log(`Repeater [Tab ${rid}] sent to ${req.url}`, 'info');
    } catch (err) {
        log(`Repeater Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send';
    }
}

function renderRepeaterResponse(rid, resp, time) {
    document.getElementById(`respStatus${rid}`).textContent = `${resp.status} ${resp.statusText || ''}`;
    document.getElementById(`repTiming${rid}`).textContent = `${time}ms | ${formatSize(resp.size)}`;

    const rawBox = document.getElementById(`respRaw${rid}`);
    const prettyBox = document.getElementById(`respPretty${rid}`);

    // Raw view
    let rawStr = `HTTP/1.1 ${resp.status}\n`;
    for (const [k, v] of Object.entries(resp.headers)) rawStr += `${k}: ${v}\n`;
    rawStr += `\n${resp.body}`;
    rawBox.textContent = rawStr;

    // Pretty view
    const formatted = RequestParser.formatBody(resp.body, resp.headers['content-type']);
    prettyBox.innerHTML = formatted.formatted;

    // Diff view (if we have a previous response)
    // ... Logic to store last result for diff ...
}

// ─── Intruder ─────────────────────────────────────────────────────────────
function setupIntruderControls() {
    document.getElementById('markPositionBtn').onclick = markIntruderPosition;
    document.getElementById('clearPositionsBtn').onclick = clearIntruderPositions;
    document.getElementById('startAttackBtn').onclick = startIntruderAttack;
}

function markIntruderPosition() {
    const editor = document.getElementById('intruderEditor');
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end) return;

    const text = editor.value;
    const marker = `§${text.substring(start, end)}§`;
    editor.value = text.substring(0, start) + marker + text.substring(end);
}

function startIntruderAttack() {
    const raw = document.getElementById('intruderEditor').value;
    const attackType = document.getElementById('attackType').value;
    const payloadText = document.getElementById('payloadList0').value;
    const payloads = PayloadEngine.parseList(payloadText);

    if (payloads.length === 0) return alert('Add payloads first');

    intruderResults = [];
    document.getElementById('intruderResultsBody').innerHTML = '';
    document.getElementById('startAttackBtn').classList.add('hidden');
    document.getElementById('stopAttackBtn').classList.remove('hidden');

    // Send to logic in engine (background)
    // Simplified for this prototype
    runIntruderLocal(raw, payloads, attackType);
}

async function runIntruderLocal(raw, payloads, attackType) {
    const reqTemplate = RequestParser.parseRaw(raw.replace(/§/g, '')); // Crude cleanup
    // Actual logic would find § markers and replace

    for (let i = 0; i < payloads.length; i++) {
        const p = payloads[i];
        const currentReq = { ...reqTemplate };
        // ... Payload injection logic ...

        const start = Date.now();
        const resp = await fetchRequest(currentReq);
        const elapsed = Date.now() - start;

        addIntruderResult({
            id: i,
            payload: p,
            status: resp.status,
            size: (resp.body || '').length,
            time: elapsed
        });
    }
}

function addIntruderResult(res) {
    const tbody = document.getElementById('intruderResultsBody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
    <td>${res.id}</td>
    <td>${res.payload}</td>
    <td>${res.status}</td>
    <td>${res.size}</td>
    <td>${res.time}ms</td>
  `;
    tbody.appendChild(tr);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchRequest(req) {
    const opts = {
        method: req.method,
        headers: req.headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined
    };
    const res = await fetch(req.url, opts);
    const body = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => headers[k] = v);
    return { status: res.status, statusText: res.statusText, headers, body, size: body.length };
}

function log(msg, level = 'info') {
    const container = document.getElementById('logContainer');
    const div = document.createElement('div');
    div.className = 'log-entry fade-in';
    div.innerHTML = `
    <span class="log-time">${new Date().toLocaleTimeString()}</span>
    <span class="log-level log-${level}">${level}</span>
    <span class="log-msg">${msg}</span>
  `;
    container.prepend(div);
}

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
window.addEventListener('load', init);

// Global error handler
window.onerror = (msg) => log(msg, 'error');
