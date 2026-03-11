// DevTools registration script
chrome.devtools.panels.create(
    'ReqPlus',
    '/icons/icon16.png',
    '/devtools/panel.html',
    (panel) => {
        panel.onShown.addListener((window) => {
            // Panel shown
        });
    }
);
