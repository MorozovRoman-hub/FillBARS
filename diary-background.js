(function () {
    'use strict';
    const Core = globalThis.FillBARSCardCore;
    const NS = 'fillbars-card-v1';
    const LIBRARY = 'cardLibraryV1';
    const SETTINGS = 'cardSettingsV1';
    const running = new Map();
    const operations = new Map();
    const key = tabId => 'cardSessionV1:' + tabId;
    const load = async tabId => (await chrome.storage.session.get(key(tabId)))[key(tabId)] || null;
    const store = async (tabId, state) => { await chrome.storage.session.set({ [key(tabId)]: state }); return state; };
    const publicError = () => 'Связь с вкладкой БАРС потеряна. Откройте расширение из нужной вкладки ещё раз. Уже отправленные записи повторно не сохраняйте.';
    async function callPage(binding, action, args = {}) {
        const results = await chrome.scripting.executeScript({
            target: binding.documentId ? { tabId: binding.tabId, documentIds: [binding.documentId] } : { tabId: binding.tabId, frameIds: [binding.frameId] },
            world: 'MAIN',
            func: async request => {
                if (!globalThis.__FillBARSCardPage) return { ok: false, code: 'page_missing', message: 'Страница перезагружена. Подключитесь заново.' };
                return globalThis.__FillBARSCardPage.execute(request);
            },
            args: [{ action, ...args }]
        });
        if (results.length !== 1 || !results[0].result) throw new Error(publicError());
        return results[0].result;
    }
    async function connect(tabId) {
        if (running.has(tabId)) throw new Error('Сначала остановите текущую очередь.');
        await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', files: ['diary-bars-adapter.js'] });
        const frames = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true }, world: 'MAIN',
            func: async () => globalThis.__FillBARSCardPage ? globalThis.__FillBARSCardPage.execute({ action: 'probe' }) : null
        });
        const candidates = frames.filter(frame => frame.result?.ok && frame.result.patient?.key);
        if (candidates.length !== 1) throw new Error(candidates.length ? 'Карточка найдена в нескольких фреймах. Оставьте открытым один приём.' : (frames.find(f => f.result?.message)?.result.message || 'Откройте карточку пациента в БАРС.'));
        const frame = candidates[0];
        const existing = await load(tabId);
        if (existing?.run && ['uncertain', 'interrupted'].includes(existing.run.status)) throw new Error('Сначала проверьте прошлую отправку в БАРС и завершите её разбор в окне дневников.');
        const samePatient = !existing?.patient || existing.patient.key === frame.result.patient.key;
        const state = {
            binding: { tabId, frameId: frame.frameId, documentId: frame.documentId },
            patient: frame.result.patient, connectedAt: new Date().toISOString(),
            draft: samePatient ? existing?.draft || null : null, run: samePatient ? existing?.run || null : null
        };
        await store(tabId, state);
        return { ...state, probe: frame.result };
    }
    async function recover(tabId) {
        const state = await load(tabId);
        if (state?.run?.status === 'running' && !running.has(tabId)) {
            state.run.status = state.run.phase === 'saving' ? 'uncertain' : 'interrupted';
            state.run.message = 'Фоновая работа прервалась. Проверьте текущий приём и уже сохранённые записи в БАРС. Автоматического повтора не будет.';
            await store(tabId, state);
        }
        return state;
    }
    function recordSaved(state, row, receipt) {
        const run = state.run;
        run.results ||= [];
        if (!run.results.some(item => item.rowId === row.id)) run.results.push({ rowId: row.id, ...receipt });
        const draftRow = state.draft?.rows?.find(item => item.id === row.id);
        if (draftRow) Object.assign(draftRow, { status: 'saved', recordId: receipt.recordId });
    }
    async function runQueue(tabId, state, fillOnly) {
        const control = running.get(tabId);
        const run = state.run;
        const appendTrace = result => {
            if (!Array.isArray(result?.trace)) return;
            run.trace = [...(run.trace || []), ...result.trace.map(entry => ({ ...entry, row: run.index + 1 }))].slice(-250);
        };
        const checkpoint = async (phase, message) => {
            run.phase = phase; run.message = message; run.updatedAt = Date.now();
            await store(tabId, state);
        };
        try {
            for (let index = 0; index < run.rows.length; index++) {
                const row = run.rows[index];
                // A confirmed receipt survives restarts and must never be sent again.
                if (run.results.some(item => item.rowId === row.id)) continue;
                run.index = index;
                if (control.stop) { run.status = 'stopped'; await checkpoint('stopped', 'Очередь остановлена. Неотправленные записи остались в черновиках.'); return; }
                await checkpoint('preparing', 'Подготовка дневника ' + (index + 1) + ' из ' + run.rows.length);
                const args = { runId: run.id, context: state.patient, row, values: Core.fields(row) };
                const prepared = await callPage(state.binding, 'prepare', args);
                appendTrace(prepared);
                if (!prepared.ok) {
                    run.status = 'failed'; run.code = prepared.code;
                    await checkpoint('preparing', prepared.message); return;
                }
                if (fillOnly || control.stop) {
                    await callPage(state.binding, 'release');
                    run.status = fillOnly ? 'filled' : 'stopped';
                    await checkpoint('prepared', fillOnly ? 'Поля заполнены. Приём оставлен открытым, сохранение выполните в БАРС.' : 'Очередь остановлена. Текущий приём заполнен, но не сохранён.');
                    return;
                }
                // Persist the saving checkpoint before any request can create a record.
                await checkpoint('saving', 'Сохранение и проверка дневника ' + (index + 1));
                const saved = await callPage(state.binding, 'save', args);
                appendTrace(saved);
                if (!saved.ok || !saved.verified) {
                    run.status = saved.code === 'save_uncertain' || saved.ok ? 'uncertain' : 'failed';
                    run.code = saved.code;
                    await checkpoint(run.status === 'uncertain' ? 'saving' : 'prepared', saved.message || 'Результат не подтверждён. Проверьте БАРС.'); return;
                }
                recordSaved(state, row, { recordId: saved.recordId, verification: saved.verification || 'list' });
                await checkpoint('verified', 'Сохранение подтверждено: ' + run.results.length + ' из ' + run.rows.length);
            }
            run.status = 'done';
            await checkpoint('done', 'Сохранение всех дневников подтверждено.');
        } catch (error) {
            run.status = run.phase === 'saving' ? 'uncertain' : 'interrupted';
            await checkpoint(run.phase, publicError()).catch(() => undefined);
        } finally { running.delete(tabId); }
    }
    async function start(tabId, message) {
        const state = await recover(tabId);
        if (!state?.binding) throw new Error('Откройте карточку пациента и нажмите «Дневники» в расширении.');
        if (running.has(tabId)) throw new Error('Очередь уже запущена.');
        if (['uncertain', 'interrupted'].includes(state.run?.status)) throw new Error('Проверьте результат предыдущей отправки в БАРС.');
        const rows = Core.clone(message.rows || []);
        const errors = Core.validateQueue(rows, { forSending: true });
        if (errors.length) throw new Error('Запись ' + (errors[0].index + 1) + ': ' + errors[0].message);
        if (message.fillOnly && rows.length !== 1) throw new Error('Для заполнения без сохранения выберите одну запись.');
        const savedIds = new Set((state.draft?.rows || []).filter(row => row.status === 'saved').map(row => row.id));
        if (rows.some(row => savedIds.has(row.id))) throw new Error('В очереди есть уже сохранённая запись.');
        const probe = await callPage(state.binding, 'probe');
        if (!probe.ok || probe.patient.key !== state.patient.key) throw new Error(probe.message || 'Пациент изменился. Нажмите «Дневники» из нужной карточки.');
        if (['failed', 'stopped', 'filled'].includes(state.run?.status)) {
            const released = await callPage(state.binding, 'release');
            if (!released.ok) throw new Error(released.message || 'Сначала проверьте предыдущую запись в БАРС.');
        }
        state.run = { id: Core.uid(), status: 'running', phase: 'starting', index: 0, rows, fillOnly: !!message.fillOnly, results: [], trace: [], updatedAt: Date.now(), message: 'Запуск очереди' };
        running.set(tabId, { stop: false });
        try { await store(tabId, state); } catch (error) { running.delete(tabId); throw error; }
        void runQueue(tabId, state, !!message.fillOnly);
        return state;
    }
    async function continueQueue(tabId, message) {
        const state = await recover(tabId);
        const run = state?.run;
        if (running.has(tabId)) throw new Error('Очередь уже продолжается.');
        if (!state?.binding || !run || run.id !== message.runId || !['uncertain', 'interrupted'].includes(run.status)) throw new Error('Состояние очереди изменилось. Дождитесь обновления окна.');
        const current = run.rows[run.index || 0];
        if (!current || current.id !== message.rowId) throw new Error('Текущая запись изменилась. Дождитесь обновления окна.');
        const confirmSave = run.phase === 'saving';
        if (confirmSave && message.checkedInBars !== true) throw new Error('Подтвердите, что именно текущий дневник уже сохранён в БАРС.');
        const probe = await callPage(state.binding, 'probe');
        if (!probe.ok || probe.patient?.key !== state.patient.key) throw new Error(probe.message || 'Откройте в БАРС пациента этой очереди.');
        run.results ||= [];
        if (confirmSave) {
            recordSaved(state, current, { verification: 'manual' });
            run.trace = [...(run.trace || []), { time: new Date().toISOString(), row: (run.index || 0) + 1, stage: 'Пользователь подтвердил сохранение в БАРС' }].slice(-250);
            // Commit the receipt BEFORE releasing the page or starting the next row.
            // If the worker stops here, continuation skips this diary.
            run.releaseChecked = true;
            run.status = 'interrupted'; run.phase = 'confirmed'; run.code = '';
            run.updatedAt = Date.now();
            run.message = 'Текущая запись отмечена как сохранённая. Остальные черновики сохранены.';
            await store(tabId, state);
        }
        const remaining = run.rows.filter(row => !run.results.some(item => item.rowId === row.id));
        const errors = remaining.length ? Core.validateQueue(remaining, { forSending: true }) : [];
        if (errors.length) throw new Error(errors[0].message);
        try {
            const released = await callPage(state.binding, 'release', { checkedInBars: run.releaseChecked === true });
            if (!released.ok) throw new Error(released.message || 'Не удалось подготовить продолжение очереди.');
        } catch (error) {
            run.status = 'interrupted'; run.updatedAt = Date.now();
            run.message = 'Продолжение пока недоступно. Подтверждённые записи повторно отправляться не будут. ' + (error.message || publicError());
            await store(tabId, state);
            return state;
        }
        run.releaseChecked = false;
        run.code = '';
        run.status = 'running'; run.phase = 'continuing'; run.updatedAt = Date.now();
        run.message = remaining.length ? 'Продолжение оставшихся дневников' : 'Завершение очереди';
        running.set(tabId, { stop: false });
        try { await store(tabId, state); } catch (error) { running.delete(tabId); throw error; }
        void runQueue(tabId, state, !!run.fillOnly);
        return state;
    }
    async function handle(message) {
        const tabId = message.tabId;
        if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Не выбрана исходная вкладка БАРС. Откройте дневники кнопкой расширения.');
        if (message.action === 'load') {
            const stored = await chrome.storage.local.get([LIBRARY, SETTINGS]);
            return { state: await recover(tabId), library: stored[LIBRARY] ? Core.cleanLibrary(stored[LIBRARY]) : Core.emptyLibrary(), settings: stored[SETTINGS] || {} };
        }
        if (message.action === 'connect') return { state: await connect(tabId) };
        if (message.action === 'saveSettings') {
            const settings = Core.cleanSettings(message.settings);
            await chrome.storage.local.set({ [SETTINGS]: settings });
            return { settings };
        }
        if (message.action === 'saveLibrary') {
            const library = Core.cleanLibrary(message.library);
            await chrome.storage.local.set({ [LIBRARY]: library });
            return { library };
        }
        if (message.action === 'draft') {
            if (running.has(tabId)) throw new Error('Во время отправки черновики недоступны для изменения.');
            const state = await recover(tabId) || { binding: null, patient: null, run: null };
            if (['uncertain', 'interrupted'].includes(state.run?.status)) throw new Error('Сначала завершите разбор предыдущей отправки.');
            const draft = message.draft;
            if (!draft || !Array.isArray(draft.rows) || draft.rows.length > Core.MAX_ROWS || JSON.stringify(draft).length > 1500000) throw new Error('Черновик слишком большой.');
            // UI edits cannot clear receipt flags and accidentally re-send a saved row.
            const receipts = new Map((state.draft?.rows || []).filter(r => r.status === 'saved').map(r => [r.id, r]));
            for (const row of draft.rows) if (receipts.has(row.id)) Object.assign(row, { status: 'saved', recordId: receipts.get(row.id).recordId });
            state.draft = draft; await store(tabId, state); return { state };
        }
        if (message.action === 'start') return { state: await start(tabId, message) };
        if (message.action === 'continue') return { state: await continueQueue(tabId, message) };
        if (message.action === 'stop') {
            const control = running.get(tabId);
            if (control) control.stop = true;
            return { stopping: !!control };
        }
        if (message.action === 'status') return { state: await recover(tabId) };
        if (message.action === 'clear') {
            if (running.has(tabId)) throw new Error('Сначала остановите очередь.');
            const state = await recover(tabId);
            if (['uncertain', 'interrupted'].includes(state?.run?.status) && message.checkedInBars !== true) throw new Error('Подтвердите проверку результата в БАРС.');
            if (state?.binding) {
                // Release only in-memory page state. Never close, delete or save a clinical form.
                await callPage(state.binding, 'release', { checkedInBars: message.checkedInBars === true }).catch(() => undefined);
            }
            await chrome.storage.session.remove(key(tabId));
            return { cleared: true };
        }
        throw new Error('Неизвестная команда дневников.');
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.namespace !== NS) return false;
        if (sender.id !== chrome.runtime.id || !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) {
            respond({ ok: false, error: 'Недопустимый источник команды.' }); return false;
        }
        const previous = operations.get(message.tabId) || Promise.resolve();
        const current = previous.catch(() => undefined).then(() => handle(message));
        operations.set(message.tabId, current);
        current.then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message || publicError() }))
            .finally(() => { if (operations.get(message.tabId) === current) operations.delete(message.tabId); });
        return true;
    });
    chrome.tabs.onRemoved.addListener(tabId => {
        if (running.has(tabId)) running.get(tabId).stop = true;
        else chrome.storage.session.remove(key(tabId));
    });
})();
