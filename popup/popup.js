// ReqPlus Popup Script

function updateStatus() {
    chrome.runtime.sendMessage({ type: 'GET_CORE_STATUS' }, (resp) => {
        if (chrome.runtime.lastError) {
            console.warn("Background not ready yet:", chrome.runtime.lastError.message);
            return;
        }
        if (resp) {
            const statusEl = document.getElementById('interceptStatus');
            statusEl.textContent = resp.intercept ? 'ON' : 'OFF';
            statusEl.className = resp.intercept ? 'status-2xx' : '';
        }
    });
}

document.getElementById('openDevTools').onclick = () => {
    // Opening the panel normally requires F12, but we can open a helpful page or just close
    alert("Please open DevTools (F12) and select the 'ReqPlus' tab to use the toolkit.");
    window.close();
};

// Initial update
updateStatus();
// Poll for updates while popup is open
setInterval(updateStatus, 1000);
