(async function runResearchOrderFixture() {
    'use strict';

    const TOTAL_RESEARCHES = 152;
    const TARGET_PAGE_SIZE = 150;
    const TARGETS = ['RS-001', 'RS-149', 'RS-151', 'RS-999'];
    const INSERT_DELAY_MS = 650;
    const host = document.getElementById('fixture-host');
    const status = document.getElementById('status');
    const results = document.getElementById('results');
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, timeout = 4000, interval = 25) => {
        const startedAt = performance.now();
        while (performance.now() - startedAt < timeout) {
            const value = predicate();
            if (value) {
                return value;
            }
            await sleep(interval);
        }
        return null;
    };

    const assertions = [];
    const assert = (condition, message, details = null) => {
        if (!condition) {
            const suffix = details === null ? '' : `\n${JSON.stringify(details, null, 2)}`;
            throw new Error(`${message}${suffix}`);
        }
        assertions.push(message);
    };

    const createElement = (tagName, attributes = {}, text = '') => {
        const element = document.createElement(tagName);
        for (const [name, value] of Object.entries(attributes)) {
            element.setAttribute(name, String(value));
        }
        if (text) {
            element.textContent = text;
        }
        return element;
    };

    const createScenario = (variant, options = {}) => {
        host.replaceChildren();

        const metrics = {
            variant,
            checkboxClicks: new Map(),
            citoClicks: new Map(),
            insertedAt: new Map(),
            nextRequestedAt: [],
            assignClicks: 0,
            pageTransitions: 0,
            groupOnChangeCalls: 0,
            stackAdds: 0,
            stackRemoves: 0,
            stackDepth: 0
        };
        const selectedIds = new Set(['RS-001']);
        const allIds = Array.from({ length: TOTAL_RESEARCHES }, (_, index) => {
            return `RS-${String(index + 1).padStart(3, '0')}`;
        });

        const decoy = createElement('section', { class: 'dirline_order_alt fixture-decoy' });
        decoy.append(createElement('div', { name: 'GridGroups' }));
        decoy.append(createElement('div', { name: 'GridResearch' }));
        host.append(decoy);

        const windowRoot = createElement('section', { class: 'window WinContent showed' });
        const form = createElement('div', {
            cmptype: 'Form',
            class: 'd3form dirline_order_alt',
            'data-variant': variant
        });
        const groups = createElement('table', { name: 'GridGroups', activ_keyvalue: 'PROFILES' });
        const groupsBody = document.createElement('tbody');
        const profilesRow = createElement('tr', { cmptype: 'GridRow', keyvalue: 'PROFILES', class: 'active' });
        profilesRow.append(createElement('td', {}, 'Профили'));
        const allRow = createElement('tr', { cmptype: 'GridRow', keyvalue: 'ALL_RES' });
        allRow.append(createElement('td', {}, 'Все исследования'));
        groupsBody.append(profilesRow, allRow);
        groups.append(groupsBody);

        const researchGrid = createElement('div', { name: 'GridResearch' });
        const range = variant === 'd3'
            ? createElement('div', { cmptype: 'Range', class: 'ctrl_range' })
            : createElement('table', {
                cmptype: 'Range',
                name: 'rangeResearch',
                page_number: 1,
                row_count: TOTAL_RESEARCHES,
                valuecount: 50
            });
        const rangeContent = variant === 'd3' ? range : createElement('td');
        if (variant === 'legacy') {
            const row = document.createElement('tr');
            row.append(rangeContent);
            range.append(row);
        }
        const pageSizeLabel = createElement('span', { title: 'записей' }, '50');
        const pageText = createElement('span', { class: 'page-text' }, 'стр. 1 из 4');
        const nextButton = createElement('button', {
            type: 'button',
            class: variant === 'd3' ? 'ctrl_range_go_next' : 'next_page'
        }, 'Следующая');
        if (variant === 'd3') {
            nextButton.setAttribute('onclick', 'D3Api.RangeCtrl.go(this.closest(\'[cmptype="Range"]\'), 1)');
        } else {
            nextButton.setAttribute('onclick', 'RangeGotoNextPage(this)');
        }
        rangeContent.append(pageSizeLabel, document.createTextNode(' · '), pageText, document.createTextNode(' · '), nextButton);

        const list = createElement('div', { class: 'research-list' });
        researchGrid.append(range, list);

        const dirline = createElement('table', { name: 'GridDirline' });
        const dirlineBody = document.createElement('tbody');
        const summaryRow = createElement('tr', { cmptype: 'TreeRow', 'data-kind': 'summary' });
        summaryRow.clone = { data: { RS_ID: null } };
        summaryRow._node = { data: summaryRow.clone.data };
        summaryRow.append(createElement('td', {}, 'Итого'));
        dirlineBody.append(summaryRow);

        const attachCitoControl = (row, itemValue) => {
            const cell = document.createElement('td');
            const cito = createElement('input', {
                type: 'checkbox',
                name: 'Cito'
            });
            cito.disabled = Array.isArray(options.disabledCitoIds)
                && options.disabledCitoIds.includes(itemValue);
            cito.addEventListener('click', () => {
                metrics.citoClicks.set(itemValue, (metrics.citoClicks.get(itemValue) || 0) + 1);
                row.clone.data.IS_CITO = cito.checked ? 1 : 0;
                row._node.data.IS_CITO = row.clone.data.IS_CITO;
            });
            cell.append(cito);
            row.append(cell);
            return cito;
        };

        const appendSelectedFixtureRow = ({ attributeValue, cloneValue, treeValue, text }) => {
            const row = createElement('tr', { cmptype: 'TreeRow' });
            if (attributeValue !== undefined) {
                row.setAttribute('rs_id_keyvalue', attributeValue);
            }
            row.clone = { data: { RS_ID: cloneValue } };
            row._node = { data: { RS_ID: treeValue } };
            row.append(createElement('td', {}, text));
            const itemValue = [attributeValue, cloneValue, treeValue]
                .map((value) => String(value ?? '').trim())
                .find((value) => value && !['on', 'null', 'undefined'].includes(value.toLowerCase()));
            if (itemValue) {
                attachCitoControl(row, itemValue);
            }
            dirlineBody.insertBefore(row, summaryRow);
            return row;
        };

        appendSelectedFixtureRow({ attributeValue: 'on', cloneValue: null, treeValue: undefined, text: 'invalid-on' });
        appendSelectedFixtureRow({ cloneValue: 'null', treeValue: null, text: 'invalid-null' });
        appendSelectedFixtureRow({ cloneValue: undefined, treeValue: 'undefined', text: 'invalid-undefined' });
        appendSelectedFixtureRow({ attributeValue: '', cloneValue: '', treeValue: '', text: 'invalid-empty' });
        appendSelectedFixtureRow({ cloneValue: '   ', treeValue: '   ', text: 'invalid-whitespace' });
        appendSelectedFixtureRow({ cloneValue: null, treeValue: undefined, text: 'invalid-js-null-undefined' });
        appendSelectedFixtureRow({ cloneValue: null, treeValue: 'RS-001', text: 'valid-tree-fallback' });
        dirline.append(dirlineBody);

        const assignButton = createElement('button', { type: 'button', name: 'SaveAction' }, 'Назначить');
        assignButton.addEventListener('click', () => {
            metrics.assignClicks++;
        });

        form.append(groups, researchGrid, dirline, assignButton);
        windowRoot.append(form);
        host.append(windowRoot);

        const getPageSize = () => variant === 'd3'
            ? range.D3Range.amount
            : Number.parseInt(range.getAttribute('valuecount'), 10);
        const getPage = () => variant === 'd3'
            ? range.D3Range.page
            : Number.parseInt(range.getAttribute('page_number'), 10);
        const getTotalPages = () => Math.max(1, Math.ceil(TOTAL_RESEARCHES / getPageSize()));
        const updateRangeView = () => {
            const page = getPage();
            const totalPages = getTotalPages();
            pageSizeLabel.textContent = String(getPageSize());
            pageText.textContent = `стр. ${page} из ${totalPages}`;
            nextButton.disabled = page >= totalPages;
            nextButton.setAttribute('aria-disabled', String(nextButton.disabled));
            if (variant === 'd3') {
                range.D3Range.pages = totalPages;
                range.D3Range.count = TOTAL_RESEARCHES;
            } else {
                range.setAttribute('row_count', String(TOTAL_RESEARCHES));
            }
        };
        const appendDirlineRow = (itemValue) => {
            const existingRow = Array.from(dirline.querySelectorAll('[cmptype="TreeRow"]'))
                .find((row) => String(row.clone?.data?.RS_ID || '') === itemValue);
            if (existingRow) {
                return;
            }
            const row = createElement('tr', {
                cmptype: 'TreeRow'
            });
            row.clone = { data: { RS_ID: itemValue } };
            row._node = { data: row.clone.data };
            if (itemValue === 'RS-001') {
                row.setAttribute('rs_id_keyvalue', 'null');
            }
            row.append(createElement('td', {}, itemValue));
            attachCitoControl(row, itemValue);
            dirlineBody.insertBefore(row, summaryRow);
            selectedIds.add(itemValue);
            metrics.insertedAt.set(itemValue, performance.now());
        };
        const renderPage = () => {
            const pageSize = getPageSize();
            const page = getPage();
            const start = (page - 1) * pageSize;
            const visibleIds = groups.getAttribute('activ_keyvalue') === 'ALL_RES'
                ? allIds.slice(start, start + pageSize)
                : ['RS-001', 'RS-002', 'RS-003'];
            list.replaceChildren();
            for (const itemValue of visibleIds) {
                const label = document.createElement('label');
                const checkbox = createElement('input', {
                    type: 'checkbox',
                    name: 'GridResearch_SelectList_Item',
                    item_value: itemValue
                });
                checkbox.checked = selectedIds.has(itemValue);
                checkbox.addEventListener('click', () => {
                    metrics.checkboxClicks.set(itemValue, (metrics.checkboxClicks.get(itemValue) || 0) + 1);
                    if (checkbox.checked) {
                        setTimeout(() => appendDirlineRow(itemValue), INSERT_DELAY_MS);
                    } else {
                        Array.from(dirline.querySelectorAll('[cmptype="TreeRow"]'))
                            .find((row) => String(row.clone?.data?.RS_ID || '') === itemValue)
                            ?.remove();
                        selectedIds.delete(itemValue);
                    }
                });
                label.append(checkbox, document.createTextNode(` ${itemValue}`));
                list.append(label);
            }

            const invalidCheckboxValues = [undefined, 'on', 'null', 'undefined', '', '   '];
            for (const invalidValue of invalidCheckboxValues) {
                const checkbox = createElement('input', {
                    type: 'checkbox',
                    name: 'GridResearch_SelectList_Item'
                });
                if (invalidValue !== undefined) {
                    checkbox.setAttribute('item_value', invalidValue);
                }
                const label = document.createElement('label');
                label.dataset.fixtureInvalidId = invalidValue === undefined
                    ? 'default-on'
                    : JSON.stringify(invalidValue);
                label.append(checkbox, document.createTextNode(' invalid-id'));
                list.append(label);
            }
            updateRangeView();
        };
        const setActiveGroup = (row) => {
            const key = row.getAttribute('keyvalue');
            groups.setAttribute('activ_keyvalue', key);
            for (const candidate of groups.querySelectorAll('[cmptype="GridRow"]')) {
                candidate.classList.toggle('active', candidate === row);
            }
        };
        const refreshActiveGroup = () => {
            if (variant === 'd3') {
                range.D3Range.page = 1;
            } else {
                range.setAttribute('page_number', '1');
            }
            setTimeout(renderPage, 80);
        };
        const setPageSize = (amount) => {
            if (variant === 'd3') {
                range.D3Range.amount = amount;
                range.D3Range.page = 1;
            } else {
                range.setAttribute('valuecount', String(amount));
                range.setAttribute('page_number', '1');
            }
            setTimeout(renderPage, 80);
        };
        const goNext = () => {
            const page = getPage();
            if (page >= getTotalPages()) {
                return;
            }
            metrics.nextRequestedAt.push(performance.now());
            if (variant === 'd3') {
                range.D3Range.page++;
            } else {
                range.setAttribute('page_number', String(page + 1));
            }
            setTimeout(() => {
                metrics.pageTransitions++;
                renderPage();
            }, 80);
        };

        range.D3Range = variant === 'd3'
            ? { page: 1, pages: 4, amount: 50, count: TOTAL_RESEARCHES }
            : undefined;
        if (variant === 'legacy') {
            const combo = createElement('span', { cmptype: 'ComboBox' });
            range.CountViewCombo = combo;
            range.append(combo);
            combo.__fixtureRange = range;
        }

        const d3GridCtrl = variant === 'd3'
            ? {
                activateRow: (row, forceOnChange) => {
                    assert(row === allRow, `${variant}: D3 activateRow получает строку ALL_RES`);
                    assert(forceOnChange === true,
                        `${variant}: D3 activateRow принудительно вызывает ровно один onchange`);
                    setActiveGroup(row);
                    refreshActiveGroup();
                },
                setActiveRow: (grid, row) => {
                    assert(grid === groups, `${variant}: D3 setActiveRow получает GridGroups`);
                    assert(row === allRow, `${variant}: D3 setActiveRow получает строку ALL_RES`);
                    setActiveGroup(row);
                    runtimeForm.ResearchGrid.onChangeGroups();
                }
            }
            : {};
        window.D3Api = {
            GridCtrl: d3GridCtrl,
            CheckBoxCtrl: {
                getValue: (control) => control.checked ? 1 : 0,
                setChecked: (control, checked) => {
                    control.checked = checked === true;
                }
            },
            RangeCtrl: {
                setRange: (rangeElement, page, amount) => {
                    assert(rangeElement === range, `${variant}: размер меняется на Range GridResearch`);
                    assert(page === 1, `${variant}: смена размера возвращает на страницу 1`);
                    setPageSize(amount);
                },
                go: (rangeElement, direction) => {
                    assert(rangeElement === range, `${variant}: D3-переход использует Range GridResearch`);
                    assert(direction === 1, `${variant}: D3-переход направлен вперёд`);
                    goNext();
                }
            }
        };
        const runtimeForm = {
            isFirstTime: true,
            ResearchGrid: {
                onChangeGroups: () => {
                    metrics.groupOnChangeCalls++;
                    refreshActiveGroup();
                }
            }
        };
        const getFixtureDataSet = (name) => ({
            data: name === 'DsProfiles'
                ? [{ ID: 'PROFILE-1' }]
                : name === 'DsResearch'
                    ? allIds
                    : []
        });
        const getFixtureRepeater = (name) => name === 'GridDirline_repeater'
            ? {
                clones: () => Array.from(dirline.querySelectorAll('[cmptype="TreeRow"]'))
            }
            : null;
        const runtimeEngine = {
            containerForm: form,
            getNamespace: () => runtimeForm,
            getDataSet: (name) => ({
                ...getFixtureDataSet(name)
            }),
            getRepeater: getFixtureRepeater,
            getRepeaterByName: getFixtureRepeater
        };
        const runtimePage = {
            form: runtimeEngine,
            d3Form: { DOM: form },
            getNamespace: () => runtimeEngine.getNamespace()
        };
        groups.jsParent = { page: runtimePage };
        window.getPageByDom = () => runtimePage;
        window.addStackPage = (page) => {
            assert(page === runtimePage, `${variant}: в стек добавлена exact BARS page`);
            metrics.stackAdds++;
            metrics.stackDepth++;
        };
        window.removeStackPage = () => {
            metrics.stackRemoves++;
            metrics.stackDepth--;
        };
        delete window.setThisActivRow;
        if (variant === 'legacy') {
            window.setThisActivRow = (row, forceOnChange) => {
                assert(forceOnChange === true, `${variant}: setThisActivRow принудительно вызывает onchange`);
                setActiveGroup(row);
                refreshActiveGroup();
            };
        }
        window.ComboBox_SetValue = () => {};
        window.getRepeater = getFixtureRepeater;
        window.RangeCountRefresh = (combo, amount) => {
            assert(combo === range.CountViewCombo, `${variant}: legacy размер меняется через CountViewCombo`);
            setPageSize(amount);
        };
        window.RangeGotoNextPage = () => goNext();

        allRow.addEventListener('mousedown', () => {
            setActiveGroup(allRow);
            refreshActiveGroup();
        });
        appendDirlineRow('RS-001');
        renderPage();
        setTimeout(() => {
            runtimeForm.isFirstTime = false;
        }, 50);

        return { form, groups, range, metrics, runtimeForm, profilesRow };
    };

    const runScenario = async (variant) => {
        const scenario = createScenario(variant);
        const adapter = window.FillBARSAdapter.create({ document, window });
        const form = adapter.findOrderForm();
        assert(form === scenario.form, `${variant}: выбран exact fingerprint формы, decoy отвергнут`);
        const runtimeStarting = adapter.getOrderRuntimeState(form);
        assert(runtimeStarting.available && runtimeStarting.isFirstTime === true,
            `${variant}: адаптер видит незавершённый Form.isFirstTime`);
        assert(await waitFor(() => adapter.getOrderRuntimeState(form).initialized),
            `${variant}: адаптер подтверждает завершение инициализации формы`);

        const initialEntries = adapter.getResearchCheckboxEntries(form);
        assert(initialEntries.length === 3, `${variant}: непустой PROFILES не принят за ALL_RES`);
        assert(form.querySelectorAll('input[name="GridResearch_SelectList_Item"]').length === 9,
            `${variant}: fixture содержит шесть мусорных checkbox ID`);
        assert([null, undefined, '', '   ', 'on', 'null', 'undefined']
            .every((value) => adapter.normalizeResearchId(value) === ''),
        `${variant}: normalizeResearchId отбрасывает служебные и пустые ID`);
        const initialSelectedState = adapter.getSelectedResearchState(form);
        assert(initialSelectedState.values.size === 1 && initialSelectedState.values.has('RS-001'),
            `${variant}: мусорные выбранные ID отфильтрованы из GridDirline`);
        assert(initialSelectedState.sourceKind.includes('repeater_clone_rs_id')
            && initialSelectedState.sourceKind.includes('tree_row_data_rs_id'), `${variant}: RS_ID прочитан из данных Tree/repeater БАРС`);
        const cloneFallbackRow = form.querySelector('[name="GridDirline"] [rs_id_keyvalue="null"]');
        assert(cloneFallbackRow?.clone?.data?.RS_ID === 'RS-001'
            && initialSelectedState.sources.includes(cloneFallbackRow),
        `${variant}: invalid rs_id_keyvalue не заслоняет valid clone RS_ID`);

        const beforeAllRows = adapter.captureResearchRows(form);
        const allRequest = adapter.requestAllResearches(form);
        const expectedAllRequestMethod = variant === 'd3'
            ? 'd3_activate_row_force'
            : 'grid_force_onchange';
        assert(allRequest.requested
            && !allRequest.alreadyActive
            && allRequest.method === expectedAllRequestMethod
            && allRequest.failedMethods.length === 0,
        `${variant}: ALL_RES запрошен штатным source-driven методом ${expectedAllRequestMethod}`);
        const immediateAllRows = adapter.captureResearchRows(form);
        assert(scenario.groups.getAttribute('activ_keyvalue') === 'ALL_RES'
            && !adapter.hasResearchRowsTransition(beforeAllRows, immediateAllRows), `${variant}: активный ALL_RES ещё не означает обновлённые строки`);
        assert(await waitFor(() => {
            const afterAllRows = adapter.captureResearchRows(form);
            return scenario.groups.getAttribute('activ_keyvalue') === 'ALL_RES'
                && adapter.hasResearchRowsTransition(beforeAllRows, afterAllRows)
                && afterAllRows.count === 50;
        }), `${variant}: ALL_RES подтверждён новым поколением строк`);

        const beforePageSizeRows = adapter.captureResearchRows(form);
        const pageSizeRequest = adapter.requestPageSize(TARGET_PAGE_SIZE, form);
        assert(pageSizeRequest.requested, `${variant}: штатное изменение размера страницы доступно`);
        const immediatePageSizeRows = adapter.captureResearchRows(form);
        assert(adapter.getRangeState(form).pageSize === TARGET_PAGE_SIZE
            && !adapter.hasResearchRowsTransition(beforePageSizeRows, immediatePageSizeRows), `${variant}: синхронный amount/valuecount ещё не означает refresh`);
        assert(await waitFor(() => {
            const afterPageSizeRows = adapter.captureResearchRows(form);
            return adapter.getRangeState(form).pageSize === TARGET_PAGE_SIZE
                && adapter.hasResearchRowsTransition(beforePageSizeRows, afterPageSizeRows)
                && afterPageSizeRows.count === TARGET_PAGE_SIZE;
        }), `${variant}: размер страницы подтверждён новым поколением строк`);

        const remaining = new Set(TARGETS);
        const confirmed = new Set();
        const processedPages = new Set();

        while (true) {
            const beforePage = adapter.getRangeState(form);
            const beforePageRows = adapter.captureResearchRows(form);
            const beforeSignature = adapter.getPageSignature(form);
            processedPages.add(beforeSignature);
            const visible = new Map(adapter.getResearchCheckboxEntries(form)
                .map((entry) => [entry.itemValue, entry.checkbox]));
            const beforeItemValues = Array.from(visible.keys()).join(';');

            for (const itemValue of Array.from(remaining)) {
                const checkbox = visible.get(itemValue);
                if (!checkbox) {
                    continue;
                }

                if (!adapter.getSelectedResearchState(form).values.has(itemValue)) {
                    checkbox.click();
                }

                const selected = await waitFor(() => adapter.getSelectedResearchState(form).values.has(itemValue), 3000);
                assert(selected, `${variant}: ${itemValue} подтверждён через GridDirline`);
                confirmed.add(itemValue);
                remaining.delete(itemValue);
            }

            const state = adapter.getRangeState(form);
            if (!adapter.hasNextPage(state)) {
                break;
            }

            const transitionRequest = adapter.requestNextPage(form);
            assert(transitionRequest.requested, `${variant}: следующий лист запрошен штатным Range`);
            const transitioned = await waitFor(() => {
                const after = adapter.getRangeState(form);
                const afterPageRows = adapter.captureResearchRows(form);
                return adapter.getPageSignature(form) !== beforeSignature
                    && afterPageRows.signature !== beforeItemValues
                    && adapter.hasResearchRowsTransition(beforePageRows, afterPageRows)
                    && (beforePage.current === null || after.current === null || after.current > beforePage.current);
            });
            assert(transitioned, `${variant}: переход подтверждён номером/сигнатурой страницы`);
        }

        assert(processedPages.size === 2, `${variant}: обработаны ровно две разные страницы`, {
            processedPages: processedPages.size
        });
        assert(scenario.metrics.pageTransitions === 1, `${variant}: выполнен ровно один переход`);
        assert(confirmed.has('RS-001') && confirmed.has('RS-149') && confirmed.has('RS-151'), `${variant}: существующие цели подтверждены`);
        assert(remaining.size === 1 && remaining.has('RS-999'), `${variant}: отсутствующий ID остался необработанным`);
        assert((scenario.metrics.checkboxClicks.get('RS-001') || 0) === 0, `${variant}: уже выбранный checkbox не переключался`);
        assert((scenario.metrics.checkboxClicks.get('RS-149') || 0) === 1, `${variant}: checkbox первой страницы нажат один раз`);
        assert((scenario.metrics.checkboxClicks.get('RS-151') || 0) === 1, `${variant}: checkbox второй страницы нажат один раз`);
        assert(scenario.metrics.nextRequestedAt[0] >= scenario.metrics.insertedAt.get('RS-149'), `${variant}: переход дождался медленной вставки первой страницы`);
        assert(scenario.metrics.insertedAt.has('RS-151'), `${variant}: завершение дождалось медленной вставки второй страницы`);

        for (const itemValue of ['RS-001', 'RS-149', 'RS-151']) {
            const citoResult = adapter.requestDirlineCito(itemValue, true, form);
            assert(citoResult.requested
                && citoResult.confirmed
                && citoResult.totalRows >= 1
                && citoResult.confirmedRows === citoResult.totalRows,
            `${variant}: CITO для ${itemValue} установлен и подтверждён через GridDirline`, citoResult);
        }
        const citoEntries = adapter.getDirlineCitoEntries(form);
        assert(['RS-001', 'RS-149', 'RS-151'].every((itemValue) => (
            citoEntries.some((entry) => entry.itemValue === itemValue && entry.checked)
        )), `${variant}: итоговое состояние CITO читается из строк GridDirline`);
        const rs001CitoClicks = scenario.metrics.citoClicks.get('RS-001') || 0;
        const repeatedCito = adapter.requestDirlineCito('RS-001', true, form);
        assert(repeatedCito.confirmed
            && repeatedCito.reason === 'cito_already_applied'
            && (scenario.metrics.citoClicks.get('RS-001') || 0) === rs001CitoClicks,
        `${variant}: уже установленный CITO повторно не переключается`, repeatedCito);
        const missingCito = adapter.requestDirlineCito('RS-999', true, form);
        assert(!missingCito.requested
            && !missingCito.confirmed
            && missingCito.reason === 'dirline_row_missing',
        `${variant}: отсутствующая строка CITO завершается fail-closed`, missingCito);
        assert(scenario.metrics.assignClicks === 0, `${variant}: кнопка «Назначить» не нажата`);

        return {
            variant,
            pagesProcessed: processedPages.size,
            pageTransitions: scenario.metrics.pageTransitions,
            confirmed: Array.from(confirmed),
            missing: Array.from(remaining),
            checkboxClicks: Object.fromEntries(scenario.metrics.checkboxClicks),
            citoClicks: Object.fromEntries(scenario.metrics.citoClicks),
            assignClicks: scenario.metrics.assignClicks
        };
    };

    const runD3ActivationFallbackScenario = async () => {
        const scenario = createScenario('d3');
        const adapter = window.FillBARSAdapter.create({ document, window });
        const form = adapter.findOrderForm();
        assert(await waitFor(() => adapter.getOrderRuntimeState(form).initialized),
            'd3 fallback: Form.isFirstTime завершён до вызова source handler');
        const beforeAllRows = adapter.captureResearchRows(form);

        window.D3Api.GridCtrl.activateRow = () => {
            throw new Error('fixture activateRow failure');
        };

        const allRequest = adapter.requestAllResearches(form);
        assert(allRequest.requested
            && !allRequest.alreadyActive
            && allRequest.method === 'd3_set_active_row',
        'd3 fallback: после ошибки force activateRow использован один native setActiveRow');
        assert(JSON.stringify(allRequest.failedMethods) === JSON.stringify(['d3_activate_row_force']),
            'd3 fallback: failedMethods содержит только d3_activate_row_force');
        assert(scenario.metrics.groupOnChangeCalls === 1,
            'd3 fallback: setActiveRow породил ровно один native onchange');
        assert(scenario.metrics.stackAdds === 2
            && scenario.metrics.stackRemoves === 2
            && scenario.metrics.stackDepth === 0,
        'd3 fallback: addStackPage/removeStackPage сбалансированы после исключения');

        const immediateAllRows = adapter.captureResearchRows(form);
        assert(scenario.groups.getAttribute('activ_keyvalue') === 'ALL_RES'
            && !adapter.hasResearchRowsTransition(beforeAllRows, immediateAllRows),
        'd3 fallback: активный ALL_RES ожидает асинхронное обновление строк');
        assert(await waitFor(() => {
            const afterAllRows = adapter.captureResearchRows(form);
            return adapter.hasResearchRowsTransition(beforeAllRows, afterAllRows)
                && afterAllRows.count === 50;
        }), 'd3 fallback: native setActiveRow подтверждён новым поколением строк');

        return {
            variant: 'd3_activate_row_force_failure',
            method: allRequest.method,
            failedMethods: allRequest.failedMethods,
            stackAdds: scenario.metrics.stackAdds,
            stackRemoves: scenario.metrics.stackRemoves
        };
    };

    const runRunnerCitoScenario = async ({ blocked = false } = {}) => {
        const scenario = createScenario('d3', {
            disabledCitoIds: blocked ? ['RS-001'] : []
        });
        const result = await window.__FillBARS_RUNNER__.run(
            blocked
                ? { 'RS-001': true }
                : { 'RS-001': true, 'RS-149': true },
            blocked ? 'fixture CITO fail-closed' : 'fixture CITO success',
            {
                assignmentStage: blocked ? 'schedule' : 'analyses',
                targetCabinet: blocked ? 'Кабинет fixture' : '',
                markUrgent: true
            }
        );

        if (blocked) {
            assert(result.scheduleResult?.blocked === true
                && result.scheduleResult?.reason === 'cito_selection_incomplete'
                && result.scheduleResult?.urgent?.selected === 0
                && result.scheduleResult?.urgent?.total === 1,
            'runner: неподтверждённый CITO блокирует сценарий до Assign', result.scheduleResult);
            assert(scenario.metrics.assignClicks === 0,
                'runner: при неподтверждённом CITO кнопка «Назначить» не нажата');
        } else {
            assert(result.filledCount === 2
                && result.missingCount === 0
                && result.scheduleResult?.complete === true
                && result.scheduleResult?.urgent?.selected === 2
                && result.scheduleResult?.urgent?.total === 2,
            'runner: CITO установлен для всех выбранных исследований', result);
            assert(scenario.metrics.assignClicks === 0,
                'runner: этап «Только анализы» с CITO не нажимает «Назначить»');
        }

        return {
            blocked,
            filledCount: result.filledCount,
            urgent: result.scheduleResult?.urgent,
            assignClicks: scenario.metrics.assignClicks
        };
    };

    try {
        assert(window.FillBARSAdapter?.version === '5.1.14', 'Загружен адаптер FillBARS 5.1.14');
        const legacy = await runScenario('legacy');
        const d3 = await runScenario('d3');
        const d3Fallback = await runD3ActivationFallbackScenario();
        const runnerCitoSuccess = await runRunnerCitoScenario();
        const runnerCitoBlocked = await runRunnerCitoScenario({ blocked: true });
        const report = {
            status: 'passed',
            assertions: assertions.length,
            scenarios: [legacy, d3],
            fallbacks: [d3Fallback],
            runnerCito: [runnerCitoSuccess, runnerCitoBlocked]
        };
        document.body.dataset.testStatus = 'passed';
        status.textContent = `PASS — ${assertions.length} проверок`;
        status.style.color = '#137333';
        results.textContent = JSON.stringify(report, null, 2);
        window.__FillBARSFixtureResult = report;
    } catch (error) {
        const report = {
            status: 'failed',
            assertions: assertions.length,
            error: error?.stack || String(error)
        };
        document.body.dataset.testStatus = 'failed';
        status.textContent = `FAIL — ${error.message}`;
        status.style.color = '#b3261e';
        results.textContent = JSON.stringify(report, null, 2);
        window.__FillBARSFixtureResult = report;
        console.error(error);
    }
})();
