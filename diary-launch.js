'use strict';
document.getElementById('openDiaries').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('Откройте вкладку БАРС.');
        const response = await chrome.runtime.sendMessage({ namespace: 'fillbars-card-window-v1', action: 'open', tabId: tab.id });
        if (!response?.ok) throw new Error(response?.error || 'Не удалось открыть дневники.');
        window.close();
    } catch (error) {
        document.getElementById('status').textContent = error.message;
        button.disabled = false;
    }
});
