(function () {
    'use strict';
    const KEY = 'cardWindowV1';
    let operations = Promise.resolve();
    const enqueue = action => {
        const result = operations.catch(() => undefined).then(action);
        operations = result;
        return result;
    };
    async function open(tabId) {
        if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Откройте дневники из вкладки БАРС.');
        const saved = (await chrome.storage.session.get(KEY))[KEY];
        let existing = null;
        if (Number.isInteger(saved?.windowId)) {
            try { existing = await chrome.windows.get(saved.windowId); }
            catch (_) { await chrome.storage.session.remove(KEY); }
        }
        if (existing) {
            // Window IDs do not require access to all tab URLs. Restore minimized windows.
            if (existing.state === 'minimized') await chrome.windows.update(existing.id, { state: 'normal' });
            await chrome.windows.update(existing.id, { focused: true });
            // The existing editor saves its draft before switching source tabs.
            void chrome.runtime.sendMessage({ namespace: 'fillbars-card-ui-v1', action: 'source', tabId })
                .catch(() => undefined); // The editor may still be initializing after the first click.
            return { windowId: existing.id, reused: true };
        }
        const created = await chrome.windows.create({
            url: chrome.runtime.getURL('diaries.html') + '?tab=' + tabId,
            type: 'popup', width: 1100, height: 830, focused: true
        });
        if (!Number.isInteger(created?.id)) throw new Error('Не удалось открыть окно дневников.');
        await chrome.storage.session.set({ [KEY]: { windowId: created.id } });
        return { windowId: created.id, reused: false };
    }
    async function register(windowId) {
        const current = await chrome.windows.get(windowId);
        if (current.type !== 'popup') return { registered: false };
        const saved = (await chrome.storage.session.get(KEY))[KEY];
        if (Number.isInteger(saved?.windowId) && saved.windowId !== windowId) {
            let existing;
            try { existing = await chrome.windows.get(saved.windowId); } catch (_) { /* Closed window. */ }
            if (existing) {
                if (existing.state === 'minimized') await chrome.windows.update(existing.id, { state: 'normal' });
                await chrome.windows.update(existing.id, { focused: true });
                return { duplicate: true };
            }
        }
        await chrome.storage.session.set({ [KEY]: { windowId } });
        return { registered: true };
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.namespace !== 'fillbars-card-window-v1' || !['open', 'register'].includes(message.action)) return false;
        if (sender.id !== chrome.runtime.id || !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) {
            respond({ ok: false, error: 'Недопустимый источник команды.' }); return false;
        }
        if (message.action === 'register' && String(sender.url).split('?')[0] !== chrome.runtime.getURL('diaries.html')) {
            respond({ ok: false }); return false;
        }
        enqueue(() => message.action === 'open' ? open(message.tabId) : register(message.windowId))
            .then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
        return true;
    });
    chrome.windows.onRemoved.addListener(windowId => {
        void enqueue(async () => {
            if ((await chrome.storage.session.get(KEY))[KEY]?.windowId === windowId) await chrome.storage.session.remove(KEY);
        }).catch(() => undefined);
    });
})();
