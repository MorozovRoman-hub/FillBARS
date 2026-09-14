(function (global) {
    'use strict';
    const VERSION = '1.0.2';
    if (global.FillBARSCardAdapter?.version === VERSION) return;
    const FIELD_NAMES = ['VISIT_DATE', 'VISIT_TIME', 'TEMPERATURE', 'AD', 'THSS', 'THD', 'S_DNEVNIK', 'STAC_PLAN', 'RECOMEND_CONS'];
    const EDITOR = '[cmptype="Form"][formname="UniversalTemplate/UniversalTemplate"]';
    const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const compact = value => normalize(value).toLowerCase().replace(/[^а-яёa-z0-9]/g, '');
    class AdapterError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    }
    function create({ document = global.document, window = global, timeout = 18000, interval = 140, settleMs = 700, isVisible } = {}) {
        let trace = [];
        const record = (stage, details = {}) => {
            trace.push({ time: new Date().toISOString(), stage, ...details });
            if (trace.length > 80) trace.shift();
        };
        const pause = () => new Promise(resolve => window.setTimeout(resolve, interval));
        const visible = isVisible || (el => {
            if (!el?.isConnected) return false;
            const rect = el.getBoundingClientRect();
            const css = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility !== 'hidden';
        });
        const fail = (code, message) => { throw new AdapterError(code, message); };
        const all = (root, selector) => Array.from(root.querySelectorAll(selector));
        const unique = (items, code, message, optional = false) => {
            if (items.length === 1) return items[0];
            if (!items.length && optional) return null;
            return fail(code, message);
        };
        const wait = async (predicate, message) => {
            const end = Date.now() + timeout;
            do {
                const result = predicate();
                if (result) return result;
                await new Promise(resolve => window.setTimeout(resolve, interval));
            } while (Date.now() < end);
            fail('timeout', message);
        };
        function exactText(root, label) {
            const matches = all(root, 'button,a,span,div,td,[cmptype="Button"]').filter(el => visible(el) && normalize(el.textContent) === label);
            return matches.filter(el => !matches.some(other => other !== el && el.contains(other)));
        }
        function clickText(root, label, pattern) {
            let candidates = exactText(root, label);
            if (pattern) {
                candidates = all(root, 'span,a,button,td,div').filter(el => visible(el) && pattern.test(normalize(el.textContent)));
                candidates = candidates.filter(el => !candidates.some(other => other !== el && el.contains(other)));
            }
            const element = unique(candidates, 'ambiguous_action', 'Не удалось однозначно найти «' + label + '». Откройте нужное окно БАРС вручную.');
            element.click();
            return element;
        }
        function pageFor(element) {
            for (let node = element; node; node = node.parentElement) {
                for (const page of [node.form?.page, node.jsParent?.page, node.DForm?.page, node.D3Form?.page, node.page]) {
                    if (page && !page.destroyed) return page;
                }
            }
            const owns = page => [page?.d3Form?.DOM, page?.form?.containerForm, page?.form?.container?.getContainer?.()].some(node => node?.contains?.(element));
            const pages = [...(Array.isArray(window.SYS_pages_window) ? window.SYS_pages_window : []), ...(Array.isArray(window.SYS_pages) ? window.SYS_pages : [])];
            return pages.filter(owns).at(-1) || null;
        }
        function inPage(page, callback) {
            if (page && typeof window.addStackPage === 'function' && typeof window.removeStackPage === 'function') {
                window.addStackPage(page);
                try { return callback(); } finally { window.removeStackPage(); }
            }
            return callback();
        }
        function caption(card, name) {
            const nodes = all(card, '[name="' + name + '"],[data="caption:' + name + '"]');
            const values = [...new Set(nodes.map(el => normalize(el.value || el.textContent)).filter(Boolean))];
            if (values.length === 1) return values[0];
            const page = pageFor(card);
            if (typeof page?.getCaption === 'function') return normalize(page.getCaption(name));
            return '';
        }
        function patientContext() {
            const card = unique(all(document, '.hosp_history_new').filter(visible), 'patient_card', 'Оставьте открытой одну карточку пациента в БАРС.');
            const fullName = caption(card, 'PAT_FIO');
            const birth = caption(card, 'PAT_BDATE').match(/\d{2}\.\d{2}\.\d{4}/)?.[0] || '';
            const history = caption(card, 'HH_PREF_NUMB');
            if (!fullName || !birth || !history || !/\d/.test(history)) fail('patient_identity', 'Не удалось прочитать ФИО, дату рождения и номер истории из одной карточки. Заполнение остановлено.');
            return { card, fullName, birth, history, key: [compact(fullName), birth, compact(history)].join('|') };
        }
        function checkContext(expected) {
            const context = patientContext();
            if (!expected?.key || context.key !== expected.key) fail('patient_changed', 'Карточка пациента или госпитализация изменилась. Откройте нужную карточку и начните новый черновик.');
            return context;
        }
        function editor(optional = false) {
            return unique(all(document, EDITOR).filter(visible), 'editor_count', 'Нужно одно окно дневника. Закройте лишние окна приёмов.', optional);
        }
        function fieldMap(form) {
            const entries = FIELD_NAMES.map(name => {
                const control = unique(all(form, '[template_field="' + name + '"]'), 'field_structure', 'Структура дневника изменилась: не найдено единственное поле ' + name + '.');
                const selector = ['S_DNEVNIK', 'STAC_PLAN', 'RECOMEND_CONS'].includes(name) ? 'textarea' : 'input:not([type="hidden"])';
                const input = unique(control.matches(selector) ? [control] : all(control, selector), 'field_structure', 'Неоднозначное поле ' + name + '.');
                if (input.disabled || input.readOnly) fail('readonly', 'Поле ' + name + ' недоступно для изменения.');
                return [name, { control, input }];
            });
            return Object.fromEntries(entries);
        }
        function windowRoot(form) {
            return form.closest('.window') || form.closest('[role="dialog"]') || form.parentElement;
        }
        function editorHeading(form) {
            // Some BARS windows put the caption outside the inner .window container.
            // Exclude form contents: an inherited diary is not patient identity evidence.
            for (let shell = form.parentElement; shell && shell !== document.body; shell = shell.parentElement) {
                if (shell.querySelector('.hosp_history_new') || all(shell, EDITOR).length !== 1) break;
                const copy = shell.cloneNode(true);
                all(copy, EDITOR).forEach(node => node.remove());
                const text = normalize(copy.textContent);
                if (/(Добавление|Редактирование)\s+при[её]ма/i.test(text)) return text;
            }
            return '';
        }
        function controlText(control) {
            if (!control) return '';
            const selects = control.matches('select') ? [control] : all(control, 'select');
            if (selects.length === 1) return normalize(Array.from(selects[0].selectedOptions).map(option => option.textContent).join(' '));
            const inputs = control.matches('input:not([type="hidden"])') ? [control] : all(control, 'input:not([type="hidden"])');
            if (inputs.length === 1) return normalize(inputs[0].value);
            if (inputs.length > 1 || selects.length > 1) fail('control_ambiguous', 'Реквизиты приёма неоднозначны. Заполнение остановлено.');
            return normalize(control.textContent);
        }
        function editorFacts(form, context) {
            const service = form.querySelector('[name="Ctrl_SERVICE"]');
            const disease = form.querySelector('[name="Ctrl_DISEASECASES"]');
            const heading = editorHeading(form);
            const serviceValue = controlText(service), caseText = controlText(disease);
            return { heading, serviceValue, caseText, summary: {
                serviceControl: service?.tagName || 'missing', caseControl: disease?.tagName || 'missing',
                serviceReady: !!serviceValue, serviceMatches: serviceValue === 'Дневник врача',
                headingReady: !!heading, nameMatches: !!heading && compact(heading).includes(compact(context.fullName)),
                caseReady: !!caseText, historyMatches: !!caseText && compact(caseText).includes(compact(context.history)),
                fields: FIELD_NAMES.filter(name => form.querySelector('[template_field="' + name + '"]')).length
            } };
        }
        function assertEditor(form, context, mustBeNew) {
            const facts = editorFacts(form, context);
            if (mustBeNew && /Редактирование\s+при[её]ма/i.test(facts.heading)) fail('existing_editor', 'Открыт редактор существующего приёма. Для заполнения нужен новый дневник.');
            if (!facts.summary.serviceReady || !facts.summary.headingReady || !facts.summary.caseReady) fail('editor_loading', 'БАРС ещё не загрузил услугу, пациента или историю болезни.');
            if (!facts.summary.serviceMatches) fail('wrong_service', 'В открытом приёме указана другая услуга. Автоматически заполняется только «Дневник врача».');
            if (!facts.summary.nameMatches || !facts.summary.historyMatches) fail('editor_patient', !facts.summary.nameMatches ? 'ФИО в заголовке приёма не совпадает с карточкой. Поля не сохранены.' : 'История болезни в выбранном случае приёма не совпадает с карточкой. Поля не сохранены.');
            return fieldMap(form);
        }
        async function readyEditor(context, mustBeNew, expectedForm = null) {
            record('Ожидание загрузки приёма');
            const end = Date.now() + timeout;
            let signature = '', stableSince = 0, lastError = null, lastFacts = {};
            do {
                checkContext(context);
                const form = editor(true);
                if (expectedForm && form !== expectedForm) fail('editor_changed', 'Окно приёма изменилось во время подготовки.');
                if (form) {
                    try {
                        const map = assertEditor(form, context, mustBeNew);
                        if (form.getAttribute('aria-busy') === 'true') fail('editor_loading', 'Форма БАРС ещё загружается.');
                        lastError = null;
                        lastFacts = editorFacts(form, context).summary;
                        const current = JSON.stringify([editorHeading(form), ...Object.values(map).map(item => item.input.value)]);
                        if (current !== signature) { signature = current; stableSince = Date.now(); }
                        if (Date.now() - stableSince >= settleMs) {
                            record('Приём загружен', editorFacts(form, context).summary);
                            return form;
                        }
                    } catch (error) {
                        if (!['editor_loading', 'wrong_service', 'editor_patient', 'field_structure', 'readonly'].includes(error.code)) throw error;
                        lastError = error; signature = ''; stableSince = 0;
                        lastFacts = editorFacts(form, context).summary;
                    }
                }
                await pause();
            } while (Date.now() < end);
            record('Готовность приёма не подтверждена', { ...lastFacts, code: lastError?.code || 'editor_unstable' });
            if (lastError) throw lastError;
            fail('editor_unstable', 'Приём ещё загружается или его поля продолжают изменяться. Заполнение остановлено без сохранения.');
        }
        function listGrids() {
            return all(document, '[name="GRID_DIRECTION_OBSERVATIONS"][cmptype="Grid"]')
                .filter(el => visible(el) && !el.closest(EDITOR) && el.closest('.window, [role="dialog"]'));
        }
        function listGrid(optional = false) {
            return unique(listGrids(), 'inspection_list', 'Откройте одно окно «Осмотры» из карточки пациента.', optional);
        }
        function rows(grid = listGrid()) {
            return all(grid, '[cmptype="GridRow"]').filter(el => visible(el) && (el.getAttribute('keyvalue') || el.querySelector('[item_value]')))
                .map(el => ({ el, id: el.getAttribute('keyvalue') || el.querySelector('[item_value]').getAttribute('item_value'), text: normalize(el.textContent) }));
        }
        const matchesRow = (entry, row) => entry.text.includes('Дневник врача') && entry.text.includes(row.date.split('-').reverse().join('.')) && entry.text.includes(row.time);
        async function ensureList(context) {
            let grid = listGrid(true);
            if (!grid) {
                checkContext(context);
                clickText(context.card, 'Осмотры', /^Осмотры(?:\s*\(\d+\))?$/);
                grid = await wait(() => listGrid(true), 'Окно «Осмотры» не открылось. Откройте его вручную и повторите подготовку.');
            }
            checkContext(context);
            return grid;
        }
        async function ensureNew(context) {
            let form = editor(true);
            if (form) return readyEditor(context, true, form);
            const grid = await ensureList(context);
            const scope = grid.closest('[cmptype="Form"]') || windowRoot(grid);
            clickText(scope, 'Провести осмотр');
            record('Открыт выбор услуги');
            const selection = await wait(() => {
                const entries = all(document, 'tr[cmptype="GridRow"]').filter(el => visible(el) && !el.closest('[name="GRID_DIRECTION_OBSERVATIONS"]') && Array.from(el.querySelectorAll('td,span')).some(cell => normalize(cell.textContent) === 'Дневник врача'));
                return entries.length ? unique(entries, 'service_ambiguous', 'В выборе услуги несколько одинаковых дневников. Выберите нужный вручную.') : null;
            }, 'Не найден «Дневник врача» в выборе услуг. Откройте новый приём вручную.');
            checkContext(context);
            selection.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
            selection.click();
            selection.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, button: 0 }));
            record('Выбрана услуга «Дневник врача»');
            form = await wait(() => editor(true), 'Окно добавления дневника не открылось. Откройте его вручную.');
            return readyEditor(context, true, form);
        }
        function readFields(form) {
            return Object.fromEntries(Object.entries(fieldMap(form)).map(([name, entry]) => [name, entry.input.value.replace(/\r\n/g, '\n')]));
        }
        function sameFields(actual, expected) {
            return FIELD_NAMES.every(name => actual[name] === String(expected[name]).replace(/\r\n/g, '\n'));
        }
        function setFields(form, values) {
            const map = fieldMap(form);
            const page = pageFor(form);
            inPage(page, () => {
                for (const name of FIELD_NAMES) {
                    const { control, input } = map[name];
                    const value = String(values[name]);
                    if (typeof page?.setValue === 'function') page.setValue(control.getAttribute('name'), value);
                    if (input.value !== value) {
                        const prototype = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
                    }
                    input.dispatchEvent(new window.Event('input', { bubbles: true }));
                    input.dispatchEvent(new window.Event('change', { bubbles: true }));
                    input.dispatchEvent(new window.FocusEvent('blur', { bubbles: true }));
                }
            });
            if (!sameFields(readFields(form), values)) fail('fill_mismatch', 'БАРС изменил или не принял часть значений. Проверьте открытый приём; он не сохранён.');
        }
        async function replaceFields(form, context, values) {
            const end = Date.now() + timeout;
            let replaced = 0;
            do {
                assertEditor(form, checkContext(context), true);
                setFields(form, values);
                record('Все девять полей заменены', { attempt: ++replaced });
                const stableSince = Date.now();
                do {
                    await pause();
                    assertEditor(form, checkContext(context), true);
                    if (!sameFields(readFields(form), values)) break;
                    if (Date.now() - stableSince >= settleMs) {
                        record('Заполненные поля проверены', { fieldCount: FIELD_NAMES.length });
                        return;
                    }
                } while (Date.now() < end);
                record('БАРС изменил поля после заполнения', { changedFields: FIELD_NAMES.filter(name => readFields(form)[name] !== String(values[name]).replace(/\r\n/g, '\n')) });
            } while (replaced < 3 && Date.now() < end);
            fail('fill_unstable', 'БАРС продолжает подставлять данные после заполнения. Очередь остановлена без сохранения.');
        }
        let prepared = null;
        let busy = false;
        let activeRun = null;
        async function probe() {
            const context = patientContext();
            const form = editor(true);
            // Connection identifies the patient card. A partially loaded editor is checked during prepare.
            return { patient: { fullName: context.fullName, birth: context.birth, history: context.history, key: context.key }, hasEditor: !!form, newEditor: !!form && /Добавление\s+при[её]ма/i.test(editorHeading(form)), fieldCount: form ? FIELD_NAMES.filter(name => form.querySelector('[template_field="' + name + '"]')).length : 0 };
        }
        async function prepare(request) {
            const context = checkContext(request.context);
            if (activeRun && activeRun !== request.runId) fail('other_run', 'На этой странице осталась другая подготовленная запись. Проверьте её вручную.');
            const grid = await ensureList(context);
            if (rows(grid).some(entry => matchesRow(entry, request.row))) fail('duplicate', 'В открытом списке уже есть дневник на эту дату и время. Проверьте его перед повторной записью.');
            const before = rows(grid).map(entry => entry.id);
            const form = await ensureNew(context);
            checkContext(request.context);
            assertEditor(form, context, true);
            await replaceFields(form, request.context, request.values);
            activeRun = request.runId;
            prepared = { runId: request.runId, rowId: request.row.id, form, before, values: { ...request.values }, context: request.context, row: request.row, attempted: false };
            return { prepared: true, fieldCount: FIELD_NAMES.length };
        }
        async function save(request) {
            if (!prepared || prepared.runId !== request.runId || prepared.rowId !== request.row.id || !prepared.form.isConnected || prepared.attempted) fail('not_prepared', 'Нет однозначно подготовленного нового дневника. Сохранение не выполнялось.');
            const item = prepared;
            const context = checkContext(item.context);
            if (editor() !== item.form) fail('editor_changed', 'Окно приёма изменилось. Сохранение остановлено.');
            assertEditor(item.form, context, true);
            if (!sameFields(readFields(item.form), item.values)) fail('edited_after_preview', 'Данные в БАРС изменились после подготовки. Проверьте запись заново.');
            const button = unique(all(item.form, '[name="Btn_SaveClose"][cmptype="Button"]').filter(visible), 'save_button', 'Не найдена кнопка «Сохранить».');
            if (button.getAttribute('enabled') === 'false' || /ctrl_disable|btn-disable/.test(button.className)) fail('save_disabled', 'БАРС пока не разрешает сохранить приём.');
            item.attempted = true;
            let stage = 'save_click';
            let observed = {};
            try {
                record('Нажата штатная кнопка сохранения');
                inPage(pageFor(item.form), () => button.click());
                stage = 'wait_close';
                await wait(() => !item.form.isConnected || !visible(item.form), 'Окно не закрылось после сохранения.');
                record('Окно закрылось после сохранения');
                stage = 'wait_list';
                checkContext(item.context);
                const saved = await wait(() => {
                    checkContext(item.context);
                    const grid = listGrid(true);
                    const visibleRows = grid ? rows(grid) : [];
                    const newRows = visibleRows.filter(entry => !item.before.includes(entry.id));
                    const candidates = newRows.filter(entry => matchesRow(entry, item.row));
                    observed = { listReady: !!grid, rows: visibleRows.length, newRows: newRows.length, matchingRows: candidates.length };
                    if (candidates.length > 1) fail('multiple_results', 'После сохранения появилось несколько подходящих строк.');
                    return candidates[0];
                }, 'Новая строка дневника не появилась в списке.');
                checkContext(item.context);
                // The list confirms creation, not a reread of persisted contents.
                // All nine fields were checked immediately before the save click.
                prepared = null;
                activeRun = null;
                record('Новый дневник найден в списке осмотров', { ...observed, verification: 'list' });
                return { saved: true, verified: true, verification: 'list', recordId: saved.id };
            } catch (error) {
                record('Подтверждение сохранения не получено', { at: stage, cause: error.code || 'adapter_error', ...observed });
                fail('save_uncertain', 'Сохранение отправлено, но появление дневника в списке не подтверждено. Проверьте текущую запись в БАРС. Если она сохранена, нажмите «Запись сохранена — продолжить». ' + (error.code === 'patient_changed' ? 'Изменилась карточка пациента.' : ''));
            }
        }
        async function execute(request) {
            if (busy) return { ok: false, code: 'busy', message: 'Другая операция с дневником ещё выполняется.' };
            busy = true;
            trace = [];
            record('Начало операции', { action: request.action });
            try {
                let result;
                if (request.action === 'probe') result = await probe();
                else if (request.action === 'prepare') result = await prepare(request);
                else if (request.action === 'save') result = await save(request);
                else if (request.action === 'release') {
                    if (prepared?.attempted && request.checkedInBars !== true) fail('save_uncertain', 'Сначала проверьте результат сохранения вручную.');
                    prepared = null; activeRun = null; result = { released: true };
                } else fail('action', 'Неизвестная операция.');
                return { ok: true, ...result, trace };
            } catch (error) {
                record('Операция остановлена', { code: error.code || 'adapter_error' });
                return { ok: false, code: error.code || 'adapter_error', message: error instanceof AdapterError ? error.message : 'Не удалось выполнить действие в БАРС. Проверьте открытое окно; повторное сохранение не выполнялось.', trace };
            } finally { busy = false; }
        }
        return { execute, probe, fieldMap, patientContext, readFields, sameFields };
    }
    const api = { version: VERSION, create, FIELD_NAMES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    global.FillBARSCardAdapter = api;
    if (global.document) global.__FillBARSCardPage = create();
})(typeof window !== 'undefined' ? window : globalThis);
