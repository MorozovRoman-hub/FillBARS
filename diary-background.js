(function () {
    'use strict';
    const Core = globalThis.FillBARSCardCore;
    const NS = 'fillbars-card-v1';
    const LIBRARY = 'cardLibraryV1';
    const SETTINGS = 'cardSettingsV1';
    const ACTIVE = 'cardActiveContextV1';
    const SESSION_FALLBACK_QUOTA_BYTES = 1024 * 1024;
    const LOCAL_FALLBACK_QUOTA_BYTES = 5 * 1024 * 1024;
    const MAX_TRACE_ENTRIES = 250;
    const MAX_TRACE_ENTRY_BYTES = 1024;
    // Trace is capped below 1 KiB before storage; the reserve includes encoding and
    // storage overhead. A receipt can duplicate a bounded Unicode record ID in both
    // the result and its draft row, so it receives a larger independent reserve.
    const TRACE_ENTRY_RESERVE_BYTES = 1536;
    const RECEIPT_RESERVE_BYTES = 4 * 1024;
    const running = new Map();
    let operations = Promise.resolve();
    const key = tabId => 'cardSessionV1:' + tabId;
    const load = async tabId => (await chrome.storage.session.get(key(tabId)))[key(tabId)] || null;
    class StorageQuotaError extends Error {
        constructor(area = 'session') {
            super(area === 'local'
                ? 'Библиотека слишком велика для локального хранилища расширения. Сократите шаблоны или удалите лишние варианты.'
                : area === 'settings'
                    ? 'Недостаточно места в локальном хранилище настроек расширения.'
                    : 'Недостаточно места во временном хранилище дневников. Сократите текст или удалите неотправленные строки. Уже сохранённые записи и текущая очередь не изменены.');
            this.code = 'storage_quota';
        }
    }
    const utf8Length = value => {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        if (typeof globalThis.TextEncoder === 'function') return new globalThis.TextEncoder().encode(text || '').byteLength;
        // Node VM fixtures and very old test harnesses may not expose TextEncoder.
        // This is only a conservative preflight estimate; Chrome itself supplies TextEncoder.
        try { return unescape(encodeURIComponent(text || '')).length; }
        catch (_) { return (text || '').length * 3; }
    };
    // getBytesInUse is authoritative for existing storage. The estimate below deliberately
    // has headroom: JSON character count is neither a byte count nor Chrome's memory model.
    const estimatedEntryBytes = (name, value) => {
        const payload = utf8Length(value);
        return utf8Length(name) + Math.ceil(payload * 1.2) + 128;
    };
    const storageQuota = (area, fallback) => Number.isFinite(area?.QUOTA_BYTES) && area.QUOTA_BYTES > 0 ? area.QUOTA_BYTES : fallback;
    async function bytesInUse(area, keys) {
        if (typeof area?.getBytesInUse !== 'function') return null;
        const value = await area.getBytesInUse(keys);
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    function quotaHeadroom(quota) {
        return Math.min(quota <= SESSION_FALLBACK_QUOTA_BYTES ? 128 * 1024 : 512 * 1024, Math.floor(quota * 0.15));
    }
    async function assertStorageWriteFits(area, entries, { fallbackQuota, reserve = 0, kind = 'session' } = {}) {
        const quota = storageQuota(area, fallbackQuota);
        const total = await bytesInUse(area, null);
        const replaced = await bytesInUse(area, Object.keys(entries));
        if (total === null || replaced === null) return;
        const next = total - replaced + Object.entries(entries).reduce((sum, [name, value]) => sum + estimatedEntryBytes(name, value), 0);
        if (next + reserve + quotaHeadroom(quota) > quota) throw new StorageQuotaError(kind);
    }
    async function setStorage(area, entries, options) {
        await assertStorageWriteFits(area, entries, options);
        try { await area.set(entries); }
        catch (error) {
            if (/quota|QUOTA_BYTES/i.test(String(error?.message || error))) throw new StorageQuotaError(options?.kind);
            throw error;
        }
    }
    const store = async (tabId, state) => { await setStorage(chrome.storage.session, { [key(tabId)]: state }, { fallbackQuota: SESSION_FALLBACK_QUOTA_BYTES, kind: 'session' }); return state; };
    const activeContext = async () => (await chrome.storage.session.get(ACTIVE))[ACTIVE] || null;
    const protectedRun = state => ['running', 'uncertain', 'interrupted'].includes(state?.run?.status);
    const boundedText = (value, max) => String(value ?? '').slice(0, max);
    function boundedTraceValue(value, depth = 0) {
        if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
        if (typeof value === 'string') return boundedText(value, 240);
        if (depth >= 2 || typeof value !== 'object') return boundedText(value, 240);
        if (Array.isArray(value)) return value.slice(0, 8).map(item => boundedTraceValue(item, depth + 1));
        return Object.fromEntries(Object.entries(value).slice(0, 12).map(([name, item]) => [boundedText(name, 64), boundedTraceValue(item, depth + 1)]));
    }
    function compactTrace(entry, row) {
        const source = entry && typeof entry === 'object' ? entry : {};
        const compact = { time: boundedText(source.time || new Date().toISOString(), 64), row, stage: boundedText(source.stage || 'Техническое сообщение', 320) };
        for (const [name, value] of Object.entries(source).slice(0, 12)) {
            if (!['time', 'row', 'stage'].includes(name)) compact[boundedText(name, 64)] = boundedTraceValue(value);
        }
        return utf8Length(compact) <= MAX_TRACE_ENTRY_BYTES ? compact : { time: compact.time, row, stage: compact.stage, detail: 'Подробности сокращены из-за лимита хранилища.' };
    }
    function runReserve(state) {
        const run = state?.run;
        if (!run) return 0;
        const receiptCount = Math.max(0, (run.rows?.length || 0) - (run.results?.length || 0));
        const traceCount = Math.max(0, MAX_TRACE_ENTRIES - (run.trace?.length || 0));
        return receiptCount * RECEIPT_RESERVE_BYTES + traceCount * TRACE_ENTRY_RESERVE_BYTES;
    }
    function runProjection(state, rows, fillOnly = false) {
        const projected = Core.clone(state);
        projected.run = { id: 'reserve', status: 'running', phase: 'starting', index: 0, rows: Core.clone(rows), fillOnly: !!fillOnly, results: [], trace: [], updatedAt: Date.now(), message: 'Резерв места для очереди' };
        return projected;
    }
    async function assertRunFits(tabId, state, rows, fillOnly = false) {
        const projected = runProjection(state, rows, fillOnly);
        await assertStorageWriteFits(chrome.storage.session, { [key(tabId)]: projected }, { fallbackQuota: SESSION_FALLBACK_QUOTA_BYTES, reserve: runReserve(projected), kind: 'session' });
    }
    function assertRowIds(rows) {
        if (rows.some(row => typeof row?.id !== 'string' || !row.id || utf8Length(row.id) > 160)) {
            throw new Error('У записи повреждён служебный идентификатор. Удалите её и создайте заново; сохранение в БАРС не выполнялось.');
        }
    }
    async function assertContext(tabId, message) {
        const active = await activeContext();
        const state = await load(tabId);
        if ((active && active.tabId !== tabId) || ((state?.contextId || message.contextId) && message.contextId !== state?.contextId)) {
            throw new Error('Пациент в окне изменился. Откройте дневники из нужной карточки заново.');
        }
    }
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
        const active = await activeContext();
        const previous = active ? await recover(active.tabId) : null;
        const destination = await recover(tabId);
        if (protectedRun(previous) || protectedRun(destination)) throw new Error('Сначала проверьте прошлую отправку в БАРС и завершите её разбор в окне дневников.');
        // Keep only the last opened patient, including when BARS uses multiple tabs.
        const existing = active ? previous : destination;
        const samePatient = !existing?.patient || existing.patient.key === frame.result.patient.key;
        const state = {
            contextId: samePatient && active?.tabId === tabId && existing?.contextId ? existing.contextId : Core.uid(),
            binding: { tabId, frameId: frame.frameId, documentId: frame.documentId },
            patient: frame.result.patient, connectedAt: new Date().toISOString(),
            draft: samePatient ? existing?.draft || null : null, run: samePatient ? existing?.run || null : null
        };
        // Do not remove the previous tab before this write. A rejected transient double
        // allocation must leave its draft and any receipts intact for recovery.
        await setStorage(chrome.storage.session, { [key(tabId)]: state, [ACTIVE]: { tabId, contextId: state.contextId } }, { fallbackQuota: SESSION_FALLBACK_QUOTA_BYTES, kind: 'session' });
        if (active && active.tabId !== tabId) await chrome.storage.session.remove(key(active.tabId));
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
        if (!run.results.some(item => item.rowId === row.id)) run.results.push({
            rowId: row.id,
            recordId: boundedText(receipt?.recordId, 256),
            verification: boundedText(receipt?.verification || '', 64)
        });
        const draftRow = state.draft?.rows?.find(item => item.id === row.id);
        if (draftRow) Object.assign(draftRow, { status: 'saved', recordId: boundedText(receipt?.recordId, 256) });
    }
    async function runQueue(tabId, state, fillOnly) {
        const control = running.get(tabId);
        const run = state.run;
        const appendTrace = result => {
            if (!Array.isArray(result?.trace)) return;
            run.trace = [...(run.trace || []), ...result.trace.map(entry => compactTrace(entry, run.index + 1))].slice(-MAX_TRACE_ENTRIES);
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
                await assertStorageWriteFits(chrome.storage.session, { [key(tabId)]: state }, { fallbackQuota: SESSION_FALLBACK_QUOTA_BYTES, reserve: runReserve(state), kind: 'session' });
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
            const uncertain = run.phase === 'saving';
            run.status = uncertain ? 'uncertain' : 'interrupted';
            // A storage failure after a save checkpoint must leave that checkpoint in place.
            // It is safer to recover as uncertain than to risk a second clinical save.
            const storageMessage = uncertain
                ? 'Временное хранилище заполнилось во время сохранения. Состояние очереди оставлено неопределённым: проверьте текущую запись в БАРС, повторная отправка не выполнена.'
                : 'Недостаточно места во временном хранилище дневников. Отправка в БАРС не начата; черновики сохранены.';
            await checkpoint(run.phase, error instanceof StorageQuotaError ? storageMessage : publicError()).catch(() => undefined);
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
        assertRowIds(rows);
        if (message.fillOnly && rows.length !== 1) throw new Error('Для заполнения без сохранения выберите одну запись.');
        const savedIds = new Set((state.draft?.rows || []).filter(row => row.status === 'saved').map(row => row.id));
        if (rows.some(row => savedIds.has(row.id))) throw new Error('В очереди есть уже сохранённая запись.');
        // Reserve before probing/preparing BARS: rows are kept twice, and every future
        // receipt plus bounded technical trace must fit through the end of the queue.
        await assertRunFits(tabId, state, rows, !!message.fillOnly);
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
            await assertStorageWriteFits(chrome.storage.session, { [key(tabId)]: state }, { fallbackQuota: SESSION_FALLBACK_QUOTA_BYTES, reserve: runReserve(state), kind: 'session' });
            recordSaved(state, current, { verification: 'manual' });
            run.trace = [...(run.trace || []), compactTrace({ time: new Date().toISOString(), stage: 'Пользователь подтвердил сохранение в БАРС' }, (run.index || 0) + 1)].slice(-MAX_TRACE_ENTRIES);
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
        if (['draft', 'start', 'continue', 'clear'].includes(message.action)) await assertContext(tabId, message);
        if (message.action === 'load') {
            const stored = await chrome.storage.local.get([LIBRARY, SETTINGS]);
            const active = await activeContext();
            const state = await recover(tabId);
            return { state: active && active.tabId !== tabId && !protectedRun(state) ? null : state, library: stored[LIBRARY] ? Core.cleanLibrary(stored[LIBRARY]) : Core.emptyLibrary(), settings: stored[SETTINGS] || {} };
        }
        if (message.action === 'connect') return { state: await connect(tabId) };
        if (message.action === 'saveSettings') {
            const settings = Core.cleanSettings(message.settings);
            await setStorage(chrome.storage.local, { [SETTINGS]: settings }, { fallbackQuota: LOCAL_FALLBACK_QUOTA_BYTES, kind: 'settings' });
            return { settings };
        }
        if (message.action === 'saveLibrary') {
            const library = Core.cleanLibrary(message.library);
            await setStorage(chrome.storage.local, { [LIBRARY]: library }, { fallbackQuota: LOCAL_FALLBACK_QUOTA_BYTES, kind: 'local' });
            return { library };
        }
        if (message.action === 'draft') {
            if (running.has(tabId)) throw new Error('Во время отправки черновики недоступны для изменения.');
            const state = await recover(tabId) || { binding: null, patient: null, run: null };
            if (['uncertain', 'interrupted'].includes(state.run?.status)) throw new Error('Сначала завершите разбор предыдущей отправки.');
            const draft = message.draft;
            if (!draft || !Array.isArray(draft.rows) || draft.rows.length > Core.MAX_ROWS) throw new Error('Черновик слишком большой.');
            assertRowIds(draft.rows);
            // UI edits cannot clear receipt flags and accidentally re-send a saved row.
            const receipts = new Map((state.draft?.rows || []).filter(r => r.status === 'saved').map(r => [r.id, r]));
            for (const row of draft.rows) if (receipts.has(row.id)) Object.assign(row, { status: 'saved', recordId: receipts.get(row.id).recordId });
            const nextState = { ...state, draft };
            // A draft is accepted only when it can later hold a duplicated run, receipts
            // and trace. Failed writes leave the stored draft exactly as it was.
            await assertRunFits(tabId, nextState, draft.rows, false);
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
            if ((await activeContext())?.tabId === tabId) await chrome.storage.session.remove(ACTIVE);
            return { cleared: true };
        }
        throw new Error('Неизвестная команда дневников.');
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.namespace !== NS) return false;
        if (sender.id !== chrome.runtime.id || !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) {
            respond({ ok: false, error: 'Недопустимый источник команды.' }); return false;
        }
        const current = operations.catch(() => undefined).then(() => handle(message));
        operations = current;
        current.then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message || publicError(), ...(error?.code ? { code: error.code } : {}) }));
        return true;
    });
    chrome.tabs.onRemoved.addListener(tabId => {
        if (running.has(tabId)) running.get(tabId).stop = true;
        else chrome.storage.session.remove(key(tabId));
    });
})();
