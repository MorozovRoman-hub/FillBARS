(function (global) {
    'use strict';
    const VERSION = '1.0.2';
    const CARD = 'ArmPatientsInDep/hosp_history_new';
    function create({ window = global, foreground = window.__FillBARSCardPage, factory = window.FillBARSCardAdapter, timeout = 30000 } = {}) {
        let host, frame, driver, pending, busy = false, uncertain = false, dialog = false;
        const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
        function guard(context) {
            if (dialog) fail('background_dialog', 'БАРС запросил дополнительное подтверждение. Проверьте запись вручную.');
            if (foreground.patientContext().key !== context.key) fail('patient_changed', 'Исходная карточка пациента изменилась. Очередь остановлена.');
        }
        async function wait(check) {
            const end = Date.now() + timeout;
            while (Date.now() < end) {
                if (check()) return;
                await new Promise(resolve => window.setTimeout(resolve, 150));
            }
            fail('background_loading', 'Скрытая карточка БАРС не загрузилась. Проверьте вход и доступность БАРС.');
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
            frame.src = window.location.origin + '/';
            hostDocument.body.append(frame);
            await wait(() => frame.contentWindow.location.href === frame.src && frame.contentDocument.readyState === 'complete' && typeof frame.contentWindow.openWindow === 'function');
            const child = frame.contentWindow;
            child.alert = () => { dialog = true; };
            child.confirm = () => { dialog = true; return false; };
            child.prompt = () => { dialog = true; return null; };
            child.open = () => { dialog = true; return null; };
            guard(context);
            // BARS checks instanceof Object, so options must belong to its own realm.
            child.openWindow(child.JSON.parse(JSON.stringify({ name: CARD, vars })), true);
            driver = factory.create({ window: child, document: child.document, guard: () => guard(context) });
            await wait(() => {
                guard(context);
                try { return driver.patientContext().key === context.key; } catch { return false; }
            });
        }
        async function execute(request) {
            if (busy) return { ok: false, code: 'busy', message: 'Фоновая операция ещё выполняется.' };
            busy = true;
            try {
                if (request.action === 'probe') return await foreground.execute(request);
                if (request.action === 'release') {
                    if (uncertain && request.checkedInBars !== true) fail('save_uncertain', 'Сначала проверьте результат в списке осмотров БАРС.');
                    const result = await foreground.execute(request);
                    if (!result.ok) return result;
                    dispose(); uncertain = false;
                    return { ok: true, released: true };
                }
                if (uncertain) fail('save_uncertain', 'Результат предыдущей операции требует проверки в БАРС.');
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
                const prepared = await driver.execute({ ...pending, action: 'prepare' });
                if (!prepared.ok) fail('save_uncertain', 'Фоновая подготовка остановлена: ' + prepared.message + ' Проверьте список осмотров перед повтором.');
                guard(pending.context);
                const result = await driver.execute({ ...pending, action: 'save' });
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
    const api = { version: VERSION, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!global.document || global.FillBARSHiddenAdapter?.version === VERSION) return;
    if (global.frameElement?.hasAttribute('data-fillbars-background')) return;
    global.FillBARSHiddenAdapter = api;
    global.__FillBARSCardPage = create({ foreground: global.FillBARSCardAdapter.create() });
})(typeof window !== 'undefined' ? window : globalThis);
