document.getElementById('openDevTools').onclick = () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
    // In reality, user just opens DevTools, but we can hint them
    window.close();
};

// Update status from background
chrome.runtime.sendMessage({ type: 'GET_CORE_STATUS' }, (resp) => {
    if (resp) {
        document.getElementById('interceptStatus').textContent = resp.intercept ? 'ON' : 'OFF';
        document.getElementById('interceptStatus').className = resp.intercept ? 's-2xx' : '';
    }
});
