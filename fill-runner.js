(function initializeFillBARSRunner(globalScope) {
    'use strict';

    const VERSION = '5.2.6';

async function fillForm(formData, profileName, assignmentSettings = {}, diagnosticRunId = '', diagnosticBridgeToken = '') {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║  МИС БАРС - Автоматическое назначение анализов           ║");
    console.log("║  Разработчик: MorozovRV and Bitucckii VA                 ║");
    console.log("║  Версия: 5.2.6                                           ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`=== Автозаполнение: профиль "${profileName}" ===`);

    let filledCount = 0;
    const diagnosticEntries = [];
    let diagnosticSequence = 0;
    const diagnosticPageInstanceId = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const postDiagnosticToBridge = (payload) => {
        if (!diagnosticRunId || !diagnosticBridgeToken) {
            return;
        }

        try {
            window.postMessage({
                source: 'fillbars-diagnostic-page-v1',
                runId: diagnosticRunId,
                token: diagnosticBridgeToken,
                ...payload
            }, '*');
        } catch (error) {
            // Diagnostics are best-effort and must not affect form filling.
        }
    };
    const attachDiagnostics = (result) => {
        const resultAssignmentStage = result?.assignmentStage
            || (String(assignmentSettings?.targetCabinet || '').trim()
                && assignmentSettings?.assignmentStage === 'schedule'
                ? 'schedule'
                : 'analyses');
        const defaultScheduleResult = resultAssignmentStage === 'schedule'
            ? {
                stage: 'schedule',
                message: 'этап расписания не выполнен',
                opened: false,
                complete: false,
                skipped: true,
                cabinets: { selected: 0, total: 0, stopped: true, skipped: true },
                urgent: { selected: 0, total: 0, stopped: true, skipped: true, complete: false }
            }
            : {
                stage: 'analyses',
                message: 'этап расписания отключён',
                opened: false,
                complete: true,
                skipped: true,
                cabinets: { selected: 0, total: 0, stopped: false, skipped: true },
                urgent: { selected: 0, total: 0, stopped: false, skipped: true, complete: true }
            };
        const payload = {
            ...result,
            assignmentStage: resultAssignmentStage,
            scheduleResult: result?.scheduleResult || defaultScheduleResult,
            diagnosticRunId,
            diagnostics: diagnosticEntries.slice(-250)
        };
        const hasProgress = !payload.fatalError && payload.filledCount > 0;
        const scheduleIncomplete = payload.assignmentStage === 'schedule'
            && payload.scheduleResult?.complete !== true;
        const blocked = payload.blocked === true || payload.scheduleResult?.blocked === true;
        const pageStatus = payload.fatalError
            ? 'failed'
            : (blocked
                ? 'partial'
                : (hasProgress
                ? ((payload.missingCount || 0) > 0 || scheduleIncomplete ? 'partial' : 'success')
                : 'failed'));
        postDiagnosticToBridge({
            kind: 'complete',
            time: new Date().toISOString(),
            status: pageStatus,
            summary: {
                reason: payload.fatalError
                    ? 'unhandled_error'
                    : (blocked
                        ? (payload.blockReason || payload.scheduleResult?.reason || 'workflow_blocked')
                        : (payload.skipped
                        ? 'frame_skipped'
                        : (scheduleIncomplete ? 'schedule_incomplete' : 'page_completed'))),
                message: payload.message || '',
                filledCount: payload.filledCount || 0,
                totalFound: payload.totalFound || 0,
                pagesProcessed: payload.pagesProcessed || 0,
                missingCount: payload.missingCount || 0,
                missingItemValues: payload.missingItemValues || [],
                pagination: payload.pagination || null,
                assignmentStage: payload.assignmentStage || null,
                scheduleResult: payload.scheduleResult || null
            }
        });
        return payload;
    };
    const addEarlyDiagnostic = (event, details = {}) => {
        const entry = {
            id: `${diagnosticRunId || 'page'}:${diagnosticPageInstanceId}:${++diagnosticSequence}`,
            time: new Date().toISOString(),
            event,
            details
        };
        diagnosticEntries.push(entry);
        postDiagnosticToBridge({ kind: 'append', ...entry });
    };

    try {

    const CHECKBOX_SELECTOR = 'input[name="GridResearch_SelectList_Item"]';
    const TARGET_PAGE_SIZE = 150;
    const ASSIGNMENT_STAGE_ANALYSES = 'analyses';
    const ASSIGNMENT_STAGE_SCHEDULE = 'schedule';
    const targetCabinetName = String(assignmentSettings?.targetCabinet || '').trim();
    const normalizedAssignmentStage = targetCabinetName && assignmentSettings?.assignmentStage === ASSIGNMENT_STAGE_SCHEDULE
        ? ASSIGNMENT_STAGE_SCHEDULE
        : ASSIGNMENT_STAGE_ANALYSES;
    const shouldMarkUrgent = assignmentSettings?.markUrgent === true;
    const resumeScheduleOnly = normalizedAssignmentStage === ASSIGNMENT_STAGE_SCHEDULE
        && assignmentSettings?.resumeScheduleOnly === true;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const adapterApi = window.FillBARSAdapter;

    if (!adapterApi || typeof adapterApi.create !== 'function') {
        addEarlyDiagnostic('fill:adapter_missing');
        return attachDiagnostics({
            skipped: true,
            message: 'Адаптер БАРС не загружен',
            filledCount: 0,
            totalFound: 0
        });
    }

    let researchCheckboxIndex = new Map();
    let barsAdapter = null;
    const emptyResearchRoot = document.createElement('div');

    const getCheckboxItemValue = (checkbox) => barsAdapter?.getResearchId(checkbox)
        || checkbox?.getAttribute('item_value')
        || (checkbox?.value && checkbox.value !== 'on' ? String(checkbox.value) : '');

    const getCheckboxes = () => Array.from(getResearchGridRoot().querySelectorAll(CHECKBOX_SELECTOR))
        .filter((checkbox) => getCheckboxItemValue(checkbox));

    const indexResearchCheckboxes = (checkboxes) => {
        researchCheckboxIndex = new Map(checkboxes.map((checkbox) => [getCheckboxItemValue(checkbox), checkbox]));
    };

    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

    const getElementLabel = (element) => normalizeText([
        element.textContent,
        element.value,
        element.title,
        element.getAttribute('aria-label')
    ].filter(Boolean).join(' '));

    const clickElement = (element, useDoubleClick = true) => {
        const rect = element.getBoundingClientRect();
        const clientX = rect.left + Math.max(1, rect.width / 2);
        const clientY = rect.top + Math.max(1, rect.height / 2);
        const makeMouseEvent = (type) => new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            screenX: window.screenX + clientX,
            screenY: window.screenY + clientY,
            button: 0,
            buttons: type === 'mouseup' ? 0 : 1
        });

        element.dispatchEvent(makeMouseEvent('mouseover'));
        element.dispatchEvent(makeMouseEvent('mousemove'));
        element.dispatchEvent(makeMouseEvent('mousedown'));
        element.dispatchEvent(makeMouseEvent('mouseup'));
        element.dispatchEvent(makeMouseEvent('click'));
        if (useDoubleClick) {
            element.dispatchEvent(makeMouseEvent('dblclick'));
        }
    };

    const isVisible = (element) => {
        if (!element || !element.isConnected) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0';
    };

    try {
        barsAdapter = adapterApi.create({ document, window, isVisible });
    } catch (error) {
        console.error('[FillBARS] Не удалось инициализировать адаптер БАРС', error);
        addEarlyDiagnostic('fill:adapter_initialization_failed', {
            errorName: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error'
        });
        return attachDiagnostics({
            skipped: true,
            message: 'Не удалось инициализировать адаптер БАРС',
            filledCount: 0,
            totalFound: 0
        });
    }

    const allResearchLoadStates = new WeakMap();
    const pageSizeLoadStates = new WeakMap();
    const describeResearchRows = (snapshot) => ({
        count: snapshot?.count || 0,
        signature: String(snapshot?.signature || '').slice(0, 1200),
        firstItemValues: Array.isArray(snapshot?.itemValues) ? snapshot.itemValues.slice(0, 12) : [],
        lastItemValue: Array.isArray(snapshot?.itemValues) ? snapshot.itemValues.at(-1) || '' : ''
    });
    const waitForPageSizeApplication = (form, beforeRows, beforeRangeState, timeout = 12000) => {
        return waitForCondition(() => {
            const currentRangeState = barsAdapter.getRangeState(form);
            if (currentRangeState.pageSize !== TARGET_PAGE_SIZE) {
                return null;
            }

            const afterRows = barsAdapter.captureResearchRows(form);
            const rowsTransitioned = barsAdapter.hasResearchRowsTransition(beforeRows, afterRows);
            if (afterRows.count === 0) {
                return null;
            }

            return {
                afterRows,
                rowsTransitioned,
                stableReady: !rowsTransitioned,
                beforeRangeState,
                currentRangeState
            };
        }, timeout, 180);
    };

    const findCheckboxByItemValue = (itemValue) => {
        const researchGrid = getResearchGridRoot();
        const cachedCheckbox = researchCheckboxIndex.get(itemValue);

        if (cachedCheckbox
            && cachedCheckbox.isConnected
            && researchGrid.contains(cachedCheckbox)
            && getCheckboxItemValue(cachedCheckbox) === itemValue) {
            return cachedCheckbox;
        }

        const checkbox = Array.from(researchGrid.querySelectorAll(CHECKBOX_SELECTOR))
            .find((element) => getCheckboxItemValue(element) === itemValue) || null;

        if (checkbox) {
            researchCheckboxIndex.set(itemValue, checkbox);
        } else {
            researchCheckboxIndex.delete(itemValue);
        }

        return checkbox;
    };

    const clickCheckboxLikeUser = (checkbox) => {
        checkbox.scrollIntoView({ block: 'center', inline: 'nearest' });
        if (typeof checkbox.focus === 'function') {
            checkbox.focus();
        }

        checkbox.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        checkbox.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
        checkbox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        checkbox.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        checkbox.click();
    };

    const waitForBarsToProcessSelection = (itemValue, desiredState) => {
        const getSelectionState = () => {
            const checkbox = findCheckboxByItemValue(itemValue);
            const selectedValues = getSelectedOrderItemValues();
            const checkboxMatches = !!checkbox && checkbox.checked === desiredState;
            const hasAuthoritativeSelection = selectedValues.available && selectedValues.authoritative;
            const selectedListMatches = hasAuthoritativeSelection
                && selectedValues.values.has(itemValue) === desiredState;

            return {
                isReady: checkboxMatches && selectedListMatches,
                needsStabilityCheck: checkboxMatches && selectedListMatches && desiredState === false
            };
        };

        return new Promise((resolve) => {
            let observer = null;
            let pollTimer = null;
            let timeoutTimer = null;
            let stabilityTimer = null;
            let isFinished = false;
            let isVerificationScheduled = false;

            const cleanup = () => {
                observer?.disconnect();
                clearInterval(pollTimer);
                clearTimeout(timeoutTimer);
                clearTimeout(stabilityTimer);
            };
            const finish = (result) => {
                if (isFinished) {
                    return;
                }

                isFinished = true;
                cleanup();
                resolve(result);
            };
            const verify = () => {
                if (isFinished) {
                    return;
                }

                const state = getSelectionState();
                if (!state.isReady) {
                    clearTimeout(stabilityTimer);
                    stabilityTimer = null;
                    return;
                }

                if (!state.needsStabilityCheck) {
                    finish(true);
                    return;
                }

                if (stabilityTimer === null) {
                    stabilityTimer = setTimeout(() => {
                        stabilityTimer = null;
                        const stableState = getSelectionState();
                        if (stableState.isReady) {
                            finish(true);
                        } else {
                            verify();
                        }
                    }, 800);
                }
            };
            const scheduleVerification = () => {
                if (isVerificationScheduled || isFinished) {
                    return;
                }

                isVerificationScheduled = true;
                Promise.resolve().then(() => {
                    isVerificationScheduled = false;
                    verify();
                });
            };

            const observerRoot = barsAdapter.findOrderForm() || document.body;
            if (typeof MutationObserver === 'function' && observerRoot) {
                observer = new MutationObserver(scheduleVerification);
                observer.observe(observerRoot, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['checked', 'item_value', 'value', 'rs_id_keyvalue', 'class']
                });
            }

            pollTimer = setInterval(verify, 180);
            timeoutTimer = setTimeout(() => finish(getSelectionState().isReady), 12000);
            verify();
        });
    };

    const setCheckboxStateThroughBars = async (itemValue, desiredState) => {
        const checkbox = findCheckboxByItemValue(itemValue);

        if (!checkbox) {
            console.warn(`Анализ не найден на странице: ${itemValue}`);
            return false;
        }

        if (checkbox.checked === desiredState) {
            return waitForBarsToProcessSelection(itemValue, desiredState);
        }

        clickCheckboxLikeUser(checkbox);
        return waitForBarsToProcessSelection(itemValue, desiredState);
    };

    const resyncSelectedCheckboxThroughBars = async (itemValue) => {
        const checkbox = findCheckboxByItemValue(itemValue);

        if (!checkbox) {
            console.warn(`Анализ не найден на странице: ${itemValue}`);
            return false;
        }

        if (checkbox.checked) {
            // GridDirline is authoritative. Never toggle a checked item while BARS may
            // still be finishing its asynchronous price calculation and tree insertion.
            return waitForBarsToProcessSelection(itemValue, true);
        }

        return setCheckboxStateThroughBars(itemValue, true);
    };

    const dispatchValueEvents = (element) => {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.dispatchEvent(new KeyboardEvent('keypress', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.blur();
    };

    const isPagerArea = (element, root) => {
        const rect = element.getBoundingClientRect();
        const rootRect = root === document.body
            ? { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight }
            : root.getBoundingClientRect();

        const inRoot = rect.left >= rootRect.left - 20
            && rect.right <= rootRect.right + 20
            && rect.top >= rootRect.top - 20
            && rect.bottom <= rootRect.bottom + 80;

        const rootHeight = root === document.body ? Math.max(rootRect.height, window.innerHeight) : rootRect.height;
        const rootWidth = root === document.body ? Math.max(rootRect.width, window.innerWidth) : rootRect.width;
        const inBottomPart = rect.top >= rootRect.top + rootHeight * 0.35 || rect.bottom >= window.innerHeight * 0.5;
        const inRightPart = rect.left >= rootRect.left + rootWidth * 0.3;

        return inRoot && inBottomPart && inRightPart;
    };

    const waitForRowsReload = async (previousCount) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < 7000) {
            await sleep(250);

            const currentCount = getCheckboxes().length;
            if (currentCount >= 100 || currentCount > previousCount) {
                return currentCount;
            }
        }

        return getCheckboxes().length;
    };

    const waitForCheckboxesToSettle = async () => {
        const startedAt = Date.now();
        let lastCount = getCheckboxes().length;
        let stableSince = Date.now();

        while (Date.now() - startedAt < 7000) {
            await sleep(250);

            const currentCount = getCheckboxes().length;
            if (currentCount !== lastCount) {
                lastCount = currentCount;
                stableSince = Date.now();
            }

            if (currentCount > 0 && Date.now() - startedAt >= 1200 && Date.now() - stableSince >= 500) {
                return currentCount;
            }
        }

        return getCheckboxes().length;
    };

    const setInputValue = async (input, value) => {
        input.focus();

        const valuePrototype = input instanceof window.HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(valuePrototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(input, String(value));
        } else {
            input.value = String(value);
        }

        dispatchValueEvents(input);
        await sleep(150);
    };

    const setEditableText = async (element, value) => {
        element.focus();

        if (element.isContentEditable) {
            element.textContent = String(value);
        } else {
            element.click();
            await sleep(150);

            const active = document.activeElement;
            if (active && active !== element && /^(INPUT|TEXTAREA)$/i.test(active.tagName)) {
                await setInputValue(active, value);
                return true;
            }

            element.textContent = String(value);
        }

        dispatchValueEvents(element);
        await sleep(150);
        return true;
    };

    const openAllResearches = async () => {
        const form = await waitForCondition(() => barsAdapter.findOrderForm(), 15000, 300);
        if (!form) {
            return { clicked: false, confirmed: false, reason: 'order_form_not_found', count: 0 };
        }

        const exactRow = barsAdapter.findAllResearchesRow(form);
        if (!exactRow) {
            return {
                clicked: false,
                confirmed: false,
                reason: 'all_res_not_found',
                count: getCheckboxes().length
            };
        }

        const waitForAuthoritativeAllRows = (beforeRows, timeout = 15000) => {
            const startedAt = Date.now();
            return waitForCondition(() => {
                const currentRow = barsAdapter.findAllResearchesRow(form);
                if (!barsAdapter.isAllResearchesActive(currentRow)) {
                    return null;
                }

                const afterRows = barsAdapter.captureResearchRows(form);
                if (barsAdapter.hasResearchRowsTransition(beforeRows, afterRows)) {
                    return afterRows;
                }

                const runtimeState = barsAdapter.getOrderRuntimeState(form);
                const sourceReadyWithoutDomReplacement = Date.now() - startedAt >= 800
                    && afterRows.count > 0
                    && runtimeState.available
                    && runtimeState.initialized
                    && runtimeState.activeGroup === 'ALL_RES'
                    && runtimeState.researchRowCount === afterRows.count;
                return sourceReadyWithoutDomReplacement ? afterRows : null;
            }, timeout, 180);
        };

        const runtimeBeforeWait = barsAdapter.getOrderRuntimeState(form);
        let runtimeReady = runtimeBeforeWait;
        let runtimeFirstTimeWasObservedTrue = runtimeBeforeWait.isFirstTime === true;
        if (!runtimeBeforeWait.available
            || !runtimeBeforeWait.initialized
            || !runtimeBeforeWait.hasResearchOnChange) {
            const readInitializedRuntime = () => {
                const state = barsAdapter.getOrderRuntimeState(form);
                runtimeFirstTimeWasObservedTrue = runtimeFirstTimeWasObservedTrue
                    || state.isFirstTime === true;
                return state.available && state.initialized && state.hasResearchOnChange
                    ? state
                    : null;
            };
            runtimeReady = await waitForCondition(readInitializedRuntime, 2500, 180);

            // A visible true is authoritative and means the source handler is
            // intentionally disabled. Give BARS initialization one bounded
            // continuation instead of burning all three attempts too quickly.
            if (!runtimeReady && runtimeFirstTimeWasObservedTrue) {
                runtimeReady = await waitForCondition(readInitializedRuntime, 10000, 220);
            }

            if (!runtimeReady) {
                const runtimeAfterWait = barsAdapter.getOrderRuntimeState(form);
                runtimeFirstTimeWasObservedTrue = runtimeFirstTimeWasObservedTrue
                    || runtimeAfterWait.isFirstTime === true;
                const currentForm = barsAdapter.findOrderForm();
                const currentAllRow = barsAdapter.findAllResearchesRow(form);
                const exactDomFallbackReady = currentForm === form
                    && form.isConnected
                    && currentAllRow?.isConnected
                    // A known true value must still be respected: BARS ignores
                    // the group handler while Form.isFirstTime is true. A null
                    // value is normal in the observed D3 build, where the source
                    // row event remains the only usable public contract.
                    && !runtimeFirstTimeWasObservedTrue;

                if (!exactDomFallbackReady) {
                    return {
                        clicked: false,
                        requested: false,
                        confirmed: false,
                        reason: 'order_form_initialization_timeout',
                        count: getCheckboxes().length,
                        runtimeBeforeWait,
                        runtimeAfterWait,
                        runtimeFirstTimeWasObservedTrue
                    };
                }

                runtimeReady = {
                    ...runtimeAfterWait,
                    degraded: true,
                    method: 'exact_dom_source_fallback',
                    runtimeFirstTimeWasObservedTrue
                };
            }
        }

        const readyForm = barsAdapter.findOrderForm();
        if (!readyForm || !readyForm.isConnected) {
            return {
                clicked: false,
                requested: false,
                confirmed: false,
                reason: 'order_form_disappeared_during_initialization',
                count: getCheckboxes().length,
                runtimeBeforeWait,
                runtimeReady
            };
        }
        if (readyForm !== form) {
            return {
                clicked: false,
                requested: false,
                confirmed: false,
                reason: 'order_form_replaced_during_initialization',
                count: getCheckboxes().length,
                runtimeBeforeWait,
                runtimeReady
            };
        }

        const loadState = allResearchLoadStates.get(form);
        if (loadState?.pending && loadState.beforeRows) {
            const transitionedRows = await waitForAuthoritativeAllRows(loadState.beforeRows);
            if (!transitionedRows) {
                allResearchLoadStates.delete(form);
                return {
                    clicked: false,
                    requested: true,
                    confirmed: false,
                    reason: 'all_res_transition_timeout',
                    method: loadState.method || 'pending',
                    count: getCheckboxes().length,
                    runtimeBeforeWait,
                    runtimeReady,
                    beforeRows: describeResearchRows(loadState.beforeRows),
                    afterRows: describeResearchRows(barsAdapter.captureResearchRows(form))
                };
            }

            allResearchLoadStates.set(form, { pending: false, confirmed: true });
            const count = await waitForCheckboxesToSettle();
            return {
                clicked: false,
                requested: true,
                confirmed: true,
                reason: 'pending_confirmed',
                method: loadState.method || 'pending',
                count,
                runtimeBeforeWait,
                runtimeReady,
                beforeRows: describeResearchRows(loadState.beforeRows),
                afterRows: describeResearchRows(transitionedRows)
            };
        }

        const beforeRows = barsAdapter.captureResearchRows(form);
        const runtimeBeforeRequest = barsAdapter.getOrderRuntimeState(form);
        const request = barsAdapter.requestAllResearches(form);
        if (!request.requested) {
            return {
                clicked: false,
                confirmed: false,
                reason: 'all_res_request_failed',
                failedMethods: request.failedMethods || [],
                count: beforeRows.count,
                runtimeBeforeWait,
                runtimeReady,
                runtimeBeforeRequest,
                beforeRows: describeResearchRows(beforeRows)
            };
        }

        allResearchLoadStates.set(form, {
            pending: true,
            confirmed: false,
            beforeRows,
            method: request.method
        });
        const transitionedRows = await waitForAuthoritativeAllRows(beforeRows);

        if (!transitionedRows) {
            console.warn('GridGroups/ALL_RES активирован, но обновление GridResearch не подтверждено.');
            allResearchLoadStates.delete(form);
            return {
                clicked: true,
                requested: true,
                confirmed: false,
                reason: 'all_res_transition_timeout',
                method: request.method,
                failedMethods: request.failedMethods || [],
                count: getCheckboxes().length,
                runtimeBeforeWait,
                runtimeReady,
                runtimeBeforeRequest,
                runtimeAfterRequest: barsAdapter.getOrderRuntimeState(form),
                beforeRows: describeResearchRows(beforeRows),
                afterRows: describeResearchRows(barsAdapter.captureResearchRows(form))
            };
        }

        allResearchLoadStates.set(form, { pending: false, confirmed: true });
        const count = await waitForCheckboxesToSettle();
        console.log(`Открыт штатный раздел GridGroups/ALL_RES. Текущих чек-боксов: ${count}`);

        return {
            clicked: true,
            requested: true,
            confirmed: true,
            reason: request.method,
            method: request.method,
            failedMethods: request.failedMethods || [],
            count,
            runtimeBeforeWait,
            runtimeReady,
            runtimeBeforeRequest,
            runtimeAfterRequest: barsAdapter.getOrderRuntimeState(form),
            beforeRows: describeResearchRows(beforeRows),
            afterRows: describeResearchRows(transitionedRows)
        };
    };

    const trySetPageSizeTo150 = async () => {
        const currentCount = getCheckboxes().length;
        const form = barsAdapter.findOrderForm();
        const initialRangeState = barsAdapter.getRangeState(form);
        const pendingPageSize = pageSizeLoadStates.get(form);

        if (pendingPageSize?.pending && pendingPageSize.beforeRows) {
            const application = await waitForPageSizeApplication(
                form,
                pendingPageSize.beforeRows,
                pendingPageSize.beforeRangeState || initialRangeState,
                15000
            );
            if (!application) {
                return {
                    changed: false,
                    reason: 'page_size_transition_timeout',
                    count: getCheckboxes().length,
                    applied: false,
                    requestIssued: true,
                    pending: true
                };
            }

            pageSizeLoadStates.set(form, { pending: false, confirmed: true });
            const count = await waitForCheckboxesToSettle();
            return {
                changed: true,
                reason: pendingPageSize.reason || initialRangeState.variant,
                count,
                applied: true,
                requestIssued: true,
                pending: false,
                rowsTransitioned: true
            };
        }

        if (initialRangeState.pageSize === TARGET_PAGE_SIZE) {
            return {
                changed: false,
                reason: initialRangeState.variant,
                count: currentCount,
                applied: true,
                requestIssued: false,
                pending: false
            };
        }

        if (currentCount >= TARGET_PAGE_SIZE) {
            return {
                changed: false,
                reason: 'already_full',
                count: currentCount,
                applied: true,
                requestIssued: false,
                pending: false
            };
        }

        const beforeRows = barsAdapter.captureResearchRows(form);
        const pageSizeRequest = barsAdapter.requestPageSize(TARGET_PAGE_SIZE, form);
        if (pageSizeRequest.requested) {
            const reason = pageSizeRequest.method === 'legacy_range' ? 'bars_range' : pageSizeRequest.method;
            pageSizeLoadStates.set(form, {
                pending: true,
                confirmed: false,
                beforeRows,
                beforeRangeState: initialRangeState,
                reason
            });
            const application = await waitForPageSizeApplication(form, beforeRows, initialRangeState);
            const count = application ? await waitForCheckboxesToSettle() : getCheckboxes().length;

            if (application) {
                pageSizeLoadStates.set(form, { pending: false, confirmed: true });
                console.log(`[FillBARS] Пагинация: штатный ${reason} применён (${count} записей на странице).`);
            } else {
                console.warn(`[FillBARS] Пагинация: ${reason} изменил Range, но не подтвердил новое поколение строк.`);
            }

            return {
                changed: !!application,
                reason,
                count,
                applied: !!application,
                requestIssued: true,
                pending: !application,
                rowsTransitioned: application?.rowsTransitioned === true
            };
        }

        const root = getResearchGridRoot();
        const pageSizes = new Set(['5', '10', '15', '20', '25', '30', '50', '100']);
        const editableSelector = 'input[type="number"], input[type="text"], input:not([type]), textarea, [contenteditable="true"]';
        const isPotentialPageSizeInput = (input, allowEmpty = false) => {
            const value = 'value' in input ? String(input.value).trim() : input.textContent.trim();
            const marker = `${input.id || ''} ${input.name || ''} ${input.className || ''} ${input.getAttribute('aria-label') || ''}`;
            const hasPageSizeMarker = /pagesize|page-size|size|row|limit|count|record|perpage|per-page|запис|строк|размер|колич/i.test(marker);

            return isVisible(input)
                && !input.disabled
                && !input.readOnly
                && isPagerArea(input, root)
                && (pageSizes.has(value) || hasPageSizeMarker || (allowEmpty && value === ''));
        };
        const describePaginationControl = (element) => ({
            tag: element?.tagName || '',
            id: element?.id || '',
            name: element?.getAttribute('name') || '',
            cmptype: element?.getAttribute('cmptype') || '',
            className: String(element?.className || ''),
            title: element?.getAttribute('title') || '',
            onclick: element?.getAttribute('onclick') || '',
            type: element?.getAttribute('type') || '',
            value: 'value' in (element || {}) ? String(element.value || '') : ''
        });

        const rangeCountTriggers = Array.from(root.querySelectorAll('span[title]'))
            .filter((element) => isVisible(element)
                && isPagerArea(element, root)
                && normalizeText(element.getAttribute('title')) === 'записей');

        for (const trigger of rangeCountTriggers) {
            const beforeEditorRows = barsAdapter.captureResearchRows(form);
            const beforeEditorRangeState = barsAdapter.getRangeState(form);
            const knownVisibleEditors = new Set(Array.from(root.querySelectorAll(editableSelector)).filter(isVisible));
            clickElement(trigger, false);
            await sleep(200);

            const active = document.activeElement;
            const editor = active && /^(INPUT|TEXTAREA)$/i.test(active.tagName)
                && isPotentialPageSizeInput(active, true)
                ? active
                : Array.from(root.querySelectorAll(editableSelector))
                    .filter((candidate) => isPotentialPageSizeInput(candidate, true))
                    .find((candidate) => !knownVisibleEditors.has(candidate));

            if (!editor) {
                console.log(`[FillBARS] Пагинация Range: редактор не найден ${JSON.stringify(describePaginationControl(trigger))}`);
                continue;
            }

            if (/^(INPUT|TEXTAREA)$/i.test(editor.tagName)) {
                await setInputValue(editor, TARGET_PAGE_SIZE);
            } else {
                await setEditableText(editor, TARGET_PAGE_SIZE);
            }

            pageSizeLoadStates.set(form, {
                pending: true,
                confirmed: false,
                beforeRows: beforeEditorRows,
                beforeRangeState: beforeEditorRangeState,
                reason: 'bars_range_editor'
            });
            const application = await waitForPageSizeApplication(
                form,
                beforeEditorRows,
                beforeEditorRangeState
            );
            const count = application ? await waitForCheckboxesToSettle() : getCheckboxes().length;
            if (application) {
                pageSizeLoadStates.set(form, { pending: false, confirmed: true });
                console.log(`[FillBARS] Пагинация: штатный контрол Range БАРС применён (${count} записей на странице).`);
            } else {
                console.warn('[FillBARS] Редактор Range не подтвердил новое поколение строк после применения 150.');
            }
            return {
                changed: !!application,
                reason: 'bars_range_editor',
                count,
                applied: !!application,
                requestIssued: true,
                pending: !application,
                rowsTransitioned: application?.rowsTransitioned === true
            };
        }

        return {
            changed: false,
            applied: false,
            requestIssued: false,
            pending: false,
            reason: 'not_found',
            count: getCheckboxes().length
        };
    };

    const ASSIGNMENT_CABINET_LABEL = normalizeText(targetCabinetName);
    const ASSIGNMENT_CABINET_TOKENS = ASSIGNMENT_CABINET_LABEL.split(' ').filter(Boolean);
    const compactValue = (value, seen = new WeakSet(), depth = 0) => {
        if (value === undefined || value === null) {
            return value;
        }

        if (typeof value === 'string') {
            return value.length > 180 ? `${value.slice(0, 180)}...` : value;
        }

        if (Array.isArray(value)) {
            if (depth >= 7 || seen.has(value)) {
                return '[структура ограничена]';
            }
            seen.add(value);
            return value.slice(0, 20).map((entry) => compactValue(entry, seen, depth + 1));
        }

        if (typeof value === 'object') {
            if (depth >= 7 || seen.has(value)) {
                return '[структура ограничена]';
            }
            seen.add(value);
            try {
                return Object.fromEntries(
                    Object.entries(value).slice(0, 80)
                        .map(([key, entryValue]) => [key, compactValue(entryValue, seen, depth + 1)])
                );
            } catch (error) {
                return '[объект недоступен]';
            }
        }

        return value;
    };

    const debugLog = (event, details = {}) => {
        const entry = {
            time: new Date().toISOString(),
            event,
            details: compactValue(details)
        };

        const sanitizeForSavedDiagnostic = (value, key = '', seen = new WeakSet(), depth = 0) => {
            if (/^(error|location|title|url|href|patient|persmedcard|medicalcardnumber|fullname|birthdate|fio|text|innertext|textcontent|label)$/i.test(key)) {
                return undefined;
            }
            if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
                return value;
            }
            if (typeof value === 'string') {
                return value.replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'<>]+/gi, '[адрес удалён]').slice(0, 1600);
            }
            if (depth >= 7) {
                return '[глубина ограничена]';
            }
            if (typeof value === 'object' && seen.has(value)) {
                return '[циклическая ссылка]';
            }
            if (typeof value === 'object') {
                seen.add(value);
            }
            if (Array.isArray(value)) {
                return value.slice(0, 100)
                    .map((item) => sanitizeForSavedDiagnostic(item, key, seen, depth + 1))
                    .filter((item) => item !== undefined);
            }
            if (typeof value === 'object') {
                try {
                    return Object.fromEntries(
                        Object.entries(value).slice(0, 80)
                            .map(([entryKey, entryValue]) => [
                                entryKey,
                                sanitizeForSavedDiagnostic(entryValue, entryKey, seen, depth + 1)
                            ])
                            .filter(([, entryValue]) => entryValue !== undefined)
                    );
                } catch (error) {
                    return '[объект недоступен]';
                }
            }
            return String(value).slice(0, 500);
        };

        const savedEntry = {
            id: `${diagnosticRunId || 'page'}:${diagnosticPageInstanceId}:${++diagnosticSequence}`,
            time: entry.time,
            event: entry.event,
            details: sanitizeForSavedDiagnostic(entry.details)
        };
        diagnosticEntries.push(savedEntry);
        if (diagnosticEntries.length > 250) {
            diagnosticEntries.splice(0, diagnosticEntries.length - 250);
        }
        postDiagnosticToBridge({ kind: 'append', ...savedEntry });

        console.log(`[FillBARS] ${event}`, entry.details);
        return entry;
    };

    const getRequestedItemValues = () => Object.keys(formData).filter((itemValue) => formData[itemValue] === true || formData[itemValue] === false);
    const getRequestedSelectedItemValues = () => Object.keys(formData).filter((itemValue) => formData[itemValue] === true);
    const getSkippedUrgentResult = () => ({
        selected: 0,
        total: 0,
        stopped: false,
        skipped: true,
        complete: true,
        reason: 'urgent_not_requested'
    });
    const applyUrgentToSelectedResearches = async () => {
        const requestedItemValues = getRequestedSelectedItemValues();
        const itemResults = [];
        const failedItemValues = [];
        let selected = 0;
        let rowsSelected = 0;
        let rowsTotal = 0;

        debugLog('urgent:apply_start', {
            total: requestedItemValues.length,
            requestedItemValues
        });

        for (const itemValue of requestedItemValues) {
            const rawResult = typeof barsAdapter.requestDirlineCito === 'function'
                ? barsAdapter.requestDirlineCito(itemValue, true, barsAdapter.findOrderForm())
                : {
                    itemValue,
                    requested: false,
                    confirmed: false,
                    totalRows: 0,
                    confirmedRows: 0,
                    reason: 'adapter_method_missing'
                };
            const result = {
                itemValue,
                requested: rawResult.requested === true,
                confirmed: rawResult.confirmed === true,
                totalRows: Number(rawResult.totalRows) || 0,
                confirmedRows: Number(rawResult.confirmedRows) || 0,
                disabledCount: Number(rawResult.disabledCount) || 0,
                methods: Array.isArray(rawResult.methods) ? rawResult.methods : [],
                reason: rawResult.reason || 'cito_not_confirmed'
            };

            itemResults.push(result);
            rowsSelected += result.confirmedRows;
            rowsTotal += result.totalRows;
            if (result.confirmed) {
                selected += 1;
            } else {
                failedItemValues.push(itemValue);
            }

            debugLog('urgent:item_result', result);
            await sleep(80);
        }

        const complete = requestedItemValues.length > 0
            && selected === requestedItemValues.length
            && failedItemValues.length === 0;
        const result = {
            selected,
            total: requestedItemValues.length,
            rowsSelected,
            rowsTotal,
            stopped: !complete,
            skipped: false,
            complete,
            reason: complete ? 'cito_applied' : 'cito_selection_incomplete',
            failedItemValues,
            itemResults
        };
        debugLog('urgent:apply_complete', result);
        return result;
    };

    debugLog('fill:start', {
        diagnosticRunId,
        profileName,
        assignmentStage: normalizedAssignmentStage,
        targetCabinetName,
        shouldMarkUrgent,
        location: window.location.href,
        title: document.title,
        requestedTotal: getRequestedItemValues().length,
        requestedSelected: Object.values(formData).filter((value) => value === true).length,
        requestedCleared: Object.values(formData).filter((value) => value === false).length,
        requestedItemValues: getRequestedItemValues(),
        resumeScheduleOnly
    });

    const getVisibleElements = (selector, root = document) => {
        return Array.from(root.querySelectorAll(selector)).filter(isVisible);
    };

    const getTopWindow = () => {
        try {
            return window.top || window;
        } catch (error) {
            return window;
        }
    };

    const readBarsVar = (name, fromParent = false) => {
        const candidates = fromParent
            ? [window, window.parent, getTopWindow()]
            : [window, getTopWindow()];

        for (const candidate of candidates) {
            try {
                if (candidate && typeof candidate.getVar === 'function') {
                    const values = fromParent
                        ? [candidate.getVar(name, 1), candidate.getVar(name)]
                        : [candidate.getVar(name), candidate.getVar(name, 1)];

                    for (const value of values) {
                        if (value !== undefined && value !== null && String(value).trim() !== '') {
                            return value;
                        }
                    }
                }
            } catch (error) {
                // Some frames can be inaccessible; continue with the next context.
            }
        }

        return '';
    };

    const readFirstBarsVar = (names, fromParent = false) => {
        for (const name of names) {
            const value = readBarsVar(name, fromParent);
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return value;
            }
        }
        return '';
    };

    const hasPatientContextForLab = () => !!readFirstBarsVar(
        ['PERSMEDCARD', 'PATIENT_ID', 'PATIENT'],
        true
    );

    const isResearchOrderFormOpen = () => !!barsAdapter.findOrderForm();

    const getSameOriginContexts = () => {
        return [window, window.parent, getTopWindow()]
            .filter((candidate, index, list) => candidate && list.indexOf(candidate) === index);
    };

    const findOpenLabButton = () => {
        const sourceSelectors = [
            '[name="byNaprAnalyseLab"]',
            '[name="linkDirLineOrder"]',
            '[onclick*=".openDirLineOrder"]'
        ];
        for (const selector of sourceSelectors) {
            const candidate = getVisibleElements(selector).at(-1) || null;
            if (candidate) {
                return candidate;
            }
        }
        return null;
    };

    const openResearchOrderViaApi = () => {
        const patientId = readFirstBarsVar(['PERSMEDCARD', 'PATIENT_ID', 'PATIENT'], true);

        if (!patientId) {
            return false;
        }

        for (const context of getSameOriginContexts()) {
            try {
                if (typeof context.openD3Form === 'function') {
                    context.openD3Form('Lis/Dirline/dirline_order_alt', true, {
                        width: '100%',
                        height: '100%',
                        vars: {
                            PATIENT: patientId,
                            DISEASECASE: readFirstBarsVar(['DISEASECASE', 'DISEASECASES'], false),
                            HH_DEP_ID: readBarsVar('HH_DEP_ID', true),
                            REG_DIR_SERV: readFirstBarsVar(['REG_DIR_SERV', 'DIR_SERVICE'], false),
                            REG_VISIT: readFirstBarsVar(['REG_VISIT', 'VISIT'], false),
                            ACTIVE_CHECK_DIR: true,
                            ACTIVE_CHECK_SCH: true,
                            DISEASE_HISTORY_PK_ID: readBarsVar('DISEASE_HISTORY_PK_ID', false)
                        }
                    });
                    return true;
                }
            } catch (error) {
                console.warn('[FillBARS] Не удалось открыть заказ исследований через openD3Form', error);
            }
        }

        return false;
    };

    const findLabHistoryLink = () => {
        return getVisibleElements('span, a, td, div')
            .filter((element) => {
                const label = getElementLabel(element);
                const onclick = normalizeText(element.getAttribute('onclick'));
                return label.includes('лабораторные исследования')
                    && onclick.includes('openonlinkwindow')
                    && onclick.includes('analyses');
            })[0] || null;
    };

    const openResearchOrderByClicks = async () => {
        const existingDirectionButton = findOpenLabButton();
        if (existingDirectionButton) {
            debugLog('lab_open:button_click', { button: describeElement(existingDirectionButton) });
            clickElement(existingDirectionButton, false);
            return !!await waitForCondition(isResearchOrderFormOpen, 15000, 300);
        }

        const labHistoryLink = findLabHistoryLink();
        if (!labHistoryLink) {
            return false;
        }

        debugLog('lab_open:history_link_click', { link: describeElement(labHistoryLink) });
        clickElement(labHistoryLink, false);

        const directionButton = await waitForCondition(findOpenLabButton, 8000, 250);
        if (!directionButton) {
            return false;
        }

        debugLog('lab_open:direction_button_click', { button: describeElement(directionButton) });
        clickElement(directionButton, false);
        return !!await waitForCondition(isResearchOrderFormOpen, 15000, 300);
    };

    const openLabFromPatientCard = async () => {
        if (isResearchOrderFormOpen()) {
            return { opened: false, reason: 'already_open' };
        }

        const topWindow = getTopWindow();
        try {
            if (topWindow.__FillBARS_OPENING_LAB_LOCK && Date.now() - topWindow.__FillBARS_OPENING_LAB_LOCK < 15000) {
                await waitForCondition(isResearchOrderFormOpen, 15000, 300);
                return { opened: isResearchOrderFormOpen(), reason: 'waited_existing_open' };
            }
            topWindow.__FillBARS_OPENING_LAB_LOCK = Date.now();
        } catch (error) {
            // Cross-frame lock is best-effort only.
        }

        if (await openResearchOrderByClicks()) {
            debugLog('lab_open:click_path');
        } else if (!hasPatientContextForLab()) {
            return { opened: false, reason: 'no_patient_context' };
        } else if (openResearchOrderViaApi()) {
            debugLog('lab_open:api_call');
        } else {
            return { opened: false, reason: 'no_open_method' };
        }

        const opened = await waitForCondition(isResearchOrderFormOpen, 20000, 300);
        return { opened: !!opened, reason: opened ? 'opened' : 'timeout' };
    };

    const isVisibleOrInsideVisibleControl = (element) => {
        if (!element || !element.isConnected) {
            return false;
        }

        if (isVisible(element)) {
            return true;
        }

        let current = element.parentElement;
        let depth = 0;
        while (current && depth < 4) {
            if (isVisible(current)) {
                return true;
            }

            current = current.parentElement;
            depth++;
        }

        return false;
    };

    const describeElement = (element) => {
        if (!element) {
            return null;
        }

        const rect = element.getBoundingClientRect();

        return {
            tag: element.tagName,
            id: element.id || '',
            className: String(element.className || ''),
            name: element.name || '',
            type: element.type || '',
            title: element.title || '',
            text: getElementLabel(element),
            rect: {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            },
            visible: isVisibleOrInsideVisibleControl(element)
        };
    };

    const getClickableSurface = (element, stopRoot = document.body) => {
        let current = element;
        let depth = 0;

        while (current && current !== stopRoot && depth < 4) {
            if (isVisible(current)) {
                return current;
            }

            current = current.parentElement;
            depth++;
        }

        return element;
    };

    const waitForCondition = async (predicate, timeout = 10000, interval = 250) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeout) {
            const result = predicate();
            if (result) {
                return result;
            }

            await sleep(interval);
        }

        return null;
    };

    const getCurrentResearchPageInfo = () => {
        const state = barsAdapter.getRangeState(barsAdapter.findOrderForm());
        return {
            variant: state.variant,
            current: state.current,
            total: state.total,
            pageSize: state.pageSize,
            rowCount: state.rowCount,
            text: state.text,
            totalKnown: state.totalKnown,
            nextControl: !!state.nextControl
        };
    };

    const clickNextResearchPage = async () => {
        const form = barsAdapter.findOrderForm();
        const pageInfo = getCurrentResearchPageInfo();
        if (!form || !barsAdapter.hasNextPage(pageInfo)) {
            return false;
        }

        const previousSignature = barsAdapter.getPageSignature(form);
        const previousRows = barsAdapter.captureResearchRows(form);
        const request = barsAdapter.requestNextPage(form);
        if (!request.requested) {
            return false;
        }

        const transitioned = await waitForCondition(() => {
            const nextInfo = getCurrentResearchPageInfo();
            const nextSignature = barsAdapter.getPageSignature(form);
            const nextRows = barsAdapter.captureResearchRows(form);
            return nextSignature !== previousSignature
                && barsAdapter.hasResearchRowsTransition(previousRows, nextRows)
                && (nextInfo.current === null
                    || pageInfo.current === null
                    || nextInfo.current > pageInfo.current);
        }, 8000, 250);

        if (!transitioned) {
            debugLog('research_pages:transition_timeout', {
                method: request.method,
                before: pageInfo,
                after: getCurrentResearchPageInfo(),
                previousSignature,
                currentSignature: barsAdapter.getPageSignature(form)
            });
            return false;
        }

        await waitForCheckboxesToSettle();
        return true;
    };

    const getZIndex = (element) => {
        const parsed = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const sortByWindowStack = (left, right) => {
        const zIndexDiff = getZIndex(left) - getZIndex(right);
        if (zIndexDiff !== 0) {
            return zIndexDiff;
        }

        if (left === right) {
            return 0;
        }

        return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    };

    const getWindowRoot = (element) => {
        return element?.closest('table.window.WinContent, .window.WinContent, .window') || element;
    };

    const getVisibleWindows = () => {
        return getVisibleElements('table.window.WinContent, .window.WinContent');
    };

    const getTopVisibleWindow = (predicate = () => true) => {
        return getVisibleWindows()
            .filter(predicate)
            .sort(sortByWindowStack)
            .at(-1) || null;
    };

    const getResearchOrderRoot = () => barsAdapter.findOrderForm();

    const getResearchGridRoot = () => {
        const orderRoot = getResearchOrderRoot();
        return barsAdapter.getResearchGrid(orderRoot) || emptyResearchRoot;
    };

    const waitForResearchGridStable = async (minStableMs = 1200, timeout = 8000) => {
        const startedAt = Date.now();
        let lastSignature = '';
        let stableSince = Date.now();

        while (Date.now() - startedAt < timeout) {
            await sleep(250);

            const checkboxes = getCheckboxes();
            const rect = getResearchGridRoot().getBoundingClientRect();
            const signature = [
                checkboxes.length,
                Math.round(rect.left),
                Math.round(rect.top),
                Math.round(rect.width),
                Math.round(rect.height),
                checkboxes.slice(0, 10).map(getCheckboxItemValue).join(',')
            ].join('|');

            if (signature !== lastSignature) {
                lastSignature = signature;
                stableSince = Date.now();
            }

            if (checkboxes.length > 0 && Date.now() - stableSince >= minStableMs) {
                return checkboxes.length;
            }
        }

        return getCheckboxes().length;
    };

    const getSelectedOrderItemValues = (includeDiagnostics = false) => {
        const state = barsAdapter.getSelectedResearchState(getResearchOrderRoot());
        return {
            ...state,
            sources: includeDiagnostics ? state.sources.slice(0, 50).map(describeElement) : [],
            diagnosticOutsideItemValueCount: 0,
            diagnosticOutsideItemValues: []
        };
    };

    const describeResearchScope = () => {
        const orderRoot = getResearchOrderRoot();
        const gridRoot = getResearchGridRoot();
        const visibleGrids = getVisibleElements('[name="GridResearch"]').map((grid) => describeElement(grid));
        const selectedValues = getSelectedOrderItemValues(true);
        return {
            orderRoot: describeElement(orderRoot === document ? document.body : orderRoot),
            gridRoot: describeElement(gridRoot === document ? document.body : gridRoot),
            visibleGridCount: visibleGrids.length,
            visibleGrids,
            scopedCheckboxCount: getCheckboxes().length,
            globalCheckboxCount: Array.from(document.querySelectorAll(CHECKBOX_SELECTOR))
                .filter((checkbox) => getCheckboxItemValue(checkbox)).length,
            selectedOrderItemValueCount: selectedValues.values.size,
            selectedOrderSourceCount: selectedValues.sourceCount,
            selectedOrderItemValues: Array.from(selectedValues.values),
            selectedOrderSources: selectedValues.sources,
            diagnosticOutsideItemValueCount: selectedValues.diagnosticOutsideItemValueCount,
            diagnosticOutsideItemValues: selectedValues.diagnosticOutsideItemValues
        };
    };

    const describeOrderGridSnapshots = () => {
        const orderRoot = getResearchOrderRoot();
        return getVisibleElements('.grid, .selected_values, [name*="Grid"], table', orderRoot || document)
            .filter((element) => !getResearchGridRoot().contains(element) || element === getResearchGridRoot())
            .slice(0, 30)
            .map((element) => {
                const checkboxes = Array.from(element.querySelectorAll('input[type="checkbox"]'));
                return {
                    element: describeElement(element),
                    checkboxCount: checkboxes.length,
                    checkedCount: checkboxes.filter((checkbox) => checkbox.checked).length,
                    itemValues: Array.from(element.querySelectorAll('[item_value]'))
                        .slice(0, 80)
                        .map((item) => ({
                            name: item.name || '',
                            itemValue: item.getAttribute('item_value'),
                            checked: 'checked' in item ? item.checked : undefined,
                            text: getElementLabel(item)
                        }))
                };
            });
    };

    const ensureResearchOrderFormReady = async () => {
        const openResult = await openLabFromPatientCard();
        debugLog('lab_open:result', openResult);
        debugLog('research_scope:after_lab_open', describeResearchScope());

        if (!openResult.opened && openResult.reason !== 'already_open') {
            return {
                ready: false,
                reason: openResult.reason,
                openResult,
                openAllAttempts: [],
                pageSizeResult: null,
                stableAfterPageSize: 0
            };
        }

        const readyAttempts = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
            const openAllResult = await openAllResearches();
            const stableAfterOpenAll = openAllResult.confirmed === true
                ? await waitForResearchGridStable(1200, 10000)
                : 0;
            const canPreparePagination = openAllResult.confirmed === true && stableAfterOpenAll > 0;
            const pageSizeResult = canPreparePagination
                ? await trySetPageSizeTo150()
                : {
                    changed: false,
                    applied: false,
                    requestIssued: false,
                    pending: false,
                    reason: openAllResult.confirmed ? 'research_rows_not_loaded' : 'all_res_not_confirmed',
                    count: getCheckboxes().length
                };
            const stableAfterPageSize = canPreparePagination
                ? await waitForResearchGridStable(1600, 9000)
                : 0;
            const checkboxCount = getCheckboxes().length;
            const pageSizePending = pageSizeLoadStates.get(barsAdapter.findOrderForm())?.pending === true;
            const pageSizeTransitionSafe = !pageSizePending
                && !(pageSizeResult.requestIssued === true
                && pageSizeResult.applied !== true);
            const attemptResult = {
                attempt,
                openAllResult,
                stableAfterOpenAll,
                pageSizeResult,
                stableAfterPageSize,
                checkboxCount,
                pageSizePending,
                pageSizeTransitionSafe,
                scope: describeResearchScope()
            };

            readyAttempts.push(attemptResult);
            debugLog('research_order:ready_attempt', attemptResult);

            if (openAllResult.confirmed === true && checkboxCount > 0) {
                debugLog('research_groups:open_all_result', {
                    result: openAllResult,
                    stableAfterOpenAll,
                    attempt,
                    scope: describeResearchScope()
                });

                debugLog('research_pages:page_size_result', {
                    pageSizeResult,
                    stableAfterPageSize,
                    scope: describeResearchScope()
                });

                return {
                    ready: true,
                    reason: openResult.reason,
                    openResult,
                    openAllAttempts: readyAttempts,
                    readyAttempts,
                    pageSizeResult,
                    stableAfterPageSize,
                    checkboxCount,
                    degradedPagination: !pageSizeTransitionSafe
                };
            }

            await sleep(700);
        }

        const lastAttempt = readyAttempts.at(-1);
        debugLog('research_groups:open_all_result', {
            result: lastAttempt?.openAllResult || null,
            stableAfterOpenAll: lastAttempt?.stableAfterOpenAll || 0,
            attempt: lastAttempt?.attempt || 0,
            scope: describeResearchScope()
        });

        debugLog('research_pages:page_size_result', {
            pageSizeResult: lastAttempt?.pageSizeResult || null,
            stableAfterPageSize: lastAttempt?.stableAfterPageSize || 0,
            scope: describeResearchScope()
        });

        return {
            ready: false,
            reason: lastAttempt?.pageSizeTransitionSafe === false
                ? 'page_size_transition_not_confirmed'
                : lastAttempt?.openAllResult?.reason || 'research_rows_not_loaded',
            openResult,
            openAllAttempts: readyAttempts,
            readyAttempts,
            pageSizeResult: lastAttempt?.pageSizeResult || null,
            stableAfterPageSize: lastAttempt?.stableAfterPageSize || 0
        };
    };

    const findScheduleForm = () => {
        return getVisibleElements('.form-schedule')
            .sort(sortByWindowStack)
            .at(-1) || null;
    };

    const findScheduleWindow = () => {
        const scheduleForm = findScheduleForm();
        return scheduleForm ? getWindowRoot(scheduleForm) : null;
    };

    const hasCabinetLabel = (label) => {
        return ASSIGNMENT_CABINET_TOKENS.length > 0
            && ASSIGNMENT_CABINET_TOKENS.every((token) => label.includes(token));
    };

    const getGridRoot = (element) => {
        return element?.closest('.grid, .grid_container, .grid-container') || element;
    };

    const getSelectableGridRow = (element, root) => {
        if (!element) {
            return null;
        }

        const row = element.closest('tr, [role="row"]');
        if (row && (!root || root.contains(row))) {
            return row;
        }

        const dataCell = element.closest('.column_data');
        if (dataCell && (!root || root.contains(dataCell))) {
            return dataCell;
        }

        return element;
    };

    const normalizeClickableCandidate = (element) => {
        return element.closest('.ctrl_button, button, input[type="button"], input[type="submit"], a') || element;
    };

    const deduplicateElements = (elements) => {
        const seen = new Set();

        return elements.filter((element) => {
            if (!element || seen.has(element)) {
                return false;
            }

            seen.add(element);
            return true;
        });
    };

    const getElementPositionKey = (element) => {
        const rect = element.getBoundingClientRect();
        return `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${element.name || ''}`;
    };

    const uniqueElementsByPosition = (elements) => {
        const seen = new Set();

        return elements.filter((element) => {
            const key = getElementPositionKey(element);
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    };

    const getScheduleGridRoot = (scheduleForm) => {
        return scheduleForm.querySelector('.selected_values') || scheduleForm;
    };

    const findColumnHeaderRect = (root, columnLabel) => {
        const normalizedColumnLabel = normalizeText(columnLabel);
        const headers = getVisibleElements('td, th, div, span', root)
            .filter((element) => {
                const label = getElementLabel(element);
                return label === normalizedColumnLabel
                    || label === `сортировать колонку: ${normalizedColumnLabel}`;
            })
            .sort((left, right) => {
                const leftLabel = getElementLabel(left);
                const rightLabel = getElementLabel(right);
                const leftPriority = (leftLabel === normalizedColumnLabel ? 10000 : 0) - leftLabel.length;
                const rightPriority = (rightLabel === normalizedColumnLabel ? 10000 : 0) - rightLabel.length;

                return rightPriority - leftPriority;
            });

        return headers[0]?.getBoundingClientRect() || null;
    };

    const isElementInColumn = (element, headerRect, tolerance = 35) => {
        if (!headerRect) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;

        return centerX >= headerRect.left - tolerance
            && centerX <= headerRect.right + tolerance
            && rect.top > headerRect.top;
    };

    const clickAssignButton = async () => {
        if (findScheduleForm()) {
            return true;
        }

        const root = getVisibleElements('.dirline_order_alt').at(-1) || document.body;
        const exactButtonOk = getVisibleElements('[name="ButtonOk"]', root)
            .map(normalizeClickableCandidate)
            .find(Boolean) || null;
        const candidates = deduplicateElements(
            Array.from(root.querySelectorAll('button, a, span, div, input[type="button"], input[type="submit"]'))
                .filter((element) => {
                    const label = getElementLabel(element);

                    return isVisible(element)
                        && label.includes('назначить')
                        && label.length <= 80
                        && element.querySelectorAll(CHECKBOX_SELECTOR).length === 0;
                })
                .map(normalizeClickableCandidate)
        ).sort((left, right) => {
            const leftLabel = getElementLabel(left);
            const rightLabel = getElementLabel(right);
            const leftPriority = (leftLabel === 'назначить' ? 10000 : 0)
                + (left.classList.contains('ctrl_button') ? 5000 : 0)
                + (/^(BUTTON|A|INPUT)$/i.test(left.tagName) ? 1000 : 0)
                - leftLabel.length;
            const rightPriority = (rightLabel === 'назначить' ? 10000 : 0)
                + (right.classList.contains('ctrl_button') ? 5000 : 0)
                + (/^(BUTTON|A|INPUT)$/i.test(right.tagName) ? 1000 : 0)
                - rightLabel.length;

            return rightPriority - leftPriority;
        });

        const target = exactButtonOk || candidates[0];
        if (!target) {
            console.warn('Кнопка "Назначить" не найдена. Подбор времени не открываю.');
            debugLog('assign_button:not_found');
            return false;
        }

        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        debugLog('assign_button:click', { target: describeElement(target) });
        clickElement(target, false);

        const scheduleForm = await waitForCondition(findScheduleForm, 15000);
        if (!scheduleForm) {
            console.warn('Окно "Подбор времени записи на услугу" не открылось.');
            debugLog('schedule:not_opened');
            return false;
        }

        console.log('Открыто окно "Подбор времени записи на услугу".');
        debugLog('schedule:opened', { scheduleForm: describeElement(scheduleForm) });
        return true;
    };

    const getScheduleCabinetGuideButtons = (scheduleForm) => {
        const cabinetHeaderRect = findColumnHeaderRect(scheduleForm, 'Кабинет');
        const buttons = uniqueElementsByPosition(
            Array.from(scheduleForm.querySelectorAll('.ctrl_ButtonEdit_ButGuide'))
                .filter(isVisible)
                .filter((button) => !button.closest('.grid_header'))
        );
        const buttonsInCabinetColumn = buttons.filter((button) => isElementInColumn(button, cabinetHeaderRect, 80));
        const resultButtons = buttonsInCabinetColumn.length > 0 ? buttonsInCabinetColumn : buttons;

        return resultButtons
            .sort((left, right) => {
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
            })
            .map((button) => ({
                button,
                row: button.closest('tr') || button.parentElement
            }));
    };

    const activateElementAtCenter = async (element, useDoubleClick = false, useNativeClick = false) => {
        if (!element || !element.isConnected) {
            debugLog('element_activate:missing', { useDoubleClick, useNativeClick });
            return false;
        }

        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        await sleep(60);

        if (!isVisible(element)) {
            debugLog('element_activate:not_visible', { element: describeElement(element), useDoubleClick, useNativeClick });
            return false;
        }

        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hitElement = document.elementFromPoint(centerX, centerY);
        const target = hitElement && (element.contains(hitElement) || hitElement.contains(element))
            ? hitElement
            : element;

        debugLog('element_activate:click', {
            element: describeElement(element),
            target: describeElement(target),
            centerX: Math.round(centerX),
            centerY: Math.round(centerY),
            useDoubleClick,
            useNativeClick
        });
        clickElement(target, useDoubleClick);

        if (useNativeClick && typeof target.click === 'function') {
            target.click();
        }

        await sleep(120);
        return true;
    };

    const isCabinetPickerWindow = (windowElement) => {
        if (!windowElement || !windowElement.isConnected || !isVisibleOrInsideVisibleControl(windowElement)) {
            return false;
        }

        if (windowElement.querySelector('.form-schedule')) {
            return false;
        }

        const label = getElementLabel(windowElement);
        return label.startsWith('кабинеты')
            || label.includes('кабинеты наименование')
            || label.includes('кабинетыструктура файла');
    };

    const waitForCabinetWindow = async (scheduleWindow, previousWindows, timeout = 8000) => {
        const cabinetWindow = await waitForCondition(() => {
            const candidates = getVisibleWindows()
                .filter((windowElement) => windowElement !== scheduleWindow)
                .filter(isCabinetPickerWindow)
                .sort(sortByWindowStack);
            const newCandidate = candidates
                .filter((windowElement) => !previousWindows.has(windowElement))
                .at(-1);

            return newCandidate || candidates.at(-1) || null;
        }, timeout, 200);

        if (cabinetWindow) {
            debugLog('cabinet_window:opened', {
                isNew: !previousWindows.has(cabinetWindow),
                window: describeElement(cabinetWindow)
            });
        } else {
            debugLog('cabinet_window:not_found', {
                windows: getVisibleWindows().map((windowElement) => ({
                    isPrevious: previousWindows.has(windowElement),
                    isCabinetPicker: isCabinetPickerWindow(windowElement),
                    containsScheduleForm: !!windowElement.querySelector('.form-schedule'),
                    window: describeElement(windowElement)
                }))
            });
        }

        return cabinetWindow;
    };

    const findCabinetRow = (cabinetWindow) => {
        const root = getGridRoot(cabinetWindow.querySelector('.grid.box-sizing-force.m2, .grid')) || cabinetWindow;
        const elements = Array.from(root.querySelectorAll('tr, [role="row"], td, div, span'))
            .filter(isVisibleOrInsideVisibleControl)
            .filter((element) => hasCabinetLabel(getElementLabel(element)))
            .sort((left, right) => {
                const leftLabel = getElementLabel(left);
                const rightLabel = getElementLabel(right);
                const leftPriority = (leftLabel === ASSIGNMENT_CABINET_LABEL ? 10000 : 0)
                    + (/^(TR)$/i.test(left.tagName) ? 500 : 0)
                    - leftLabel.length;
                const rightPriority = (rightLabel === ASSIGNMENT_CABINET_LABEL ? 10000 : 0)
                    + (/^(TR)$/i.test(right.tagName) ? 500 : 0)
                    - rightLabel.length;

                return rightPriority - leftPriority;
            });

        return getSelectableGridRow(elements[0], root);
    };

    const clickShortLabeledControl = async (root, labels) => {
        const normalizedLabels = labels.map(normalizeText);
        const candidates = deduplicateElements(
            Array.from(root.querySelectorAll('button, a, span, div, input[type="button"], input[type="submit"]'))
                .filter((element) => {
                    const label = getElementLabel(element);

                    return isVisibleOrInsideVisibleControl(element)
                        && normalizedLabels.includes(label)
                        && label.length <= 30;
                })
                .map((element) => getClickableSurface(normalizeClickableCandidate(element), root))
        ).sort((left, right) => getElementLabel(left).length - getElementLabel(right).length);

        const target = candidates[0];
        if (!target) {
            return false;
        }

        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        clickElement(target, false);
        await sleep(300);

        return true;
    };

    const openCabinetFilter = async (cabinetWindow) => {
        const gridRoot = getGridRoot(cabinetWindow.querySelector('.grid.box-sizing-force.m2, .grid')) || cabinetWindow;
        const beforeInputsCount = getVisibleElements('input[type="text"], input:not([type]), textarea', gridRoot).length;
        const filterButtons = Array.from(gridRoot.querySelectorAll('.toggleFilter, .toggleFilterSize, .fshow, .grid_label, [title="Фильтр"]'))
            .filter(isVisibleOrInsideVisibleControl)
            .filter((element) => {
                const label = getElementLabel(element);
                const marker = normalizeText(`${element.title || ''} ${element.className || ''}`);

                return marker.includes('фильтр') || label.includes('показать фильтр');
            });

        for (const button of filterButtons) {
            clickElement(getClickableSurface(button, gridRoot), false);
            await sleep(350);

            const afterInputsCount = getVisibleElements('input[type="text"], input:not([type]), textarea', gridRoot).length;
            const hasHideFilter = getElementLabel(gridRoot).includes('скрыть фильтр');

            if (afterInputsCount > beforeInputsCount || hasHideFilter) {
                return true;
            }
        }

        return false;
    };

    const clickFindInCabinetWindow = async (cabinetWindow) => {
        const gridRoot = getGridRoot(cabinetWindow.querySelector('.grid.box-sizing-force.m2, .grid')) || cabinetWindow;
        return clickShortLabeledControl(gridRoot, ['Найти']);
    };

    const filterCabinetWindow = async (cabinetWindow) => {
        await openCabinetFilter(cabinetWindow);

        const gridRoot = getGridRoot(cabinetWindow.querySelector('.grid.box-sizing-force.m2, .grid')) || cabinetWindow;
        const inputs = getVisibleElements('input[type="text"], input:not([type]), textarea', gridRoot)
            .filter((input) => !input.disabled && !input.readOnly)
            .sort((left, right) => {
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
            });

        console.log(`Окно "Кабинеты": полей фильтра найдено ${inputs.length}.`);
        debugLog('cabinet_filter:inputs_found', {
            inputCount: inputs.length,
            inputs: inputs.map(describeElement)
        });

        for (const input of inputs) {
            debugLog('cabinet_filter:set_value', { input: describeElement(input) });
            await setInputValue(input, targetCabinetName);
            await clickFindInCabinetWindow(cabinetWindow);
            await sleep(900);

            const row = findCabinetRow(cabinetWindow);
            if (row) {
                debugLog('cabinet_filter:row_found', { row: describeElement(row) });
                return row;
            }
        }

        debugLog('cabinet_filter:row_not_found');
        return null;
    };

    const isModalWindowOpen = (windowElement) => {
        return !!windowElement && windowElement.isConnected && isVisibleOrInsideVisibleControl(windowElement);
    };

    const waitForWindowToClose = async (windowElement, timeout = 5000) => {
        return waitForCondition(() => !isModalWindowOpen(windowElement), timeout, 200);
    };

    const dispatchEnter = (element) => {
        const target = element || document.activeElement || document.body;

        ['keydown', 'keypress', 'keyup'].forEach((type) => {
            target.dispatchEvent(new KeyboardEvent(type, {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13
            }));
        });
    };

    const dispatchEscape = (element) => {
        const target = element || document.activeElement || document.body;

        ['keydown', 'keypress', 'keyup'].forEach((type) => {
            target.dispatchEvent(new KeyboardEvent(type, {
                bubbles: true,
                cancelable: true,
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27
            }));
        });
    };

    const clickOkInWindow = async (windowElement) => {
        const windowRect = windowElement.getBoundingClientRect();
        const candidates = deduplicateElements(
            Array.from(windowElement.querySelectorAll('.ctrl_button, .btn_caption, button, a, span, div, input[type="button"], input[type="submit"]'))
                .filter((element) => {
                    const label = getElementLabel(element);
                    const rect = element.getBoundingClientRect();
                    const marker = normalizeText(`${element.className || ''} ${element.title || ''}`);
                    const isFooterButton = marker.includes('btn_center') && rect.top >= windowRect.bottom - 140;

                    return isVisibleOrInsideVisibleControl(element)
                        && !label.includes('отмена')
                        && !label.includes('найти')
                        && !label.includes('фильтр')
                        && !label.includes('очистить')
                        && (label === 'ок' || label === 'ok' || label === 'выбрать' || isFooterButton)
                        && label.length <= 30
                        && rect.top >= windowRect.top
                        && rect.bottom <= windowRect.bottom + 10;
                })
                .map((element) => getClickableSurface(normalizeClickableCandidate(element), windowElement))
        ).sort((left, right) => {
            const leftLabel = getElementLabel(left);
            const rightLabel = getElementLabel(right);
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            const leftPriority = (leftLabel === 'ок' || leftLabel === 'ok' ? 10000 : 0)
                + (leftLabel === 'выбрать' ? 7000 : 0)
                + (left.classList.contains('ctrl_button') ? 5000 : 0)
                + leftRect.top
                - leftLabel.length;
            const rightPriority = (rightLabel === 'ок' || rightLabel === 'ok' ? 10000 : 0)
                + (rightLabel === 'выбрать' ? 7000 : 0)
                + (right.classList.contains('ctrl_button') ? 5000 : 0)
                + rightRect.top
                - rightLabel.length;

            return rightPriority - leftPriority;
        });

        const okButton = candidates[0];
        if (!okButton) {
            return false;
        }

        okButton.scrollIntoView({ block: 'center', inline: 'nearest' });
        console.log(`Окно "Кабинеты": нажимаю "${getElementLabel(okButton) || 'ОК'}".`);
        debugLog('cabinet_confirm:ok_click', { button: describeElement(okButton) });
        clickElement(okButton, false);
        await sleep(500);

        return true;
    };

    const clickCancelInWindow = async (windowElement) => {
        debugLog('cabinet_close:try_cancel');
        const clickedCancel = await clickShortLabeledControl(windowElement, ['Отмена', 'Закрыть']);
        if (clickedCancel) {
            await sleep(500);
            return true;
        }

        const closeButtons = Array.from(windowElement.querySelectorAll('[title*="Закрыть"], .win_close, .win_closeButton, .close, .WinClose'))
            .filter(isVisibleOrInsideVisibleControl);

        for (const button of closeButtons) {
            debugLog('cabinet_close:close_button_click', { button: describeElement(button) });
            clickElement(getClickableSurface(button, windowElement), false);
            await sleep(500);
            return true;
        }

        debugLog('cabinet_close:no_cancel_button');
        return false;
    };

    const normalizeScheduleRowKey = (value) => {
        if (value === undefined || value === null) {
            return '';
        }

        const key = String(value).trim();
        return key && key !== 'null' && key !== 'undefined' ? key : '';
    };

    const getScheduleRowElement = (element) => element?.closest(
        'tr[cmptype="GridRow"], [cmptype="GridRow"][keyvalue], tr[keyvalue], [data-keyvalue], [data-rn]'
    ) || element?.closest('tr, [role="row"]') || null;

    const getDomScheduleRowKey = (element) => {
        const row = getScheduleRowElement(element);
        if (!row) {
            return '';
        }

        const key = [
            row.getAttribute?.('keyvalue'),
            row.getAttribute?.('data-keyvalue'),
            row.getAttribute?.('data-rn'),
            row.getAttribute?.('rn'),
            row.querySelector?.('input[name="GridServices_SelectList_Item"][item_value]')?.getAttribute('item_value')
        ].map(normalizeScheduleRowKey).find(Boolean);

        return key || '';
    };

    const listDomScheduleRows = (scheduleForm) => {
        const seenKeys = new Set();

        return getScheduleCabinetGuideButtons(scheduleForm).flatMap((guide) => {
            const row = getScheduleRowElement(guide.row || guide.button);
            const key = getDomScheduleRowKey(row);
            if (!key || seenKeys.has(key)) {
                return [];
            }

            seenKeys.add(key);
            return [{ key, rn: key, row, control: guide.button, source: 'dom' }];
        });
    };

    const listStableScheduleRows = (scheduleForm) => {
        if (typeof barsAdapter?.listScheduleRows === 'function') {
            try {
                const adapterRows = barsAdapter.listScheduleRows(scheduleForm);
                const seenKeys = new Set();
                const stableRows = (Array.isArray(adapterRows) ? adapterRows : []).flatMap((row) => {
                    const key = normalizeScheduleRowKey(row?.rn ?? row?.key ?? row?.keyValue ?? row?.keyvalue);
                    if (!key || seenKeys.has(key)) {
                        return [];
                    }

                    seenKeys.add(key);
                    return [{ ...row, key, rn: key, source: row?.source || 'bars_adapter' }];
                });

                if (stableRows.length > 0) {
                    return stableRows;
                }
            } catch (error) {
                debugLog('schedule_rows:adapter_error', { errorName: error?.name || 'Error' });
            }
        }

        return listDomScheduleRows(scheduleForm);
    };

    const findDomScheduleGuideByKey = (scheduleForm, rowKey) => {
        const expectedKey = normalizeScheduleRowKey(rowKey);
        if (!scheduleForm || !expectedKey) {
            return null;
        }

        return getScheduleCabinetGuideButtons(scheduleForm)
            .find((guide) => getDomScheduleRowKey(guide.row || guide.button) === expectedKey) || null;
    };

    const readDomScheduleCabinetState = (scheduleForm, rowKey) => {
        const guide = findDomScheduleGuideByKey(scheduleForm, rowKey);
        if (!guide) {
            return { found: false, value: '', caption: '', pending: false, source: 'dom' };
        }

        const row = getScheduleRowElement(guide.row || guide.button);
        const control = guide.button.closest?.('[cmptype="ButtonEdit"], .ctrl_ButtonEdit, .editControl')
            || row?.querySelector?.('[name="ctrlCABLAB"], [cmptype="ButtonEdit"]')
            || null;
        const input = control?.querySelector?.('input, textarea')
            || row?.querySelector?.('input[name="ctrlCABLAB"], [name="ctrlCABLAB"] input')
            || null;
        const value = [
            control?.getAttribute?.('value'),
            control?.getAttribute?.('data-value'),
            control?.value,
            input?.getAttribute?.('data-value'),
            input?.getAttribute?.('control_value'),
            input?.getAttribute?.('value'),
            input?.value
        ].map((item) => String(item ?? '').trim()).find(Boolean) || '';
        const caption = [
            control?.getAttribute?.('caption'),
            control?.getAttribute?.('data-caption'),
            input?.value,
            input?.getAttribute?.('value')
        ].map((item) => String(item ?? '').trim()).find(Boolean) || '';
        const pending = !!row?.querySelector?.('.loading, .loader, .ctrl_loading, [aria-busy="true"]')
            || control?.getAttribute?.('aria-busy') === 'true';

        return { found: true, value, caption, pending, source: 'dom' };
    };

    const readScheduleCabinetState = (scheduleForm, rowKey) => {
        const reader = typeof barsAdapter?.readScheduleCabinetState === 'function'
            ? barsAdapter.readScheduleCabinetState.bind(barsAdapter)
            : (typeof barsAdapter?.getScheduleRowState === 'function'
                ? barsAdapter.getScheduleRowState.bind(barsAdapter)
                : null);

        if (reader) {
            try {
                const state = reader(scheduleForm, rowKey);
                if (state && typeof state === 'object') {
                    const normalizedState = {
                        found: state.found === true,
                        value: String(state.value ?? '').trim(),
                        caption: String(state.caption ?? '').trim(),
                        pending: state.pending === true,
                        source: state.source || 'bars_adapter'
                    };
                    if (normalizedState.found) {
                        return normalizedState;
                    }

                    const domState = readDomScheduleCabinetState(scheduleForm, rowKey);
                    return domState.found ? domState : normalizedState;
                }
            } catch (error) {
                debugLog('schedule_row_state:adapter_error', {
                    rowKey,
                    errorName: error?.name || 'Error'
                });
            }
        }

        return readDomScheduleCabinetState(scheduleForm, rowKey);
    };

    const isExpectedCabinetValue = (state, expectedCabinet = null) => {
        const value = String(state?.value || '').trim();
        const caption = String(state?.caption || '').replace(/\s+/g, ' ').trim();
        if (!value || !caption) {
            return false;
        }

        const expectedId = String(expectedCabinet?.id || '').trim();
        if (expectedId) {
            return value === expectedId;
        }

        const expectedCaption = normalizeText(expectedCabinet?.caption || targetCabinetName);
        return !!expectedCaption && normalizeText(caption) === expectedCaption;
    };

    const isTargetCabinetState = (state, expectedCabinet = null) => !!state?.found
        && state.pending !== true
        && isExpectedCabinetValue(state, expectedCabinet);

    const waitForTargetCabinetState = async (rowKey, timeout = 15000, expectedCabinet = null) => {
        const startedAt = Date.now();
        let lastState = null;
        let missingSince = 0;
        let lastFingerprint = '';
        const observation = {
            sawPending: false,
            sawNonEmpty: false,
            sawTarget: false,
            sawTargetWhilePending: false,
            transitions: []
        };

        while (Date.now() - startedAt < timeout) {
            const scheduleForm = findScheduleForm();
            if (!scheduleForm) {
                return {
                    complete: false,
                    reason: 'schedule_form_disappeared',
                    state: lastState,
                    observation
                };
            }

            lastState = readScheduleCabinetState(scheduleForm, rowKey);
            const hasValue = String(lastState?.value || '').trim().length > 0;
            const hasCaption = String(lastState?.caption || '').trim().length > 0;
            const targetMatch = isExpectedCabinetValue(lastState, expectedCabinet);
            observation.sawPending ||= lastState?.pending === true;
            observation.sawNonEmpty ||= hasValue || hasCaption;
            observation.sawTarget ||= targetMatch;
            observation.sawTargetWhilePending ||= targetMatch && lastState?.pending === true;
            const fingerprint = [
                lastState?.found === true ? 1 : 0,
                lastState?.pending === true ? 1 : 0,
                hasValue ? 1 : 0,
                hasCaption ? 1 : 0,
                targetMatch ? 1 : 0
            ].join(':');
            if (fingerprint !== lastFingerprint && observation.transitions.length < 30) {
                observation.transitions.push({
                    elapsedMs: Date.now() - startedAt,
                    found: lastState?.found === true,
                    pending: lastState?.pending === true,
                    hasValue,
                    hasCaption,
                    targetMatch
                });
                lastFingerprint = fingerprint;
            }
            if (isTargetCabinetState(lastState, expectedCabinet)) {
                return { complete: true, reason: 'verified', state: lastState, observation };
            }

            if (!lastState?.found) {
                missingSince = missingSince || Date.now();
                if (Date.now() - missingSince >= 1500) {
                    return {
                        complete: false,
                        reason: 'schedule_row_disappeared',
                        state: lastState,
                        observation
                    };
                }
            } else {
                missingSince = 0;
            }

            await sleep(200);
        }

        return {
            complete: false,
            reason: lastState?.found && lastState.pending !== true
                ? observation.sawTarget && !String(lastState?.value || '').trim()
                    ? 'cabinet_cleared_after_recalculation'
                    : observation.sawPending && !observation.sawNonEmpty
                        ? 'cabinet_not_applied_after_recalculation'
                        : 'cabinet_value_mismatch'
                : 'cabinet_verification_timeout',
            state: lastState,
            observation
        };
    };

    const closeCabinetWindowAfterApplied = async (cabinetWindow) => {
        if (!isModalWindowOpen(cabinetWindow)) {
            debugLog('cabinet_close:already_closed_after_apply');
            return true;
        }

        console.log('Окно "Кабинеты": значение применилось, закрываю справочник без повторного подтверждения.');
        debugLog('cabinet_close:after_applied_start', { window: describeElement(cabinetWindow) });

        if (await clickCancelInWindow(cabinetWindow)) {
            if (await waitForWindowToClose(cabinetWindow, 4000)) {
                debugLog('cabinet_close:closed_by_cancel');
                return true;
            }
        }

        dispatchEscape(document.activeElement);
        await sleep(700);

        if (await waitForWindowToClose(cabinetWindow, 3000)) {
            debugLog('cabinet_close:closed_by_escape');
            return true;
        }

        console.warn('Окно "Кабинеты" не закрылось после применения значения. Останавливаю дальнейшую обработку.');
        debugLog('cabinet_close:failed_after_applied', { window: describeElement(cabinetWindow) });
        return false;
    };

    const cancelCabinetWindowAfterFailure = async (cabinetWindow, reason) => {
        if (!isModalWindowOpen(cabinetWindow)) {
            return { attempted: false, closed: true, method: 'already_closed' };
        }

        debugLog('cabinet_close:failure_cancel_start', {
            reason,
            window: describeElement(cabinetWindow)
        });
        if (await clickCancelInWindow(cabinetWindow)
            && await waitForWindowToClose(cabinetWindow, 4000)) {
            debugLog('cabinet_close:failure_cancelled', { reason });
            return { attempted: true, closed: true, method: 'cancel' };
        }

        dispatchEscape(document.activeElement);
        const closed = await waitForWindowToClose(cabinetWindow, 2000);
        debugLog('cabinet_close:failure_escape_result', { reason, closed });
        return { attempted: true, closed, method: 'escape' };
    };

    const confirmCabinetSelection = async (cabinetWindow, cabinetRow) => {
        if (!isModalWindowOpen(cabinetWindow)) {
            return true;
        }

        if (await clickOkInWindow(cabinetWindow)) {
            if (await waitForWindowToClose(cabinetWindow, 5000)) {
                return true;
            }
        }

        if (cabinetRow?.isConnected) {
            cabinetRow.focus?.();
            dispatchEnter(cabinetRow);
            await sleep(600);

            if (await waitForWindowToClose(cabinetWindow, 3000)) {
                return true;
            }
        }

        dispatchEnter(document.activeElement);
        await sleep(600);

        if (await waitForWindowToClose(cabinetWindow, 3000)) {
            return true;
        }

        console.warn('Окно "Кабинеты" не закрылось автоматически. Выбор уже сделан, но окно осталось открытым.');
        return false;
    };

    const isAdapterActionIssued = (result) => result === true
        || result?.opened === true
        || result?.selected === true
        || result?.confirmed === true
        || result?.requested === true
        || result?.requestIssued === true
        || result?.ok === true;

    const openCabinetPickerForRow = async (scheduleForm, rowKey, scheduleWindow, previousWindows) => {
        const adapterOpener = typeof barsAdapter?.openScheduleCabinetPicker === 'function'
            ? barsAdapter.openScheduleCabinetPicker.bind(barsAdapter)
            : (typeof barsAdapter?.requestScheduleCablab === 'function'
                ? barsAdapter.requestScheduleCablab.bind(barsAdapter)
                : null);

        if (adapterOpener) {
            try {
                const openResult = await Promise.resolve(adapterOpener(scheduleForm, rowKey));
                debugLog('cabinet_choose:adapter_open_result', { rowKey, openResult });
                if (isAdapterActionIssued(openResult)) {
                    const cabinetWindow = openResult?.cabinetWindow
                        || await waitForCabinetWindow(scheduleWindow, previousWindows, 8000);
                    if (cabinetWindow) {
                        return { cabinetWindow, method: 'bars_adapter' };
                    }
                }
            } catch (error) {
                debugLog('cabinet_choose:adapter_open_error', {
                    rowKey,
                    errorName: error?.name || 'Error'
                });
            }
        }

        const activationModes = [
            { useDoubleClick: false, useNativeClick: false },
            { useDoubleClick: true, useNativeClick: false },
            { useDoubleClick: false, useNativeClick: true }
        ];

        for (const mode of activationModes) {
            const currentForm = findScheduleForm();
            const guide = currentForm ? findDomScheduleGuideByKey(currentForm, rowKey) : null;
            if (!guide?.button?.isConnected) {
                return { cabinetWindow: null, method: 'dom', reason: 'stable_guide_missing' };
            }

            await activateElementAtCenter(guide.button, mode.useDoubleClick, mode.useNativeClick);
            const cabinetWindow = await waitForCabinetWindow(scheduleWindow, previousWindows, 6000);
            if (cabinetWindow) {
                return { cabinetWindow, method: 'dom' };
            }
        }

        return { cabinetWindow: null, method: adapterOpener ? 'bars_adapter_dom_fallback' : 'dom', reason: 'picker_not_opened' };
    };

    const requestCabinetSelection = async (cabinetWindow, rowKey) => {
        const adapterConfirmer = typeof barsAdapter?.waitForCabinetPickerSelection === 'function'
            ? barsAdapter.waitForCabinetPickerSelection.bind(barsAdapter)
            : (typeof barsAdapter?.confirmCabinetPickerSelection === 'function'
                ? barsAdapter.confirmCabinetPickerSelection.bind(barsAdapter)
            : (typeof barsAdapter?.selectCablabPickerRow === 'function'
                ? barsAdapter.selectCablabPickerRow.bind(barsAdapter)
                : null));

        if (adapterConfirmer) {
            try {
                const confirmResult = await Promise.resolve(adapterConfirmer(
                    cabinetWindow,
                    targetCabinetName,
                    { timeoutMs: 5000, intervalMs: 200 }
                ));
                debugLog('cabinet_select:adapter_confirm_result', { rowKey, confirmResult });
                const adapterConfirmed = confirmResult === true
                    || confirmResult?.confirmed === true
                    || confirmResult?.requested === true
                    || confirmResult?.requestIssued === true
                    || confirmResult?.ok === true;
                if (adapterConfirmed) {
                    return { requested: true, method: 'bars_adapter', result: confirmResult };
                }
                if (confirmResult?.terminal === true) {
                    return {
                        requested: false,
                        method: 'bars_adapter',
                        reason: confirmResult.reason || 'cabinet_selection_not_requested',
                        result: confirmResult
                    };
                }
            } catch (error) {
                debugLog('cabinet_select:adapter_confirm_error', {
                    rowKey,
                    errorName: error?.name || 'Error'
                });
                return {
                    requested: false,
                    method: 'bars_adapter',
                    reason: 'adapter_confirm_error'
                };
            }
        }

        let cabinetRow = await waitForCondition(() => findCabinetRow(cabinetWindow), 3000, 250);
        if (!cabinetRow) {
            cabinetRow = await filterCabinetWindow(cabinetWindow);
        }
        if (!cabinetRow) {
            return { requested: false, method: 'dom', reason: 'cabinet_row_not_found' };
        }

        cabinetRow.scrollIntoView({ block: 'center', inline: 'nearest' });
        debugLog('cabinet_select:dom_row_click', { rowKey, row: describeElement(cabinetRow) });
        clickElement(cabinetRow, true);
        await sleep(700);
        if (isModalWindowOpen(cabinetWindow)) {
            await confirmCabinetSelection(cabinetWindow, cabinetRow);
        }

        // Закрытие справочника здесь означает только то, что запрос выбора отправлен.
        // Фактическое значение строки проверяется отдельно по стабильному RN.
        return { requested: true, method: 'dom' };
    };

    const chooseCabinetsInSchedule = async () => {
        const scheduleReady = await waitForScheduleReady();
        if (!scheduleReady?.scheduleForm) {
            return {
                selected: 0,
                total: 0,
                stopped: true,
                failed: true,
                reason: 'schedule_not_ready'
            };
        }

        // Снимок RN делается ровно один раз: последующие перерисовки GridServices
        // не могут сдвинуть обработку на соседнюю экранную строку.
        const scheduleRows = listStableScheduleRows(scheduleReady.scheduleForm);
        const total = scheduleRows.length;
        let selected = 0;
        let stopped = total === 0;
        let failed = total === 0;
        let reason = total === 0 ? 'stable_schedule_rows_not_found' : '';
        let failedRowKey = '';
        let failedState = null;
        let failedObservation = null;

        console.log(`Подбор времени: найдено стабильных строк расписания: ${total}`);
        debugLog('cabinet_choose:start', {
            total,
            rowKeys: scheduleRows.map((row) => row.key),
            snapshot: getScheduleDebugSnapshot()
        });

        for (const [position, scheduleRow] of scheduleRows.entries()) {
            const rowKey = scheduleRow.key;
            const currentForm = findScheduleForm();
            const currentState = currentForm ? readScheduleCabinetState(currentForm, rowKey) : null;
            if (!currentForm || !currentState?.found) {
                stopped = true;
                failed = true;
                reason = currentForm ? 'schedule_row_disappeared' : 'schedule_form_disappeared';
                failedRowKey = rowKey;
                failedState = currentState;
                break;
            }

            if (isTargetCabinetState(currentState)) {
                selected++;
                debugLog('cabinet_choose:already_verified', { rowKey, selected, total, state: currentState });
                continue;
            }

            console.log(`Подбор времени: выбираю кабинет для строки ${position + 1}/${total} (RN ${rowKey}).`);
            const scheduleWindow = findScheduleWindow();
            if (!scheduleWindow) {
                stopped = true;
                failed = true;
                reason = 'schedule_window_disappeared';
                failedRowKey = rowKey;
                break;
            }

            const previousWindows = new Set(getVisibleWindows());
            const pickerResult = await openCabinetPickerForRow(currentForm, rowKey, scheduleWindow, previousWindows);
            if (!pickerResult.cabinetWindow) {
                stopped = true;
                failed = true;
                reason = pickerResult.reason || 'picker_not_opened';
                failedRowKey = rowKey;
                debugLog('cabinet_choose:window_not_opened', {
                    rowKey,
                    method: pickerResult.method,
                    reason,
                    snapshot: getScheduleDebugSnapshot()
                });
                break;
            }

            const selectionRequest = await requestCabinetSelection(pickerResult.cabinetWindow, rowKey);
            if (!selectionRequest.requested) {
                stopped = true;
                failed = true;
                reason = selectionRequest.reason || 'cabinet_selection_not_requested';
                failedRowKey = rowKey;
                const cleanup = await cancelCabinetWindowAfterFailure(pickerResult.cabinetWindow, reason);
                debugLog('cabinet_choose:selection_failed', {
                    rowKey,
                    reason,
                    method: selectionRequest.method,
                    cleanup
                });
                break;
            }

            const verification = await waitForTargetCabinetState(
                rowKey,
                15000,
                selectionRequest.result
            );
            if (!verification.complete) {
                stopped = true;
                failed = true;
                reason = verification.reason;
                failedRowKey = rowKey;
                failedState = verification.state;
                failedObservation = verification.observation;
                debugLog('cabinet_choose:verification_failed', {
                    rowKey,
                    reason,
                    state: failedState,
                    observation: failedObservation,
                    modalStillOpen: isModalWindowOpen(pickerResult.cabinetWindow),
                    snapshot: getScheduleDebugSnapshot()
                });
                await cancelCabinetWindowAfterFailure(pickerResult.cabinetWindow, reason);
                break;
            }

            selected++;
            debugLog('cabinet_choose:verified', {
                rowKey,
                selected,
                total,
                state: verification.state,
                observation: verification.observation
            });

            if (isModalWindowOpen(pickerResult.cabinetWindow)
                && !await closeCabinetWindowAfterApplied(pickerResult.cabinetWindow)) {
                stopped = true;
                failed = true;
                reason = 'picker_remained_open_after_verified_apply';
                failedRowKey = rowKey;
                break;
            }

            await sleep(350);
        }

        const finalForm = findScheduleForm();
        const finalStates = scheduleRows.map((scheduleRow) => (
            finalForm
                ? readScheduleCabinetState(finalForm, scheduleRow.key)
                : { found: false, value: '', caption: '', pending: false, source: 'schedule_form_missing' }
        ));
        const verifiedAtFinish = finalStates.filter((state) => isTargetCabinetState(state)).length;
        if (verifiedAtFinish !== selected) {
            debugLog('cabinet_choose:final_count_reconciled', {
                incrementalSelected: selected,
                verifiedAtFinish,
                total,
                states: finalStates
            });
        }
        selected = verifiedAtFinish;

        const result = {
            selected,
            total,
            stopped,
            failed,
            reason,
            failedRowKey,
            failedState,
            failedObservation
        };
        debugLog('cabinet_choose:done', { ...result, snapshot: getScheduleDebugSnapshot() });
        return result;
    };

    const getScheduleDebugSnapshot = () => {
        const scheduleForm = findScheduleForm();
        const guideButtons = scheduleForm ? getScheduleCabinetGuideButtons(scheduleForm) : [];

        return {
            hasScheduleForm: !!scheduleForm,
            scheduleForm: describeElement(scheduleForm),
            guideCount: guideButtons.length,
            guides: guideButtons.map((guide, index) => ({
                index,
                button: describeElement(guide.button),
                row: describeElement(guide.row)
            })),
            windows: getVisibleWindows().map((windowElement, index) => {
                const label = getElementLabel(windowElement);
                return {
                    index,
                    window: describeElement(windowElement),
                    containsScheduleForm: !!windowElement.querySelector('.form-schedule'),
                    looksLikeCabinetWindow: isCabinetPickerWindow(windowElement)
                };
            })
        };
    };

    const waitForScheduleReady = async () => {
        const startedAt = Date.now();
        let lastKey = '';
        let stableSince = Date.now();
        let lastReady = null;

        debugLog('schedule_ready:wait_start');

        while (Date.now() - startedAt < 25000) {
            const scheduleForm = findScheduleForm();
            if (!scheduleForm) {
                await sleep(250);
                continue;
            }

            const guideCount = getScheduleCabinetGuideButtons(scheduleForm).length;
            const rowCount = listStableScheduleRows(scheduleForm).length;
            const key = `${rowCount}:${guideCount}`;

            // В исходниках БАРС признак CITO находится в GridResearch/GridDirline,
            // а не в форме расписания. Поэтому отсутствие checkbox «Срочно» здесь
            // не должно удерживать готовое расписание в 25-секундном ожидании.
            if (rowCount > 0) {
                lastReady = { scheduleForm, rowCount, guideCount };

                if (key !== lastKey) {
                    lastKey = key;
                    stableSince = Date.now();
                    debugLog('schedule_ready:counts_changed', { rowCount, guideCount });
                }

                if (Date.now() - stableSince >= 1200) {
                    debugLog('schedule_ready:ready', { rowCount, guideCount, snapshot: getScheduleDebugSnapshot() });
                    return lastReady;
                }
            } else {
                lastKey = key;
                stableSince = Date.now();
            }

            await sleep(250);
        }

        debugLog('schedule_ready:timeout', {
            lastReady: lastReady ? {
                rowCount: lastReady.rowCount,
                guideCount: lastReady.guideCount
            } : null,
            snapshot: getScheduleDebugSnapshot()
        });
        return lastReady;
    };

    const prepareScheduleForAssignment = async ({
        scheduleAlreadyOpen = false,
        urgentResult = getSkippedUrgentResult()
    } = {}) => {
        let scheduleOpened;
        if (scheduleAlreadyOpen) {
            scheduleOpened = !!await waitForCondition(findScheduleForm, 5000);
            debugLog('schedule_resume:form_observed', {
                scheduleOpened,
                snapshot: getScheduleDebugSnapshot()
            });
        } else {
            await sleep(600);
            scheduleOpened = await clickAssignButton();
        }
        if (!scheduleOpened) {
            return {
                stage: ASSIGNMENT_STAGE_SCHEDULE,
                message: 'подбор времени не открыт',
                opened: false,
                complete: false,
                cabinets: { selected: 0, total: 0, stopped: true, failed: true, reason: 'schedule_not_opened' },
                urgent: urgentResult
            };
        }

        const scheduleReady = await waitForScheduleReady();
        if (!scheduleReady) {
            console.warn('Окно подбора времени открылось, но строки таблицы не загрузились.');
            return {
                stage: ASSIGNMENT_STAGE_SCHEDULE,
                message: 'подбор времени открыт, но строки не найдены',
                opened: true,
                complete: false,
                cabinets: { selected: 0, total: 0, stopped: true, failed: true, reason: 'schedule_rows_not_ready' },
                urgent: urgentResult
            };
        }

        console.log(`Подбор времени готов: строк ${scheduleReady.rowCount}, кнопок кабинета ${scheduleReady.guideCount}.`);
        await sleep(300);

        const cabinetsResult = await chooseCabinetsInSchedule();
        await sleep(500);
        if (cabinetsResult.stopped) {
            const urgentMessage = urgentResult.skipped
                ? 'CITO: не запрошено'
                : `CITO: ${urgentResult.selected}/${urgentResult.total}`;
            const resultMessage = `кабинеты: ${cabinetsResult.selected}/${cabinetsResult.total}, ${urgentMessage}`;
            debugLog('schedule:stopped_after_cabinets', { resultMessage, snapshot: getScheduleDebugSnapshot() });
            console.warn(`Подбор времени остановлен (${resultMessage}). Кнопка "Записать" не нажималась.`);
            return {
                stage: ASSIGNMENT_STAGE_SCHEDULE,
                message: `подбор времени остановлен (${resultMessage})`,
                opened: true,
                complete: false,
                cabinets: cabinetsResult,
                urgent: urgentResult
            };
        }

        const urgentComplete = urgentResult.complete === true;
        const cabinetsComplete = cabinetsResult.total > 0
            && cabinetsResult.selected === cabinetsResult.total
            && cabinetsResult.stopped !== true
            && cabinetsResult.failed !== true;
        const complete = cabinetsComplete && urgentComplete;
        const resultMessage = [
            `кабинеты: ${cabinetsResult.selected}/${cabinetsResult.total}`,
            urgentResult.skipped ? 'CITO: не запрошено' : `CITO: ${urgentResult.selected}/${urgentResult.total}`
        ].join(', ');
        const message = complete
            ? `подбор времени подготовлен (${resultMessage})`
            : `подбор времени подготовлен частично (${resultMessage})`;

        console.log(`${message}. Кнопка "Записать" не нажималась.`);
        return {
            stage: ASSIGNMENT_STAGE_SCHEDULE,
            message,
            opened: true,
            complete,
            cabinets: cabinetsResult,
            urgent: urgentResult
        };
    };

    if (resumeScheduleOnly) {
        const resumedFilledCount = Math.max(0, Number(assignmentSettings?.resumeFilledCount) || 0);
        const resumedUrgentTotal = getRequestedSelectedItemValues().length;
        const resumedUrgentResult = shouldMarkUrgent
            ? {
                selected: resumedUrgentTotal,
                total: resumedUrgentTotal,
                rowsSelected: resumedUrgentTotal,
                rowsTotal: resumedUrgentTotal,
                stopped: resumedUrgentTotal === 0,
                skipped: false,
                complete: resumedUrgentTotal > 0,
                resumed: true,
                reason: resumedUrgentTotal > 0
                    ? 'cito_applied_before_schedule_resume'
                    : 'cito_resume_count_missing',
                failedItemValues: []
            }
            : getSkippedUrgentResult();
        debugLog('schedule_resume:start', {
            resumedFilledCount,
            resumedUrgentResult,
            scheduleFormPresent: !!findScheduleForm()
        });
        const scheduleResult = await prepareScheduleForAssignment({
            scheduleAlreadyOpen: true,
            urgentResult: resumedUrgentResult
        });
        const message = `Продолжение подбора времени: ${scheduleResult.message}`;
        debugLog('schedule_resume:complete', {
            resumedFilledCount,
            scheduleResult
        });
        return attachDiagnostics({
            message,
            filledCount: resumedFilledCount,
            totalFound: 0,
            pagesProcessed: 0,
            missingCount: 0,
            missingItemValues: [],
            pagination: {
                method: 'schedule_resume',
                usedBarsRangeControl: true
            },
            assignmentStage: ASSIGNMENT_STAGE_SCHEDULE,
            scheduleResult,
            resumedSchedule: true
        });
    }

    const orderReadyResult = await ensureResearchOrderFormReady();
    debugLog('research_order:ready_result', orderReadyResult);

    if (!orderReadyResult.ready) {
        if (orderReadyResult.reason === 'no_patient_context') {
            debugLog('fill:skipped', { reason: orderReadyResult.reason });
            return attachDiagnostics({
                skipped: true,
                message: 'Нет контекста пациента БАРС в этом фрейме',
                filledCount: 0,
                totalFound: 0
            });
        }

        debugLog('fill:research_order_not_ready', orderReadyResult);
        return attachDiagnostics({
            message: `Форма заказа исследований не готова (${orderReadyResult.reason})`,
            filledCount: 0,
            totalFound: 0
        });
    }

    // Проверяем количество чек-боксов на первой странице.
    let allCheckboxes = getCheckboxes();
    let totalFound = 0;
    console.log(`Найдено чек-боксов на текущей странице: ${allCheckboxes.length}`);

    if (orderReadyResult.pageSizeResult?.changed) {
        console.log(`Количество записей автоматически переключено на ${TARGET_PAGE_SIZE}. Текущих чек-боксов: ${orderReadyResult.pageSizeResult.count}`);
        allCheckboxes = getCheckboxes();
    } else if (orderReadyResult.pageSizeResult?.reason === 'not_found') {
        console.warn('Не удалось автоматически найти переключатель количества записей. Продолжаю с постраничным обходом.');
    }

    const remainingItemValues = new Set(Object.keys(formData).filter((itemValue) => formData[itemValue] === true || formData[itemValue] === false));
    const processedPages = new Set();
    const confirmedItemValues = new Set();

    while (true) {
        allCheckboxes = getCheckboxes();
        indexResearchCheckboxes(allCheckboxes);
        totalFound += allCheckboxes.length;

        const pageInfo = getCurrentResearchPageInfo();
        const currentValues = allCheckboxes.map(getCheckboxItemValue).join(';');
        const pageKey = `${pageInfo.current}/${pageInfo.total}:${currentValues}`;

        if (processedPages.has(pageKey)) {
            debugLog('research_pages:repeat_stop', { pageInfo, currentValues });
            break;
        }
        processedPages.add(pageKey);

        const targetItemValues = allCheckboxes
            .map(getCheckboxItemValue)
            .filter((itemValue) => itemValue && remainingItemValues.has(itemValue));

        debugLog('research_pages:process', {
            pageInfo,
            visibleCount: allCheckboxes.length,
            targetCount: targetItemValues.length,
            remainingCount: remainingItemValues.size,
            targetItemValues,
            visibleItemValues: allCheckboxes.map(getCheckboxItemValue)
        });

        // Проставляем чек-боксы последовательно, чтобы БАРС успевал обновить нижний список выбранных исследований.
        for (const itemValue of targetItemValues) {
            const shouldBeChecked = formData[itemValue];

            if (shouldBeChecked === true) {
                const isSelected = await resyncSelectedCheckboxThroughBars(itemValue);
                if (!isSelected) {
                    debugLog('research_checkbox:select_failed', { itemValue });
                    console.warn(`Не удалось отметить анализ: ${itemValue}`);
                    continue;
                }
                if (!confirmedItemValues.has(itemValue)) {
                    filledCount++;
                }
                confirmedItemValues.add(itemValue);
                remainingItemValues.delete(itemValue);
                const selectedOrder = getSelectedOrderItemValues();
                debugLog('research_checkbox:selected', {
                    itemValue,
                    filledCount,
                    remainingCount: remainingItemValues.size,
                    selectedOrder: {
                        count: selectedOrder.values.size,
                        sourceCount: selectedOrder.sourceCount,
                        hasItem: selectedOrder.values.has(itemValue)
                    }
                });
                console.log(`✓ Отмечен анализ: ${itemValue}`);
            } else if (shouldBeChecked === false) {
                const isCleared = await setCheckboxStateThroughBars(itemValue, false);
                if (!isCleared) {
                    debugLog('research_checkbox:clear_failed', { itemValue });
                    console.warn(`Не удалось снять анализ: ${itemValue}`);
                    continue;
                }
                if (!confirmedItemValues.has(itemValue)) {
                    filledCount++;
                }
                confirmedItemValues.add(itemValue);
                remainingItemValues.delete(itemValue);
                const selectedOrder = getSelectedOrderItemValues();
                debugLog('research_checkbox:cleared', {
                    itemValue,
                    filledCount,
                    remainingCount: remainingItemValues.size,
                    selectedOrder: {
                        count: selectedOrder.values.size,
                        sourceCount: selectedOrder.sourceCount,
                        hasItem: selectedOrder.values.has(itemValue)
                    }
                });
                console.log(`✗ Снят анализ: ${itemValue}`);
            }
        }

        const selectedOrderAfterPage = getSelectedOrderItemValues();
        if (selectedOrderAfterPage.available && selectedOrderAfterPage.authoritative) {
            const missingSelectedOnPage = targetItemValues
                .filter((itemValue) => formData[itemValue] === true)
                .filter((itemValue) => !selectedOrderAfterPage.values.has(itemValue));

            if (missingSelectedOnPage.length > 0) {
                debugLog('research_checkbox:order_audit_missing', {
                    pageInfo,
                    missingSelectedOnPage,
                    selectedOrderCount: selectedOrderAfterPage.values.size,
                    selectedOrderItemValues: Array.from(selectedOrderAfterPage.values)
                });

                for (const itemValue of missingSelectedOnPage) {
                    const isSelected = await resyncSelectedCheckboxThroughBars(itemValue);
                    if (!isSelected) {
                        remainingItemValues.add(itemValue);
                        debugLog('research_checkbox:order_audit_retry_failed', { itemValue });
                        continue;
                    }

                    if (!confirmedItemValues.has(itemValue)) {
                        filledCount++;
                    }
                    confirmedItemValues.add(itemValue);
                    remainingItemValues.delete(itemValue);
                    debugLog('research_checkbox:order_audit_retry_selected', {
                        itemValue,
                        selectedOrderCount: getSelectedOrderItemValues().values.size
                    });
                }
            }
        }

        if (remainingItemValues.size === 0) {
            break;
        }

        const pageInfoAfterSelection = getCurrentResearchPageInfo();
        if (!barsAdapter.hasNextPage(pageInfoAfterSelection)) {
            break;
        }

        if (!await clickNextResearchPage()) {
            console.warn('Не удалось перейти на следующую страницу исследований.');
            break;
        }
    }

    const urgentResult = shouldMarkUrgent
        ? await applyUrgentToSelectedResearches()
        : getSkippedUrgentResult();

    let scheduleResult = null;
    if (shouldMarkUrgent && urgentResult.complete !== true) {
        const reason = urgentResult.reason || 'cito_selection_incomplete';
        const urgentMessage = `CITO установлено для ${urgentResult.selected}/${urgentResult.total} исследований`;
        scheduleResult = {
            stage: normalizedAssignmentStage,
            message: `${urgentMessage}; выполнение остановлено до кнопки «Назначить»`,
            opened: false,
            complete: false,
            blocked: true,
            reason,
            cabinets: {
                selected: 0,
                total: 0,
                stopped: true,
                skipped: true,
                reason: 'urgent_incomplete'
            },
            urgent: urgentResult
        };
        debugLog('fill:blocked_before_assign_for_urgent', {
            reason,
            urgentResult,
            remainingItemValues: Array.from(remainingItemValues)
        });
        console.warn(`${urgentMessage}. Кнопка "Назначить" не нажималась.`);
    } else if (normalizedAssignmentStage === ASSIGNMENT_STAGE_ANALYSES) {
        const urgentMessage = urgentResult.skipped
            ? ''
            : `; CITO: ${urgentResult.selected}/${urgentResult.total}`;
        scheduleResult = {
            stage: ASSIGNMENT_STAGE_ANALYSES,
            message: `остановлено после выбора анализов${urgentMessage}`,
            opened: false,
            complete: true,
            skipped: true,
            cabinets: { selected: 0, total: 0, stopped: false, skipped: true },
            urgent: urgentResult
        };
        debugLog('schedule:skipped_by_setting', {
            assignmentStage: normalizedAssignmentStage,
            urgentResult
        });
        console.log('Настройка сценария: остановка после выбора анализов. Кнопку "Назначить" не нажимаю.');
    } else if (filledCount > 0) {
        scheduleResult = await prepareScheduleForAssignment({ urgentResult });
    } else {
        scheduleResult = {
            stage: ASSIGNMENT_STAGE_SCHEDULE,
            message: 'подбор времени не запускался: анализы не обработаны',
            opened: false,
            complete: false,
            skipped: true,
            cabinets: { selected: 0, total: 0, stopped: true, skipped: true, reason: 'no_researches_processed' },
            urgent: urgentResult
        };
        console.warn('Анализы не были обработаны, кнопку "Назначить" не нажимаю.');
    }

    const scheduleMessage = scheduleResult?.message || '';
    const message = `Профиль "${profileName}": обработано ${filledCount} анализов (просмотрено страниц: ${processedPages.size})${scheduleMessage ? `. ${scheduleMessage}` : ''}`;
    const pagination = {
        method: orderReadyResult.pageSizeResult?.reason || 'not_used',
        usedBarsRangeControl: ['bars_range', 'bars_range_editor', 'd3_range'].includes(orderReadyResult.pageSizeResult?.reason)
            && orderReadyResult.pageSizeResult?.changed === true
    };
    console.log(
        pagination.usedBarsRangeControl
            ? `[FillBARS] Пагинация: штатный Range БАРС (${orderReadyResult.pageSizeResult.count} записей).`
            : `[FillBARS] Пагинация: fallback ${pagination.method} (${orderReadyResult.pageSizeResult?.count ?? totalFound} записей).`
    );
    debugLog('fill:complete', {
        message,
        filledCount,
        totalFound,
        pagesProcessed: processedPages.size,
        missingCount: remainingItemValues.size,
        missingItemValues: Array.from(remainingItemValues),
        pagination,
        assignmentStage: normalizedAssignmentStage,
        scheduleResult,
        finalScope: describeResearchScope(),
        finalOrderGridSnapshots: describeOrderGridSnapshots()
    });
    console.log(message);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Показываем уведомление о результате
    const notification = document.createElement('div');
    const isFullList = remainingItemValues.size === 0 && scheduleResult?.complete === true;
    notification.textContent = isFullList
        ? `✅ ${message}`
        : `⚠️ ${message}${remainingItemValues.size > 0 ? `\nНе найдено в списке: ${remainingItemValues.size}` : ''}`;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${isFullList ? '#4CAF50' : '#ff9800'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-family: 'Segoe UI', sans-serif;
        z-index: 9999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        animation: fadeOut 5s ease-in-out forwards;
        max-width: 350px;
    `;

    const style = document.createElement('style');
    style.textContent = `@keyframes fadeOut {0%{opacity:1}70%{opacity:1}100%{opacity:0;visibility:hidden}}`;
    document.head.appendChild(style);
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 5000);

    return attachDiagnostics({
        message,
        filledCount,
        totalFound,
        pagesProcessed: processedPages.size,
        missingCount: remainingItemValues.size,
        missingItemValues: Array.from(remainingItemValues),
        pagination,
        assignmentStage: normalizedAssignmentStage,
        scheduleResult
    });
    } catch (error) {
        const errorName = typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error';
        addEarlyDiagnostic('fill:unhandled_error', { errorName });
        console.error('[FillBARS] Необработанная ошибка сценария', error);
        return attachDiagnostics({
            message: 'Заполнение остановлено из-за внутренней ошибки FillBARS',
            filledCount,
            totalFound: 0,
            fatalError: true
        });
    }
}

    globalScope.__FillBARS_RUNNER__ = Object.freeze({
        version: VERSION,
        run: fillForm
    });
})(globalThis);
