(function (global) {
    'use strict';
    const VERSION = '1.3.1';
    const CARD = 'ArmPatientsInDep/hosp_history_new';
    function entryUrl(href, baseURI = href) {
        const origin = new URL(href).origin, base = new URL(baseURI, href);
        if (base.origin !== origin) throw new Error('Фоновая среда должна находиться на том же сервере БАРС.');
        return new URL('./', base).href;
    }
    function entryDocumentMatches(actual, expected) {
        try {
            const documentUrl = new URL(actual), entry = new URL(expected);
            return documentUrl.origin === entry.origin && [entry.pathname, entry.pathname + 'index.php'].includes(documentUrl.pathname);
        } catch { return false; }
    }
    function create({ window = global, foreground = window.__FillBARSCardPage, factory = window.FillBARSCardAdapter, timeout = 30000, runtimeSettleMs = 300, diagnostic, beforeSave } = {}) {
        let host, frame, driver, pending, busy = false, uncertain = false, dialog = false;
        let workers = [];
        const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
        function guard(context) {
            if (dialog) fail('background_dialog', 'БАРС запросил дополнительное подтверждение. Проверьте запись вручную.');
            if (foreground.patientContext().key !== context.key) fail('patient_changed', 'Исходная карточка пациента изменилась. Очередь остановлена.');
        }
        async function wait(check, stage = 'card', snapshot = () => ({})) {
            const end = Date.now() + timeout;
            while (Date.now() < end) {
                if (check()) return;
                await new Promise(resolve => window.setTimeout(resolve, 150));
            }
            diagnostic?.('Истёк срок загрузки', { at: stage, ...snapshot() });
            fail('background_loading_' + stage, stage === 'runtime' ? 'Не загрузились сценарии БАРС в скрытой вкладке.' : stage === 'bootstrap' ? 'Начальная загрузка фоновой среды БАРС не завершилась. Сохранение не запускалось.' : 'Не удалось прочитать пациента из скрытой карточки.');
        }
        function dispose() {
            host?.remove(); host = null; frame = null; driver = null; pending = null; dialog = false;
        }
        async function initialize(context) {
            guard(context);
            if (driver) return;
            const pages = [...(window.SYS_pages || []), ...(window.SYS_pages_window || [])];
            const candidates = pages.filter(p => p?.form?.name === CARD && p.form.containerForm?.contains(foreground.patientContext().card));
            if (candidates.length !== 1) fail('background_context', 'Не удалось определить реквизиты открытой госпитализации.');
            const vars = Object.fromEntries(['HH_ID', 'HH_DEP_ID', 'HH_VIEW_MODE'].map(key => [key, candidates[0].form.getVar(key)]).filter(([, value]) => value !== null && value !== undefined && value !== ''));
            // PATIENT_ID belongs to the observations workflow and can be unset in
            // a freshly opened card. Let BARS initialize it from the admission.
            const missing = ['HH_ID', 'HH_DEP_ID'].filter(key => !vars[key]);
            if (missing.length) fail('background_context', 'В карточке не хватает реквизитов госпитализации: ' + missing.join(', ') + '. Дождитесь загрузки карточки.');
            // BARS DLoading addresses its immediate parent's spinner, including
            // during bootstrap. A private parent isolates both show AND hide;
            // the real tab's spinner and pending requests remain untouched.
            host = window.document.createElement('iframe');
            host.setAttribute('data-fillbars-background', VERSION);
            host.setAttribute('aria-hidden', 'true');
            host.tabIndex = -1;
            host.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
            host.style.cssText = 'position:fixed!important;left:-20000px!important;top:0!important;width:1440px!important;height:1000px!important;opacity:0!important;pointer-events:none!important;border:0!important;';
            window.document.body.append(host);
            const hostDocument = host.contentDocument;
            const spinner = hostDocument.createElement('spinner-ctrl');
            spinner.show = () => { spinner.setAttribute('aria-busy', 'true'); };
            spinner.hide = () => { spinner.setAttribute('aria-busy', 'false'); };
            hostDocument.body.append(spinner);
            // Preserve the existing native-app bridge without sharing UI loaders.
            host.contentWindow.D3Api = { misDesktopApp: window.D3Api?.misDesktopApp };
            frame = hostDocument.createElement('iframe');
            frame.setAttribute('data-fillbars-background', VERSION);
            frame.setAttribute('data-fillbars-worker', VERSION);
            frame.tabIndex = -1;
            // Native dialogs, popups and top navigation are disallowed from first load.
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
            frame.style.cssText = 'width:1440px;height:1000px;border:0;';
            // Preserve the application's deployment directory; origin '/' may be
            // a different application when BARS lives under /mis/ or /bars/.
            frame.src = entryUrl(window.location.href, window.document.baseURI);
            hostDocument.body.append(frame);
            diagnostic?.('Ожидание среды БАРС');
            // A callable openWindow is only the first bootstrap stage. The main
            // container, theme and initial native forms are initialized later.
            await wait(() => entryDocumentMatches(frame.contentWindow.location.href, frame.src) && frame.contentDocument.readyState !== 'loading' && typeof frame.contentWindow.openWindow === 'function', 'runtime', () => ({
                readyState: frame.contentDocument.readyState,
                expectedLocation: entryDocumentMatches(frame.contentWindow.location.href, frame.src),
                openWindowAvailable: typeof frame.contentWindow.openWindow === 'function'
            }));
            diagnostic?.('Сценарии среды БАРС загружены');
            const child = frame.contentWindow;
            let startupErrors = 0, lastErrorType = '', loginRequired = false;
            child.addEventListener('error', event => {
                startupErrors++;
                const name = event.error?.name;
                lastErrorType = ['TypeError', 'ReferenceError', 'SyntaxError', 'NetworkError'].includes(name) ? name : 'Error';
            });
            if (diagnostic && child.XMLHttpRequest) {
                const proto = child.XMLHttpRequest.prototype, open = proto.open, send = proto.send;
                const metadata = new WeakMap(); let sequence = 0;
                proto.open = function(method, url, ...rest) {
                    let endpoint = '';
                    try { endpoint = new child.URL(url, child.location.href).pathname.split('/').pop(); } catch {}
                    metadata.set(this, ['getform.php', 'getdata.php', 'getmodule.php', 'request.php', 'action.php', 'getmultiaction.php'].includes(endpoint) ? endpoint : null);
                    return open.call(this, method, url, ...rest);
                };
                proto.send = function(...args) {
                    const endpoint = metadata.get(this);
                    if (endpoint) {
                        const requestNumber = ++sequence;
                        diagnostic('HTTP начало', { endpoint, requestNumber });
                        this.addEventListener('loadend', () => {
                            try {
                                const code = this.responseXML?.getElementsByTagName('ERROR_REQUEST')?.[0]?.textContent;
                                if (['ERROR_LOGIN_DB', 'ERROR_LOGIN_CLIENT', 'ERROR_LPU'].includes(code)) loginRequired = true;
                            } catch { /* Non-XML response. Do not read its contents. */ }
                            diagnostic('HTTP завершение', { endpoint, requestNumber, status: this.status });
                        }, { once: true });
                    }
                    return send.apply(this, args);
                };
            }
            child.alert = () => { dialog = true; };
            child.confirm = () => { dialog = true; return false; };
            child.prompt = () => { dialog = true; return null; };
            child.open = () => { dialog = true; return null; };
            const runtimeSnapshot = () => ({
                readyState: child.document.readyState,
                nativeRequests: Number(child.SYS_countRequests) || 0,
                nativeFormsLoading: Number(child.SYS_countShowState) || 0,
                d3Requests: Number(child.SysRequetD3Count) || 0,
                mainContainerReady: !!child.document.getElementById('_mainContainer'),
                d3ContainerReady: typeof child.D3Api?.init !== 'function' || !!child.D3Api.MainDom?.isConnected,
                startupErrors, lastErrorType
            });
            const assertSession = () => {
                guard(context);
                const pages = [...(child.SYS_pages || []), ...(child.SYS_pages_window || [])];
                if (loginRequired || pages.some(page => /^System\/(?:login(?:_new)?|run|lpu|cardreaderselect)$/.test(page?.form?.name || ''))) fail('background_login', 'Фоновая среда БАРС запросила вход или выбор учреждения. Проверьте действующую сессию в БАРС; сохранение не запускалось.');
            };
            let stableSince = null;
            await wait(() => {
                assertSession();
                const status = runtimeSnapshot();
                if (status.readyState !== 'complete' || !status.mainContainerReady || !status.d3ContainerReady || status.nativeRequests > 0 || status.nativeFormsLoading > 0 || status.d3Requests > 0) { stableSince = null; return false; }
                if (stableSince === null) stableSince = Date.now();
                return Date.now() - stableSince >= runtimeSettleMs;
            }, 'bootstrap', runtimeSnapshot);
            diagnostic?.('Среда БАРС готова', runtimeSnapshot());
            guard(context);
            // BARS checks instanceof Object, so options must belong to its own realm.
            const workerDocument = child.document;
            diagnostic?.('Открытие фоновой карточки');
            const openedPage = child.openWindow(child.JSON.parse(JSON.stringify({ name: CARD, vars })), true);
            diagnostic?.('Запрос фоновой карточки выполнен', { pageReturned: !!openedPage, correctFormName: openedPage?.form?.name === CARD });
            driver = factory.create({ window: child, document: child.document, guard: () => guard(context) });
            let identityError = '';
            await wait(() => {
                assertSession();
                if (child.document !== workerDocument) fail('background_navigation', 'Среда БАРС перезагрузилась во время открытия карточки. Откройте дневники заново; сохранение не запускалось.');
                try { const matches = driver.patientContext().key === context.key; identityError = matches ? '' : 'identity_mismatch'; return matches; } catch (error) { identityError = error.code || 'identity_unavailable'; return false; }
            }, 'card', () => ({ cardCount: child.document.querySelectorAll('.hosp_history_new').length, identityError, pageReturned: !!openedPage, pageDestroyed: !!openedPage?.destroyed, ...runtimeSnapshot() }));
            diagnostic?.('Карточка и пациент проверены');
        }
        async function execute(request) {
            if (busy) return { ok: false, code: 'busy', message: 'Фоновая операция ещё выполняется.' };
            busy = true;
            try {
                if (request.action === 'probe') return await foreground.execute(request);
                if (request.action === 'release') {
                    if (uncertain && request.checkedInBars !== true) fail('save_uncertain', 'Сначала проверьте результат в списке осмотров БАРС.');
                    for (const worker of workers) {
                        const released = await worker.execute(request);
                        if (!released.ok) return released;
                    }
                    workers = [];
                    const result = await foreground.execute(request);
                    if (!result.ok) return result;
                    dispose(); uncertain = false;
                    return { ok: true, released: true };
                }
                if (uncertain) fail('save_uncertain', 'Результат предыдущей операции требует проверки в БАРС.');
                if (request.action === 'parallel') {
                    if (!Array.isArray(request.items) || request.items.length < 1 || request.items.length > 3 || workers.length || pending) fail('parallel_input', 'Группа должна содержать от одного до трёх дневников.');
                    const size = request.items.length;
                    const trace = [], counts = [0, 0, 0], saving = [false, false, false];
                    const emit = (row, stage, details = {}) => {
                        if (stage === 'Открытие фоновой карточки') counts[row - 1] = 0;
                        if (stage === 'Запуск сохранения') { saving[row - 1] = true; counts[row - 1] = 0; }
                        if (stage.startsWith('HTTP ') && counts[row - 1]++ >= (saving[row - 1] ? 40 : 8)) return;
                        trace.push({ time: new Date().toISOString(), row, stage, ...details });
                    };
                    let arrived = 0, aborted = false, resolveBarrier;
                    const barrier = new Promise(resolve => { resolveBarrier = resolve; });
                    const meet = async ok => { aborted ||= !ok; if (++arrived === size) resolveBarrier(); await barrier; return !aborted; };
                    let loaded = 0, loadFailed = false, resolveLoad;
                    const loadBarrier = new Promise(resolve => { resolveLoad = resolve; });
                    const meetLoaded = async ok => { loadFailed ||= !ok; if (++loaded === size) resolveLoad(); await loadBarrier; return !loadFailed; };
                    uncertain = true; // Parent cannot be retried after any worker starts.
                    const results = await Promise.all(request.items.map(async (item, index) => {
                        let reached = false;
                        const log = (stage, details) => emit(index + 1, stage, details);
                        const worker = create({ window, foreground, factory, timeout, runtimeSettleMs, diagnostic: log, beforeSave: async () => {
                            reached = true; log('Готов к сохранению');
                            if (!await meet(true)) fail('parallel_aborted', 'Один из дневников не подготовлен. Сохранение группы отменено.');
                            log('Запуск сохранения');
                        } });
                        workers.push(worker);
                        try {
                            log('Начало параллельной подготовки');
                            const prepared = await worker.execute({ ...item, action: 'prepare' });
                            if (!prepared.ok) log('Подготовка остановлена', { code: prepared.code });
                            if (!await meetLoaded(prepared.ok)) {
                                await worker.execute({ action: 'release' });
                                log('Группа остановлена до создания осмотров');
                                return { rowId: item.row.id, ok: false, noWrites: true, code: prepared.code || 'parallel_preflight' };
                            }
                            log('Все карточки группы готовы — начало оформления');
                            const result = await worker.execute({ ...item, action: 'save' });
                            for (const entry of result.trace || []) log(entry.stage, { adapterTime: entry.time });
                            log(result.verified ? 'Результат подтверждён' : 'Результат требует проверки');
                            return { rowId: item.row.id, ...result };
                        } finally { if (!reached) void meet(false); }
                    }));
                    const noWrites = results.every(result => result.noWrites);
                    uncertain = !noWrites && !results.every(result => result.ok && result.verified);
                    if (!uncertain) workers = [];
                    return { ok: true, results, trace, uncertain, noWrites };
                }
                if (request.fillOnly) return await foreground.execute(request);
                if (request.action === 'prepare') {
                    if (pending) fail('busy', 'Уже подготовлен фоновый дневник.');
                    await initialize(request.context);
                    pending = JSON.parse(JSON.stringify(request));
                    // No direction is created until the worker persists phase=saving.
                    return { ok: true, prepared: true, background: true };
                }
                if (request.action !== 'save' || !pending || pending.runId !== request.runId || pending.row.id !== request.row.id || JSON.stringify(pending.values) !== JSON.stringify(request.values)) {
                    fail('not_prepared', 'Нет подготовленного фонового дневника.');
                }
                guard(pending.context);
                uncertain = true;
                diagnostic?.('Начало создания и заполнения осмотра');
                const prepared = await driver.execute({ ...pending, action: 'prepare' });
                for (const entry of prepared.trace || []) diagnostic?.(entry.stage, { adapterTime: entry.time, ...(entry.code ? { code: entry.code } : {}) });
                if (!prepared.ok) diagnostic?.('Причина остановки подготовки', { code: prepared.code, message: prepared.message });
                if (!prepared.ok) fail('save_uncertain', 'Фоновая подготовка остановлена: ' + prepared.message + ' Проверьте список осмотров перед повтором.');
                diagnostic?.('Поля заполнены и проверены', { fieldCount: prepared.fieldCount });
                if (beforeSave) await beforeSave();
                guard(pending.context);
                const result = await driver.execute({ ...pending, action: 'save' });
                if (result.saved && !result.verified) return { ...result, background: true };
                if (!result.ok || !result.verified) fail('save_uncertain', result.message || 'Сохранение не подтверждено. Проверьте список осмотров.');
                uncertain = false;
                dispose();
                return { ...result, background: true };
            } catch (error) {
                if (!uncertain) dispose();
                return { ok: false, code: uncertain ? 'save_uncertain' : (error.code || 'background_error'), message: error.code ? error.message : 'Не удалось выполнить фоновую операцию. Проверьте БАРС.' };
            } finally { busy = false; }
        }
        return { execute };
    }
    const api = { version: VERSION, create, entryUrl, entryDocumentMatches };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!global.document || global.FillBARSHiddenAdapter?.version === VERSION) return;
    if (global.frameElement?.hasAttribute('data-fillbars-background')) return;
    global.FillBARSHiddenAdapter = api;
    global.__FillBARSCardPage = create({ foreground: global.FillBARSCardAdapter.create() });
})(typeof window !== 'undefined' ? window : globalThis);
