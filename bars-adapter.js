(function initializeFillBARSAdapter(globalScope) {
    'use strict';

    const VERSION = '5.1.14';
    const ORDER_FORM_SELECTOR = '.dirline_order_alt';
    const GRID_GROUPS_SELECTOR = '[name="GridGroups"]';
    const GRID_RESEARCH_SELECTOR = '[name="GridResearch"]';
    const GRID_DIRLINE_SELECTOR = '[name="GridDirline"]';
    const RESEARCH_CHECKBOX_SELECTOR = 'input[name="GridResearch_SelectList_Item"]';
    const CITO_CONTROL_SELECTOR = '[name="Cito"]';
    const SCHEDULE_FORM_SELECTOR = '.form-schedule';
    const SCHEDULE_GRID_SELECTOR = '[name="GridServices"]';
    const SCHEDULE_REPEATER_NAME = 'GridServices_repeater';
    const SCHEDULE_CABINET_CONTROL_NAME = 'ctrlCABLAB';
    const CABINET_PICKER_GRID_SELECTOR = '[name="Grid1"]';

    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizeResearchId = (value) => {
        if (value === null || value === undefined) {
            return '';
        }

        const normalized = String(value).trim();
        return ['', 'on', 'null', 'undefined'].includes(normalized.toLowerCase())
            ? ''
            : normalized;
    };
    const parseInteger = (value) => {
        const parsed = Number.parseInt(String(value ?? '').trim(), 10);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const uniqueElements = (elements) => Array.from(new Set(elements.filter(Boolean)));

    function create(options = {}) {
        const documentRef = options.document || globalScope.document;
        const windowRef = options.window || documentRef?.defaultView || globalScope;
        const customIsVisible = typeof options.isVisible === 'function' ? options.isVisible : null;

        if (!documentRef) {
            throw new Error('FillBARSAdapter requires a document');
        }

        const isVisible = (element) => {
            if (!element || !element.isConnected) {
                return false;
            }

            if (customIsVisible) {
                return customIsVisible(element);
            }

            const rect = element.getBoundingClientRect();
            const style = windowRef.getComputedStyle(element);
            return rect.width > 0
                && rect.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden'
                && style.opacity !== '0';
        };

        const getWindowRoot = (element) => {
            return element?.closest('table.window.WinContent, .window.WinContent, .window') || element;
        };

        const getZIndex = (element) => {
            const parsed = parseInteger(element ? windowRef.getComputedStyle(element).zIndex : null);
            return parsed ?? 0;
        };

        const hasOrderFingerprint = (form) => {
            return !!form
                && !!form.querySelector(GRID_GROUPS_SELECTOR)
                && !!form.querySelector(GRID_RESEARCH_SELECTOR)
                && !!form.querySelector(GRID_DIRLINE_SELECTOR);
        };

        const getOrderForms = () => {
            return Array.from(documentRef.querySelectorAll(ORDER_FORM_SELECTOR))
                .filter(hasOrderFingerprint)
                .filter(isVisible)
                .sort((left, right) => {
                    const leftWindow = getWindowRoot(left);
                    const rightWindow = getWindowRoot(right);
                    const zIndexDiff = getZIndex(leftWindow) - getZIndex(rightWindow);
                    if (zIndexDiff !== 0) {
                        return zIndexDiff;
                    }

                    if (left === right) {
                        return 0;
                    }

                    return left.compareDocumentPosition(right) & windowRef.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
                });
        };

        const findOrderForm = () => getOrderForms().at(-1) || null;
        const getResearchGrid = (form = findOrderForm()) => form?.querySelector(GRID_RESEARCH_SELECTOR) || null;
        const getDirlineGrid = (form = findOrderForm()) => form?.querySelector(GRID_DIRLINE_SELECTOR) || null;

        // system.js:DPage always creates a legacy page.form, but openD3Form then
        // stores the executable D3 form in page.d3Form. In the real BARS build
        // D3 datasets, repeaters and the script closure belong to page.d3Form;
        // page.form remains a compatibility shell with an empty namespace.
        const isD3RuntimeEngine = (engine) => !!engine
            && !engine.destroyed
            && !!engine.DOM
            && typeof engine.getDataSet === 'function'
            && typeof engine.getRepeater === 'function'
            && typeof engine.execScript === 'function';

        const getPageEngine = (page) => isD3RuntimeEngine(page?.d3Form)
            ? page.d3Form
            : page?.form || page?.d3Form?.form || null;

        const getPageNamespace = (page, engine = getPageEngine(page)) => {
            if (engine && engine === page?.d3Form && typeof engine.execScript === 'function') {
                try {
                    // D3Form.execScript executes in the form closure where the
                    // actual Form object lives. Returning it keeps nested source
                    // handlers and dynamic flags such as isFirstTime/lock intact.
                    const namespace = engine.execScript('return Form', []);
                    return namespace
                        && (typeof namespace === 'object' || typeof namespace === 'function')
                        ? namespace
                        : null;
                } catch (error) {
                    return null;
                }
            }

            try {
                if (typeof page?.getNamespace === 'function') {
                    const namespace = page.getNamespace();
                    if (namespace) {
                        return namespace;
                    }
                }
                if (typeof engine?.getNamespace === 'function') {
                    return engine.getNamespace() || null;
                }
            } catch (error) {
                return null;
            }
            return null;
        };

        const isRuntimePage = (page) => !!page && !page.destroyed && !!getPageEngine(page);

        const isDomContainer = (candidate) => candidate
            && typeof candidate === 'object'
            && typeof candidate.contains === 'function';

        const pageOwnsElement = (page, element) => {
            if (!isRuntimePage(page) || !element) {
                return false;
            }

            const engine = getPageEngine(page);
            const containers = [
                engine?.containerForm,
                page?.d3Form?.DOM,
                page?.d3Form,
                engine?.container?.getContainer?.()
            ].filter(isDomContainer);
            if (containers.some((container) => container === element || container.contains(element))) {
                return true;
            }

            let current = element;
            for (let depth = 0; current && depth < 100; depth += 1, current = current.parentNode) {
                const linkedPages = [
                    current.jsParent?.page,
                    current.clone?.form?.page,
                    current.form?.page,
                    current.D3Grid?.page,
                    current.D3Form?.page,
                    current.page
                ];
                if (linkedPages.includes(page)) {
                    return true;
                }
            }

            return false;
        };

        const getExactPage = (element) => {
            if (!element) {
                return null;
            }

            // common.js:getPageByDom falls back to the globally current page when
            // a freshly rendered control does not have jsParent yet. Walk the DOM
            // links first so another modal page can never win that race.
            let current = element;
            for (let depth = 0; current && depth < 100; depth += 1, current = current.parentNode) {
                const candidates = [
                    current.jsParent?.page,
                    current.clone?.form?.page,
                    current.form?.page,
                    current.D3Grid?.page,
                    current.D3Form?.page,
                    current.page
                ];
                const exactPage = candidates.find(isRuntimePage);
                if (exactPage) {
                    return exactPage;
                }
            }

            // D3 controls in the live build frequently have no jsParent/page
            // backlink. The page registries are ordered by BARS window stack,
            // so resolve the last page whose actual runtime DOM owns the node
            // before consulting common.js:getPageByDom and its global fallback.
            const knownPages = [
                ...(Array.isArray(windowRef.SYS_pages_window) ? windowRef.SYS_pages_window : []),
                ...(Array.isArray(windowRef.SYS_pages) ? windowRef.SYS_pages : []),
                windowRef.SYS_lastPage
            ].filter(Boolean);
            const ownedPage = Array.from(new Set(knownPages))
                .filter((page) => pageOwnsElement(page, element))
                .at(-1);
            if (ownedPage) {
                return ownedPage;
            }

            try {
                if (typeof windowRef.getPageByDom === 'function') {
                    const page = windowRef.getPageByDom(element);
                    if (pageOwnsElement(page, element)) {
                        return page;
                    }
                }
            } catch (error) {
                // A missing ownership link means that D3 is still initializing.
            }

            return null;
        };

        const getRuntimeContext = (element) => {
            const page = getExactPage(element);
            const engine = getPageEngine(page);
            const namespace = getPageNamespace(page, engine);
            return {
                page,
                engine,
                namespace,
                runtimeKind: engine && engine === page?.d3Form ? 'd3' : 'legacy',
                // Kept as an internal compatibility alias for source Form.*.
                form: namespace
            };
        };

        const runInPageContext = (page, callback) => {
            if (page
                && typeof windowRef.addStackPage === 'function'
                && typeof windowRef.removeStackPage === 'function') {
                windowRef.addStackPage(page);
                try {
                    return callback();
                } finally {
                    windowRef.removeStackPage();
                }
            }

            return callback();
        };

        const getActiveResearchGroup = (form = findOrderForm(), context = null) => {
            const groupsGrid = form?.querySelector(GRID_GROUPS_SELECTOR) || null;
            if (!groupsGrid) {
                return null;
            }

            const runtimeContext = context || getRuntimeContext(groupsGrid);
            try {
                if (typeof runtimeContext.engine?.getValue === 'function') {
                    const value = runtimeContext.engine.getValue('GridGroups');
                    if (value !== null && value !== undefined && String(value) !== '') {
                        return String(value);
                    }
                }
            } catch (error) {
                // DOM markers below remain the legacy/source fallback.
            }

            const activeAttribute = groupsGrid.getAttribute('activ_keyvalue')
                || groupsGrid.getAttribute('active_keyvalue');
            if (activeAttribute) {
                return activeAttribute;
            }

            const activeRow = groupsGrid.querySelector(
                '[cmptype="GridRow"].active, [cmptype="GridRow"].selected, '
                + '[cmptype="GridRow"][aria-selected="true"], [cmptype="GridRow"][active="true"]'
            );
            return activeRow?.getAttribute('keyvalue') || null;
        };

        const getRuntimeRepeater = (context, name) => {
            if (!context?.page || !context.engine || !name) {
                return null;
            }

            return runInPageContext(context.page, () => {
                if (typeof context.engine.getRepeaterByName === 'function') {
                    const repeater = context.engine.getRepeaterByName(name);
                    if (repeater) {
                        return repeater;
                    }
                }
                if (typeof context.engine.getRepeater === 'function') {
                    const repeater = context.engine.getRepeater(name);
                    if (repeater) {
                        return repeater;
                    }
                }
                return typeof windowRef.getRepeater === 'function'
                    ? windowRef.getRepeater(name)
                    : null;
            });
        };

        const getOrderRuntimeState = (form = findOrderForm()) => {
            const groupsGrid = form?.querySelector(GRID_GROUPS_SELECTOR) || null;
            const runtimeContext = getRuntimeContext(groupsGrid);
            const runtimeEngine = runtimeContext.engine;
            const runtimeNamespace = runtimeContext.namespace;

            const isFirstTime = typeof runtimeNamespace?.isFirstTime === 'boolean'
                ? runtimeNamespace.isFirstTime
                : null;
            const getDataSetRowCount = (name) => {
                try {
                    const dataSet = typeof runtimeEngine?.getDataSet === 'function'
                        ? runtimeEngine.getDataSet(name)
                        : null;
                    return Array.isArray(dataSet?.data) ? dataSet.data.length : null;
                } catch (error) {
                    return null;
                }
            };
            const runtimeActiveGroup = getActiveResearchGroup(form, runtimeContext);

            return {
                available: !!runtimeContext.page && !!runtimeEngine && !!runtimeNamespace,
                namespaceAvailable: !!runtimeNamespace,
                runtimeKind: runtimeContext.runtimeKind,
                hasResearchOnChange: typeof runtimeNamespace?.ResearchGrid?.onChangeGroups === 'function',
                isFirstTime,
                initialized: isFirstTime === false,
                activeGroup: runtimeActiveGroup,
                profilesRowCount: getDataSetRowCount('DsProfiles'),
                researchRowCount: getDataSetRowCount('DsResearch')
            };
        };

        const runInFormContext = (element, callback) => {
            return runInPageContext(getExactPage(element), callback);
        };

        const getResearchId = (checkbox) => {
            const candidates = [
                checkbox?.getAttribute('item_value'),
                checkbox?.getAttribute('data-item-value'),
                checkbox?.getAttribute('value'),
                checkbox?.value
            ];
            for (const candidate of candidates) {
                const itemValue = normalizeResearchId(candidate);
                if (itemValue) {
                    return itemValue;
                }
            }

            return '';
        };

        const getResearchCheckboxEntries = (form = findOrderForm()) => {
            const researchGrid = getResearchGrid(form);
            if (!researchGrid) {
                return [];
            }

            return Array.from(researchGrid.querySelectorAll(RESEARCH_CHECKBOX_SELECTOR))
                .map((checkbox) => ({ checkbox, itemValue: getResearchId(checkbox) }))
                .filter((entry) => entry.itemValue);
        };

        const captureResearchRows = (form = findOrderForm()) => {
            const entries = getResearchCheckboxEntries(form);
            const itemValues = entries.map((entry) => entry.itemValue);
            return {
                count: entries.length,
                itemValues,
                signature: itemValues.join(';'),
                nodes: entries.map((entry) => entry.checkbox)
            };
        };

        const hasResearchRowsTransition = (before, after) => {
            if (!before || !after || after.count === 0) {
                return false;
            }

            if (before.count !== after.count || before.signature !== after.signature) {
                return true;
            }

            return before.nodes.some((node, index) => !node?.isConnected || node !== after.nodes[index]);
        };

        const getSelectedResearchState = (form = findOrderForm()) => {
            const dirlineGrid = getDirlineGrid(form);
            const values = new Set();
            const sources = [];

            if (!dirlineGrid) {
                return {
                    values,
                    sources,
                    sourceCount: 0,
                    sourceKind: 'missing_grid_dirline',
                    available: false,
                    authoritative: false,
                    structuralRowCount: 0
                };
            }

            // dirline_order_alt renders GridDirline as a Tree and keeps RS_ID in
            // repeater/tree row data. Older research_grid_alt code reads the Grid
            // variant from GridRow.rs_id_keyvalue. Both contracts come from BARS.
            const domRows = Array.from(dirlineGrid.querySelectorAll(
                '[cmptype="TreeRow"], [cmptype="GridRow"]'
            ));
            const runtimeContext = getRuntimeContext(dirlineGrid);
            let repeaterRows = [];
            try {
                if (runtimeContext.page) {
                    const repeater = getRuntimeRepeater(runtimeContext, 'GridDirline_repeater');
                    repeaterRows = typeof repeater?.clones === 'function'
                        ? Array.from(repeater.clones())
                            .filter((row) => row?.nodeType === 1 && dirlineGrid.contains(row))
                        : [];
                }
            } catch (error) {
                // Tree DOM data remains the source-driven fallback when the current
                // BARS closure context does not expose the repeater.
            }

            const sourceRows = uniqueElements([...domRows, ...repeaterRows]);
            const sourceKinds = new Set();
            for (const element of sourceRows) {
                const attributeValue = element.getAttribute?.('rs_id_keyvalue');
                const cloneValue = element.clone?.data?.RS_ID;
                const treeValue = element._node?.data?.RS_ID;
                const candidates = [
                    ['grid_row_rs_id_keyvalue', attributeValue],
                    ['repeater_clone_rs_id', cloneValue],
                    ['tree_row_data_rs_id', treeValue]
                ];
                const selectedCandidate = candidates.find(([, value]) => normalizeResearchId(value));
                const itemValue = normalizeResearchId(selectedCandidate?.[1]);
                if (!itemValue) {
                    continue;
                }
                values.add(itemValue);
                sources.push(element);
                sourceKinds.add(selectedCandidate[0]);
            }

            const structuralRows = sourceRows;
            const authoritative = !!runtimeContext.page && !!runtimeContext.engine;
            const sourceKind = sources.length > 0
                ? Array.from(sourceKinds).join('+')
                : structuralRows.length === 0
                    ? 'grid_dirline_empty'
                    : 'grid_dirline_no_research_rows';

            return {
                values,
                sources: uniqueElements(sources),
                sourceCount: values.size,
                sourceKind,
                available: authoritative,
                authoritative,
                structuralRowCount: structuralRows.length
            };
        };

        const normalizeCitoValue = (value) => {
            if (value === true || value === 1) {
                return true;
            }
            if (value === false || value === 0 || value === null || value === undefined) {
                return false;
            }

            return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
        };

        const getCitoInteractionTarget = (control) => {
            if (!control) {
                return null;
            }
            if (control.matches?.('input[type="checkbox"]')) {
                return control;
            }
            return control.querySelector?.('input[type="checkbox"]') || control;
        };

        const readCitoControlValue = (control) => {
            if (!control) {
                return { available: false, checked: false, method: 'missing_control' };
            }

            try {
                if (typeof windowRef.D3Api?.CheckBoxCtrl?.getValue === 'function') {
                    const value = runInFormContext(
                        control,
                        () => windowRef.D3Api.CheckBoxCtrl.getValue(control)
                    );
                    return {
                        available: true,
                        checked: normalizeCitoValue(value),
                        method: 'd3_checkbox'
                    };
                }
            } catch (error) {
                // The native input state remains the source-driven fallback.
            }

            const target = getCitoInteractionTarget(control);
            if (target && 'checked' in target) {
                return {
                    available: true,
                    checked: target.checked === true,
                    method: 'native_checkbox'
                };
            }

            return { available: false, checked: false, method: 'unsupported_control' };
        };

        const getDirlineCitoEntries = (form = findOrderForm()) => {
            const selectedState = getSelectedResearchState(form);
            const entries = [];

            for (const row of selectedState.sources) {
                const itemValue = [
                    row.getAttribute?.('rs_id_keyvalue'),
                    row.clone?.data?.RS_ID,
                    row._node?.data?.RS_ID
                ].map(normalizeResearchId).find(Boolean) || '';
                if (!itemValue) {
                    continue;
                }

                const control = row.querySelector?.(CITO_CONTROL_SELECTOR) || null;
                const state = readCitoControlValue(control);
                entries.push({
                    itemValue,
                    row,
                    control,
                    available: state.available,
                    checked: state.checked,
                    method: state.method
                });
            }

            return entries;
        };

        const requestDirlineCito = (itemValue, desiredState = true, form = findOrderForm()) => {
            const normalizedItemValue = normalizeResearchId(itemValue);
            const desired = desiredState === true;
            const beforeEntries = getDirlineCitoEntries(form)
                .filter((entry) => entry.itemValue === normalizedItemValue);
            const changedMethods = [];
            let disabledCount = 0;

            for (const entry of beforeEntries) {
                if (!entry.available || !entry.control || entry.checked === desired) {
                    continue;
                }

                const target = getCitoInteractionTarget(entry.control);
                if (!target || target.disabled === true || entry.control.getAttribute?.('disabled') !== null) {
                    disabledCount += 1;
                    continue;
                }

                try {
                    runInFormContext(entry.row, () => target.click());
                    changedMethods.push('native_click');
                } catch (error) {
                    changedMethods.push('native_click_failed');
                }

                const afterClick = readCitoControlValue(entry.control);
                if (afterClick.available && afterClick.checked === desired) {
                    continue;
                }

                try {
                    if (typeof windowRef.D3Api?.CheckBoxCtrl?.setChecked === 'function') {
                        runInFormContext(entry.row, () => {
                            windowRef.D3Api.CheckBoxCtrl.setChecked(entry.control, desired);
                            target.dispatchEvent(new windowRef.Event('change', {
                                bubbles: true,
                                cancelable: true
                            }));
                        });
                        changedMethods.push('d3_set_checked_change');
                    }
                } catch (error) {
                    changedMethods.push('d3_set_checked_failed');
                }
            }

            const afterEntries = getDirlineCitoEntries(form)
                .filter((entry) => entry.itemValue === normalizedItemValue);
            const availableEntries = afterEntries.filter((entry) => entry.available);
            const confirmedRows = availableEntries.filter((entry) => entry.checked === desired).length;
            const confirmed = afterEntries.length > 0
                && availableEntries.length === afterEntries.length
                && confirmedRows === afterEntries.length;

            return {
                itemValue: normalizedItemValue,
                desired,
                requested: beforeEntries.length > 0,
                confirmed,
                totalRows: afterEntries.length,
                confirmedRows,
                disabledCount,
                methods: Array.from(new Set(changedMethods)),
                reason: confirmed
                    ? (changedMethods.length > 0 ? 'cito_applied' : 'cito_already_applied')
                    : (afterEntries.length === 0
                        ? 'dirline_row_missing'
                        : (availableEntries.length !== afterEntries.length
                            ? 'cito_control_unavailable'
                            : (disabledCount > 0 ? 'cito_control_disabled' : 'cito_not_confirmed')))
            };
        };

        const findAllResearchesRow = (form = findOrderForm()) => {
            const groupsGrid = form?.querySelector(GRID_GROUPS_SELECTOR);
            if (!groupsGrid) {
                return null;
            }

            const row = groupsGrid.querySelector('[cmptype="GridRow"][keyvalue="ALL_RES"]');
            return row && isVisible(row) ? row : null;
        };

        const isAllResearchesActive = (row) => {
            if (!row) {
                return false;
            }

            const groupsGrid = row.closest(GRID_GROUPS_SELECTOR);
            const form = groupsGrid?.closest(ORDER_FORM_SELECTOR) || findOrderForm();
            const activeKey = getActiveResearchGroup(form);
            if (activeKey) {
                return activeKey === 'ALL_RES';
            }

            return row.classList.contains('active')
                || row.classList.contains('selected')
                || row.getAttribute('aria-selected') === 'true'
                || row.getAttribute('active') === 'true';
        };

        const requestAllResearches = (form = findOrderForm()) => {
            const groupsGrid = form?.querySelector(GRID_GROUPS_SELECTOR);
            const row = findAllResearchesRow(form);
            const failedMethods = [];
            if (!groupsGrid || !row) {
                return { requested: false, alreadyActive: false, method: 'none', failedMethods, row };
            }

            const alreadyActive = isAllResearchesActive(row);
            const runtimeContext = getRuntimeContext(groupsGrid);

            // research_grid_alt uses activateRow, and the live D3 GridCtrl accepts
            // a second `onchange` flag. Passing true forces exactly one native
            // GridGroups onchange even when ALL_RES is already the active row.
            if (typeof windowRef.D3Api?.GridCtrl?.activateRow === 'function') {
                try {
                    runInPageContext(runtimeContext.page, () => {
                        windowRef.D3Api.GridCtrl.activateRow(row, true);
                    });
                    return {
                        requested: true,
                        alreadyActive,
                        method: 'd3_activate_row_force',
                        failedMethods,
                        row
                    };
                } catch (error) {
                    failedMethods.push('d3_activate_row_force');
                }
            }

            // If a legacy D3 build has no force-capable activateRow and the row
            // was already active before this request, invoke only the exact
            // handler. Calling it after setActiveRow would duplicate the native
            // onchange emitted by the live GridCtrl implementation.
            if (alreadyActive
                && typeof runtimeContext.namespace?.ResearchGrid?.onChangeGroups === 'function') {
                try {
                    runInPageContext(runtimeContext.page, () => {
                        runtimeContext.namespace.ResearchGrid.onChangeGroups();
                    });
                    return {
                        requested: true,
                        alreadyActive,
                        method: 'd3_onchange_handler',
                        failedMethods,
                        row
                    };
                } catch (error) {
                    failedMethods.push('d3_onchange_handler');
                }
            }

            // dirline_order_alt uses setActiveRow during initialization. Its
            // rowActivate path emits onchange itself, so never call the handler
            // manually in the same request.
            if (typeof windowRef.D3Api?.GridCtrl?.setActiveRow === 'function') {
                try {
                    runInPageContext(runtimeContext.page, () => {
                        windowRef.D3Api.GridCtrl.setActiveRow(groupsGrid, row);
                    });
                    return {
                        requested: true,
                        alreadyActive,
                        method: 'd3_set_active_row',
                        failedMethods,
                        row
                    };
                } catch (error) {
                    failedMethods.push('d3_set_active_row');
                }
            }

            // cmpGrid rows generated by BARS call setThisActivRow from their
            // onmousedown handler. The second argument forces Grid.onchange even
            // when ALL_RES is already active, which is essential after a stale or
            // interrupted DsResearch refresh. Keep this source path for legacy
            // GridCtrl builds which do not expose D3 row activation.
            if (typeof windowRef.setThisActivRow === 'function') {
                try {
                    runInFormContext(row, () => windowRef.setThisActivRow(row, true));
                    return {
                        requested: true,
                        alreadyActive,
                        method: 'grid_force_onchange',
                        failedMethods,
                        row
                    };
                } catch (error) {
                    failedMethods.push('grid_force_onchange');
                }
            }

            if (alreadyActive && typeof windowRef.execDomEvent === 'function') {
                try {
                    runInFormContext(groupsGrid, () => windowRef.execDomEvent(groupsGrid, 'onchange'));
                    return {
                        requested: true,
                        alreadyActive: true,
                        method: 'grid_exec_onchange',
                        failedMethods,
                        row
                    };
                } catch (error) {
                    failedMethods.push('grid_exec_onchange');
                }
            }

            if (!alreadyActive && typeof windowRef.MouseEvent === 'function') {
                try {
                    row.dispatchEvent(new windowRef.MouseEvent('mousedown', {
                        bubbles: true,
                        cancelable: true,
                        view: windowRef,
                        button: 0,
                        buttons: 1
                    }));
                    if (isAllResearchesActive(row)) {
                        return {
                            requested: true,
                            alreadyActive: false,
                            method: 'grid_row_mousedown',
                            failedMethods,
                            row
                        };
                    }
                } catch (error) {
                    failedMethods.push('grid_row_mousedown');
                }
            }

            if (typeof row.click === 'function') {
                try {
                    row.click();
                    return { requested: true, alreadyActive, method: 'dom_click', failedMethods, row };
                } catch (error) {
                    failedMethods.push('dom_click');
                }
            }

            return { requested: false, alreadyActive, method: 'none', failedMethods, row };
        };

        const getRangeElement = (form = findOrderForm()) => {
            const researchGrid = getResearchGrid(form);
            if (!researchGrid) {
                return null;
            }

            return researchGrid.querySelector('div[cmptype="Range"], table[cmptype="Range"], [cmptype="Range"]')
                || researchGrid.querySelector('[name="rangeResearch"], .ctrl_range');
        };

        const getRangeCountTrigger = (form = findOrderForm()) => {
            const researchGrid = getResearchGrid(form);
            if (!researchGrid) {
                return null;
            }

            return Array.from(researchGrid.querySelectorAll('span[title]'))
                .find((element) => isVisible(element) && normalizeText(element.getAttribute('title')) === 'записей')
                || null;
        };

        const getNextPageControl = (form = findOrderForm()) => {
            const researchGrid = getResearchGrid(form);
            if (!researchGrid) {
                return null;
            }

            const candidates = [
                ...researchGrid.querySelectorAll('.ctrl_range_go_next'),
                ...Array.from(researchGrid.querySelectorAll('[onclick*="RangeCtrl.go"]'))
                    .filter((element) => /,\s*1\s*\)?|next/i.test(element.getAttribute('onclick') || '')),
                ...researchGrid.querySelectorAll('.next_page'),
                ...researchGrid.querySelectorAll('[onclick*="RangeGotoNextPage"]')
            ];

            return uniqueElements(candidates).find((element) => {
                const className = String(element.className || '');
                return isVisible(element)
                    && !element.disabled
                    && element.getAttribute('aria-disabled') !== 'true'
                    && !/(^|\s)(disabled|hidden)(\s|$)/i.test(className);
            }) || null;
        };

        const getRangeState = (form = findOrderForm()) => {
            const range = getRangeElement(form);
            const d3Range = range?.D3Range;
            const text = normalizeText(range?.innerText || range?.textContent || '');
            const textMatch = text.match(/(?:стр(?:\.|аница)?\s*)?(\d+)\s*(?:из|\/)\s*(\d+)/i);
            const legacyPage = parseInteger(range?.getAttribute('page_number'));
            const legacyRowCount = parseInteger(range?.getAttribute('row_count'));
            const legacyPageSize = parseInteger(range?.getAttribute('valuecount'));
            const d3Page = parseInteger(d3Range?.page);
            const d3Pages = parseInteger(d3Range?.pages);
            const d3Amount = parseInteger(d3Range?.amount);
            const d3RowCount = parseInteger(d3Range?.count ?? d3Range?.rowCount ?? d3Range?.rows);
            const trigger = getRangeCountTrigger(form);
            const triggerText = normalizeText(trigger?.textContent || '');
            const triggerPageSize = /^\d+$/.test(triggerText) ? parseInteger(triggerText) : null;

            let current = d3Page ?? legacyPage ?? (textMatch ? parseInteger(textMatch[1]) : null);
            let total = d3Pages ?? (textMatch ? parseInteger(textMatch[2]) : null);
            const pageSize = d3Amount ?? legacyPageSize ?? triggerPageSize;
            const rowCount = d3RowCount ?? legacyRowCount;

            if (current === null && range) {
                current = 1;
            }
            if (total === null && rowCount !== null && pageSize) {
                total = Math.max(1, Math.ceil(rowCount / pageSize));
            }

            const variant = d3Range
                ? 'd3_range'
                : range?.matches('table[cmptype="Range"]') || legacyPage !== null
                    ? 'legacy_range'
                    : range
                        ? 'dom_range'
                        : 'none';

            return {
                variant,
                current,
                total,
                pageSize,
                rowCount,
                text,
                range,
                nextControl: getNextPageControl(form),
                totalKnown: Number.isInteger(total) && total > 0
            };
        };

        const hasNextPage = (state = getRangeState()) => {
            if (!state.nextControl && state.variant !== 'd3_range') {
                return false;
            }
            if (state.totalKnown && Number.isInteger(state.current)) {
                return state.current < state.total;
            }
            return !!state.nextControl || state.variant === 'd3_range';
        };

        const requestNextPage = (form = findOrderForm()) => {
            const state = getRangeState(form);
            if (!hasNextPage(state)) {
                return { requested: false, method: 'none', state };
            }

            if (state.variant === 'd3_range'
                && typeof windowRef.D3Api?.RangeCtrl?.go === 'function') {
                windowRef.D3Api.RangeCtrl.go(state.range, 1);
                return { requested: true, method: 'd3_range', state };
            }

            if (state.nextControl && typeof state.nextControl.click === 'function') {
                state.nextControl.click();
                return {
                    requested: true,
                    method: state.variant === 'legacy_range' ? 'legacy_range' : 'dom_range',
                    state
                };
            }

            return { requested: false, method: 'none', state };
        };

        const requestPageSize = (pageSize, form = findOrderForm()) => {
            const state = getRangeState(form);
            if (!Number.isInteger(pageSize) || pageSize <= 0 || !state.range) {
                return { requested: false, method: 'none', state };
            }

            if (state.variant === 'd3_range'
                && typeof windowRef.D3Api?.RangeCtrl?.setRange === 'function') {
                windowRef.D3Api.RangeCtrl.setRange(state.range, 1, pageSize, true);
                return { requested: true, method: 'd3_range', state };
            }

            const countCombo = state.range.CountViewCombo
                || state.range.querySelector('[cmptype="ComboBox"]');
            if (state.variant === 'legacy_range'
                && countCombo
                && typeof windowRef.RangeCountRefresh === 'function') {
                if (typeof windowRef.ComboBox_SetValue === 'function') {
                    windowRef.ComboBox_SetValue(countCombo, pageSize);
                }
                windowRef.RangeCountRefresh(countCombo, pageSize);
                return { requested: true, method: 'legacy_range', state };
            }

            return { requested: false, method: 'none', state };
        };

        const getPageSignature = (form = findOrderForm()) => {
            const state = getRangeState(form);
            const itemValues = getResearchCheckboxEntries(form).map((entry) => entry.itemValue).join(';');
            return `${state.variant}:${state.current ?? '?'}:${state.total ?? '?'}:${state.pageSize ?? '?'}:${itemValues}`;
        };

        const findScheduleForm = () => {
            return Array.from(documentRef.querySelectorAll(SCHEDULE_FORM_SELECTOR))
                .filter((form) => form.querySelector(SCHEDULE_GRID_SELECTOR))
                .filter(isVisible)
                .sort((left, right) => getZIndex(getWindowRoot(left)) - getZIndex(getWindowRoot(right)))
                .at(-1) || null;
        };

        const getCloneData = (clone) => {
            return clone?.clone?.data || clone?.data || clone?._node?.data || {};
        };

        const withClosureContext = (clone, callback) => {
            if (clone
                && typeof windowRef.closureContext === 'function'
                && typeof windowRef.unClosureContext === 'function') {
                windowRef.closureContext(clone);
                try {
                    return callback();
                } finally {
                    windowRef.unClosureContext();
                }
            }

            return callback();
        };

        const getScheduleRuntimeContext = (form) => {
            return getRuntimeContext(form?.querySelector(SCHEDULE_GRID_SELECTOR) || form);
        };

        const getScheduleClones = (form = findScheduleForm()) => {
            if (!form) {
                return {
                    context: { page: null, engine: null, namespace: null, form: null },
                    clones: []
                };
            }

            const context = getScheduleRuntimeContext(form);
            let clones = [];
            try {
                const repeater = getRuntimeRepeater(context, SCHEDULE_REPEATER_NAME);
                clones = typeof repeater?.clones === 'function'
                    ? Array.from(repeater.clones())
                    : [];
            } catch (error) {
                clones = [];
            }

            if (clones.length === 0) {
                clones = Array.from(form.querySelectorAll('[cmptype="GridRow"], [cmptype="TreeRow"], tr'))
                    .filter((clone) => Object.keys(getCloneData(clone)).length > 0);
            }

            return { context, clones: uniqueElements(clones) };
        };

        const readScheduleClone = (clone, context) => {
            const data = getCloneData(clone);
            const rn = data.RN === null || data.RN === undefined ? '' : String(data.RN).trim();
            const servList = data.SERV_LIST === null || data.SERV_LIST === undefined
                ? ''
                : String(data.SERV_LIST).trim();
            let ctrlCABLAB = null;
            let value = '';
            let caption = '';

            runInPageContext(context.page, () => withClosureContext(clone, () => {
                try {
                    ctrlCABLAB = typeof windowRef.getControl === 'function'
                        ? windowRef.getControl(SCHEDULE_CABINET_CONTROL_NAME)
                        : null;
                } catch (error) {
                    ctrlCABLAB = null;
                }
                ctrlCABLAB = ctrlCABLAB
                    || clone.querySelector?.(`[name="${SCHEDULE_CABINET_CONTROL_NAME}"]`)
                    || null;

                try {
                    // In the live D3 ButtonEdit build, getControlValue(control) and
                    // legacy ButtonEdit_GetValue(control) can expose the visible
                    // caption instead of the dictionary key. The component API is
                    // the authoritative reader for the keyvalue used by schedule.frm.
                    value = typeof windowRef.D3Api?.ButtonEditCtrl?.getValue === 'function' && ctrlCABLAB
                        ? windowRef.D3Api.ButtonEditCtrl.getValue(ctrlCABLAB)
                        : typeof windowRef.getControlValue === 'function' && ctrlCABLAB
                            ? windowRef.getControlValue(ctrlCABLAB)
                            : typeof windowRef.ButtonEdit_GetValue === 'function' && ctrlCABLAB
                                ? windowRef.ButtonEdit_GetValue(ctrlCABLAB)
                            : typeof windowRef.getValue === 'function'
                                ? windowRef.getValue(SCHEDULE_CABINET_CONTROL_NAME)
                                : typeof windowRef.getControlProperty === 'function' && ctrlCABLAB
                                    ? windowRef.getControlProperty(SCHEDULE_CABINET_CONTROL_NAME, 'value')
                                    : ctrlCABLAB?.value ?? ctrlCABLAB?.getAttribute?.('value') ?? '';
                } catch (error) {
                    value = ctrlCABLAB?.value ?? ctrlCABLAB?.getAttribute?.('value') ?? '';
                }

                try {
                    caption = typeof windowRef.D3Api?.ButtonEditCtrl?.getCaption === 'function' && ctrlCABLAB
                        ? windowRef.D3Api.ButtonEditCtrl.getCaption(ctrlCABLAB)
                        : typeof windowRef.getControlCaption === 'function' && ctrlCABLAB
                            ? windowRef.getControlCaption(ctrlCABLAB)
                            : typeof windowRef.ButtonEdit_GetCaption === 'function' && ctrlCABLAB
                                ? windowRef.ButtonEdit_GetCaption(ctrlCABLAB)
                            : typeof windowRef.getControlProperty === 'function'
                                ? windowRef.getControlProperty(SCHEDULE_CABINET_CONTROL_NAME, 'caption')
                                : ctrlCABLAB?.caption ?? ctrlCABLAB?.getAttribute?.('caption') ?? '';
                } catch (error) {
                    caption = ctrlCABLAB?.caption ?? ctrlCABLAB?.getAttribute?.('caption') ?? '';
                }
            }));

            value = value === null || value === undefined ? '' : String(value).trim();
            caption = caption === null || caption === undefined ? '' : String(caption).replace(/\s+/g, ' ').trim();
            return {
                rn,
                servList,
                RN: rn,
                SERV_LIST: servList,
                clone,
                ctrlCABLAB,
                value,
                caption,
                recTimeLock: context.namespace?._get_rec_time_lock === true,
                pending: context.namespace?._get_rec_time_lock === true
            };
        };

        const listScheduleRows = (form = findScheduleForm()) => {
            const { context, clones } = getScheduleClones(form);
            return clones
                .map((clone) => readScheduleClone(clone, context))
                .filter((row) => row.rn);
        };

        const resolveScheduleArguments = (first, second) => {
            const formFirst = first && typeof first.querySelector === 'function';
            return {
                form: formFirst ? first : second || findScheduleForm(),
                rn: formFirst ? second : first
            };
        };

        const readScheduleCabinetState = (first, second) => {
            const { form, rn } = resolveScheduleArguments(first, second);
            const stableRn = rn === null || rn === undefined ? '' : String(rn).trim();
            const context = getScheduleRuntimeContext(form);
            const row = listScheduleRows(form).find((candidate) => candidate.rn === stableRn) || null;
            return {
                found: !!row,
                rn: stableRn,
                servList: row?.servList || '',
                value: row?.value || '',
                caption: row?.caption || '',
                recTimeLock: context.namespace?._get_rec_time_lock === true,
                pending: context.namespace?._get_rec_time_lock === true
            };
        };

        const openScheduleCabinetPicker = (first, second) => {
            const { form, rn } = resolveScheduleArguments(first, second);
            const stableRn = rn === null || rn === undefined ? '' : String(rn).trim();
            const context = getScheduleRuntimeContext(form);
            const row = listScheduleRows(form).find((candidate) => candidate.rn === stableRn) || null;
            if (!row || !row.ctrlCABLAB || typeof context.namespace?.selectCablab !== 'function') {
                return {
                    requested: false,
                    method: 'none',
                    rn: stableRn,
                    servList: row?.servList || '',
                    reason: !row ? 'row_not_found' : !row.ctrlCABLAB ? 'control_not_found' : 'form_method_not_found'
                };
            }

            try {
                runInPageContext(context.page, () => context.namespace.selectCablab(row.ctrlCABLAB));
                return {
                    requested: true,
                    method: 'form_select_cablab',
                    rn: row.rn,
                    servList: row.servList,
                    value: row.value,
                    caption: row.caption,
                    pending: context.namespace._get_rec_time_lock === true
                };
            } catch (error) {
                return {
                    requested: false,
                    method: 'form_select_cablab',
                    failedMethods: ['form_select_cablab'],
                    rn: row.rn,
                    servList: row.servList,
                    reason: 'form_method_failed'
                };
            }
        };

        const requestScheduleCablab = openScheduleCabinetPicker;
        const getScheduleRowState = readScheduleCabinetState;

        const getCabinetPickerCandidates = () => {
            const roots = uniqueElements(Array.from(documentRef.querySelectorAll(
                '[cmptype="Form"], [cmptype="form"], .d3form'
            )));
            return roots
                .filter((form) => form.querySelector(CABINET_PICKER_GRID_SELECTOR))
                .filter(isVisible)
                .map((form) => {
                    const context = getRuntimeContext(form.querySelector(CABINET_PICKER_GRID_SELECTOR) || form);
                    const title = normalizeText(Array.from(form.querySelectorAll('[cmptype="title"], [cmptype="Title"], .form-title'))
                        .map((element) => element.textContent || '')
                        .join(' '));
                    const score = (typeof context.namespace?.OnOkButtonClick === 'function' ? 100 : 0)
                        + (title.includes('кабин') ? 50 : 0)
                        + getZIndex(getWindowRoot(form));
                    return { form, context, score };
                })
                .filter((candidate) => typeof candidate.context.namespace?.OnOkButtonClick === 'function')
                .sort((left, right) => left.score - right.score);
        };

        const findCablabPickerForm = () => getCabinetPickerCandidates().at(-1)?.form || null;
        const findCabinetPickerForm = findCablabPickerForm;

        const resolveCablabPickerForm = (candidate) => {
            if (!candidate || typeof candidate.querySelector !== 'function') {
                return findCablabPickerForm();
            }

            const nestedForms = Array.from(candidate.querySelectorAll(
                '[cmptype="Form"], [cmptype="form"], .d3form'
            )).filter((form) => form.querySelector(CABINET_PICKER_GRID_SELECTOR));
            return nestedForms.filter(isVisible).at(-1)
                || nestedForms.at(-1)
                || (candidate.querySelector(CABINET_PICKER_GRID_SELECTOR) ? candidate : null)
                || findCablabPickerForm();
        };

        const getPickerDataSetRows = (form, context) => {
            try {
                return runInPageContext(context.page, () => {
                    const dataSet = typeof context.engine?.getDataSet === 'function'
                        ? context.engine.getDataSet('DS')
                        : typeof windowRef.getDataSet === 'function'
                            ? windowRef.getDataSet('DS')
                            : null;
                    return Array.isArray(dataSet?.data) ? dataSet.data : [];
                });
            } catch (error) {
                return [];
            }
        };

        const listCablabPickerRows = (form = findCablabPickerForm()) => {
            form = resolveCablabPickerForm(form);
            const grid = form?.querySelector(CABINET_PICKER_GRID_SELECTOR) || null;
            if (!grid) {
                return [];
            }

            const context = getRuntimeContext(grid);
            const dataSetRows = getPickerDataSetRows(form, context);
            const dataById = new Map(dataSetRows
                .filter((data) => data?.ID !== null && data?.ID !== undefined)
                .map((data) => [String(data.ID).trim(), data]));
            return Array.from(grid.querySelectorAll('[cmptype="GridRow"]')).map((row) => {
                const inlineData = getCloneData(row);
                const rawId = row.getAttribute('keyvalue')
                    ?? row.getAttribute('id_keyvalue')
                    ?? inlineData.ID;
                const id = rawId === null || rawId === undefined ? '' : String(rawId).trim();
                const data = dataById.get(id) || inlineData || {};
                const name = data.NAME === null || data.NAME === undefined
                    ? String(row.textContent || '').replace(/\s+/g, ' ').trim()
                    : String(data.NAME).replace(/\s+/g, ' ').trim();
                return { id, name, caption: name, row, data };
            }).filter((entry) => entry.id || entry.name);
        };

        const getCablabPickerMatch = (pickerForm, targetCaptionOrName) => {
            const targetObject = targetCaptionOrName && typeof targetCaptionOrName === 'object'
                ? targetCaptionOrName
                : null;
            const targetId = targetObject?.id === null || targetObject?.id === undefined
                ? ''
                : String(targetObject.id).trim();
            const targetName = normalizeText(targetObject?.caption ?? targetObject?.name ?? targetCaptionOrName);
            const rawEntries = listCablabPickerRows(pickerForm);
            const seenIds = new Set();
            const entries = rawEntries.filter((entry) => {
                if (!entry.id) {
                    return true;
                }
                if (seenIds.has(entry.id)) {
                    return false;
                }
                seenIds.add(entry.id);
                return true;
            });
            const exactMatches = entries.filter((candidate) => {
                return (targetId && candidate.id === targetId)
                    || (!targetId && targetName && normalizeText(candidate.name) === targetName);
            });
            // Token matches are diagnostics only. A medical cabinet is never
            // selected by a fuzzy caption: confirmation requires exact ID/name.
            const targetTokens = targetName.split(' ').filter(Boolean);
            const tokenMatches = !targetId && exactMatches.length === 0 && targetTokens.length >= 2
                ? entries.filter((candidate) => {
                    const candidateName = normalizeText(candidate.name);
                    return targetTokens.every((token) => candidateName.includes(token));
                })
                : [];

            if (exactMatches.length === 1) {
                return {
                    entry: exactMatches[0],
                    entries,
                    rawRowCount: rawEntries.length,
                    exactMatchCount: 1,
                    tokenMatchCount: tokenMatches.length,
                    matchMode: targetId ? 'exact_id' : 'exact_name',
                    reason: ''
                };
            }
            if (exactMatches.length > 1) {
                return {
                    entry: null,
                    entries,
                    rawRowCount: rawEntries.length,
                    exactMatchCount: exactMatches.length,
                    tokenMatchCount: tokenMatches.length,
                    matchMode: 'none',
                    reason: 'ambiguous_row_match'
                };
            }
            return {
                entry: null,
                entries,
                rawRowCount: rawEntries.length,
                exactMatchCount: 0,
                tokenMatchCount: tokenMatches.length,
                matchMode: 'none',
                reason: 'exact_row_not_found'
            };
        };

        const confirmCabinetPickerSelection = (first, second) => {
            const pickerFirst = first && typeof first.querySelector === 'function';
            const pickerForm = resolveCablabPickerForm(
                pickerFirst ? first : second || findCablabPickerForm()
            );
            const targetCaptionOrName = pickerFirst ? second : first;
            if (!pickerForm) {
                return {
                    selected: false,
                    confirmed: false,
                    method: 'none',
                    failedMethods: [],
                    reason: 'picker_form_not_ready',
                    retryable: true,
                    terminal: false,
                    rowCount: 0,
                    rawRowCount: 0,
                    dataSetRowCount: 0,
                    exactMatchCount: 0,
                    tokenMatchCount: 0,
                    matchMode: 'none'
                };
            }
            if (pickerForm.isConnected === false || !isVisible(pickerForm)) {
                return {
                    selected: false,
                    confirmed: false,
                    method: 'none',
                    failedMethods: [],
                    reason: 'picker_closed',
                    retryable: false,
                    terminal: true,
                    rowCount: 0,
                    rawRowCount: 0,
                    dataSetRowCount: 0,
                    exactMatchCount: 0,
                    tokenMatchCount: 0,
                    matchMode: 'none'
                };
            }
            const grid = pickerForm?.querySelector(CABINET_PICKER_GRID_SELECTOR) || null;
            const context = getRuntimeContext(grid || pickerForm);
            const match = getCablabPickerMatch(pickerForm, targetCaptionOrName);
            const entry = match.entry;
            const rowCount = match.entries.length;
            const rawRowCount = match.rawRowCount;
            const dataSetRowCount = grid ? getPickerDataSetRows(pickerForm, context).length : 0;
            const failedMethods = [];
            const renderingIncomplete = dataSetRowCount > rowCount;

            if (!entry || !grid || typeof context.namespace?.OnOkButtonClick !== 'function' || renderingIncomplete) {
                const reason = !grid
                    ? 'grid_not_found'
                    : typeof context.namespace?.OnOkButtonClick !== 'function'
                        ? 'form_method_not_found'
                        : rowCount === 0
                            ? 'picker_rows_not_loaded'
                            : renderingIncomplete
                                ? 'picker_rows_rendering'
                            : match.reason || 'exact_row_not_found';
                const retryable = reason === 'grid_not_found'
                    || reason === 'form_method_not_found'
                    || reason === 'picker_rows_not_loaded'
                    || reason === 'picker_rows_rendering'
                    || reason === 'exact_row_not_found'
                    || reason === 'ambiguous_row_match';
                return {
                    selected: false,
                    confirmed: false,
                    method: 'none',
                    failedMethods,
                    reason,
                    retryable,
                    terminal: !retryable,
                    rowCount,
                    rawRowCount,
                    dataSetRowCount,
                    exactMatchCount: match.exactMatchCount,
                    tokenMatchCount: match.tokenMatchCount,
                    matchMode: match.matchMode
                };
            }

            let activationMethod = 'none';
            if (typeof windowRef.setThisActivRow === 'function') {
                try {
                    runInPageContext(context.page, () => windowRef.setThisActivRow(entry.row, true));
                    activationMethod = 'grid_force_onchange';
                } catch (error) {
                    failedMethods.push('grid_force_onchange');
                }
            }
            if (activationMethod === 'none' && typeof windowRef.D3Api?.GridCtrl?.activateRow === 'function') {
                try {
                    runInPageContext(context.page, () => windowRef.D3Api.GridCtrl.activateRow(entry.row));
                    activationMethod = 'd3_activate_row';
                } catch (error) {
                    failedMethods.push('d3_activate_row');
                }
            }
            if (activationMethod === 'none' && typeof windowRef.D3Api?.GridCtrl?.setActiveRow === 'function') {
                try {
                    runInPageContext(context.page, () => windowRef.D3Api.GridCtrl.setActiveRow(grid, entry.row));
                    activationMethod = 'd3_set_active_row';
                } catch (error) {
                    failedMethods.push('d3_set_active_row');
                }
            }
            if (activationMethod === 'none' && typeof windowRef.MouseEvent === 'function') {
                try {
                    entry.row.dispatchEvent(new windowRef.MouseEvent('mousedown', {
                        bubbles: true,
                        cancelable: true,
                        view: windowRef,
                        button: 0,
                        buttons: 1
                    }));
                    activationMethod = 'grid_row_mousedown';
                } catch (error) {
                    failedMethods.push('grid_row_mousedown');
                }
            }

            if (activationMethod === 'none') {
                return {
                    selected: false,
                    confirmed: false,
                    method: 'none',
                    failedMethods,
                    reason: 'row_activation_failed',
                    retryable: false,
                    terminal: true,
                    rowCount,
                    rawRowCount,
                    dataSetRowCount,
                    exactMatchCount: match.exactMatchCount,
                    tokenMatchCount: match.tokenMatchCount,
                    matchMode: match.matchMode,
                    id: entry.id,
                    caption: entry.name
                };
            }

            try {
                runInPageContext(context.page, () => context.namespace.OnOkButtonClick());
                return {
                    selected: true,
                    confirmed: true,
                    method: `${activationMethod}+form_on_ok`,
                    activationMethod,
                    failedMethods,
                    rowCount,
                    rawRowCount,
                    dataSetRowCount,
                    exactMatchCount: match.exactMatchCount,
                    tokenMatchCount: match.tokenMatchCount,
                    matchMode: match.matchMode,
                    id: entry.id,
                    caption: entry.name
                };
            } catch (error) {
                failedMethods.push('form_on_ok');
                return {
                    selected: true,
                    confirmed: false,
                    method: activationMethod,
                    activationMethod,
                    failedMethods,
                    reason: 'form_method_failed',
                    retryable: false,
                    terminal: true,
                    rowCount,
                    rawRowCount,
                    dataSetRowCount,
                    exactMatchCount: match.exactMatchCount,
                    tokenMatchCount: match.tokenMatchCount,
                    matchMode: match.matchMode,
                    id: entry.id,
                    caption: entry.name
                };
            }
        };

        const waitForCabinetPickerSelection = async (first, second, options = {}) => {
            const timeoutMs = Number.isFinite(options.timeoutMs)
                ? Math.max(0, Math.min(15000, options.timeoutMs))
                : 5000;
            const intervalMs = Number.isFinite(options.intervalMs)
                ? Math.max(50, Math.min(1000, options.intervalMs))
                : 200;
            const startedAt = Date.now();
            let attempts = 0;
            let lastResult = null;
            const pickerFirst = first && typeof first.querySelector === 'function';
            const pickerCandidate = pickerFirst ? first : second || findCablabPickerForm();
            const targetCaptionOrName = pickerFirst ? second : first;
            let expectedPickerForm = resolveCablabPickerForm(pickerCandidate);

            do {
                attempts += 1;
                const currentPickerForm = resolveCablabPickerForm(pickerCandidate);
                if (!expectedPickerForm && currentPickerForm) {
                    expectedPickerForm = currentPickerForm;
                }
                if (expectedPickerForm && currentPickerForm && currentPickerForm !== expectedPickerForm) {
                    return {
                        selected: false,
                        confirmed: false,
                        method: 'none',
                        reason: 'picker_replaced',
                        retryable: false,
                        terminal: true,
                        attempts,
                        elapsedMs: Date.now() - startedAt,
                        timedOut: false
                    };
                }

                const activePickerForm = expectedPickerForm || currentPickerForm;
                lastResult = activePickerForm
                    ? confirmCabinetPickerSelection(activePickerForm, targetCaptionOrName)
                    : {
                        selected: false,
                        confirmed: false,
                        method: 'none',
                        reason: 'picker_form_not_ready',
                        retryable: true,
                        terminal: false,
                        rowCount: 0,
                        rawRowCount: 0,
                        dataSetRowCount: 0,
                        exactMatchCount: 0,
                        tokenMatchCount: 0,
                        matchMode: 'none'
                    };
                if (lastResult?.confirmed === true || lastResult?.selected === true || lastResult?.retryable !== true) {
                    return {
                        ...lastResult,
                        attempts,
                        elapsedMs: Date.now() - startedAt,
                        timedOut: false
                    };
                }

                const remainingMs = timeoutMs - (Date.now() - startedAt);
                if (remainingMs <= 0) {
                    break;
                }
                await new Promise((resolve) => windowRef.setTimeout(resolve, Math.min(intervalMs, remainingMs)));
            } while (Date.now() - startedAt <= timeoutMs);

            return {
                ...(lastResult || {
                    selected: false,
                    confirmed: false,
                    method: 'none',
                    reason: 'picker_rows_not_loaded'
                }),
                retryable: false,
                terminal: true,
                attempts,
                elapsedMs: Date.now() - startedAt,
                timedOut: true
            };
        };

        const selectCablabPickerRow = confirmCabinetPickerSelection;

        return {
            version: VERSION,
            selectors: {
                orderForm: ORDER_FORM_SELECTOR,
                groupsGrid: GRID_GROUPS_SELECTOR,
                researchGrid: GRID_RESEARCH_SELECTOR,
                dirlineGrid: GRID_DIRLINE_SELECTOR,
                researchCheckbox: RESEARCH_CHECKBOX_SELECTOR,
                citoControl: CITO_CONTROL_SELECTOR,
                scheduleForm: SCHEDULE_FORM_SELECTOR,
                scheduleGrid: SCHEDULE_GRID_SELECTOR,
                cabinetPickerGrid: CABINET_PICKER_GRID_SELECTOR
            },
            normalizeText,
            normalizeResearchId,
            isVisible,
            hasOrderFingerprint,
            getOrderForms,
            findOrderForm,
            getResearchGrid,
            getDirlineGrid,
            getOrderRuntimeState,
            getActiveResearchGroup,
            getResearchId,
            getResearchCheckboxEntries,
            captureResearchRows,
            hasResearchRowsTransition,
            getSelectedResearchState,
            getDirlineCitoEntries,
            requestDirlineCito,
            findAllResearchesRow,
            isAllResearchesActive,
            requestAllResearches,
            getRangeElement,
            getRangeCountTrigger,
            getNextPageControl,
            getRangeState,
            hasNextPage,
            requestNextPage,
            requestPageSize,
            getPageSignature,
            findScheduleForm,
            listScheduleRows,
            getScheduleRowState,
            readScheduleCabinetState,
            requestScheduleCablab,
            openScheduleCabinetPicker,
            findCablabPickerForm,
            findCabinetPickerForm,
            listCablabPickerRows,
            selectCablabPickerRow,
            confirmCabinetPickerSelection,
            waitForCabinetPickerSelection
        };
    }

    const api = { version: VERSION, normalizeResearchId, create };
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    globalScope.FillBARSAdapter = api;
})(typeof window !== 'undefined' ? window : globalThis);
