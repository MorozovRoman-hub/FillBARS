(function runDFormRuntimeFixture() {
    'use strict';

    const host = document.getElementById('fixture-host');
    const status = document.getElementById('status');
    const results = document.getElementById('results');
    const checks = [];
    const pageStack = [];
    const metrics = {
        exactStackAdds: 0,
        foreignStackAdds: 0,
        globalRepeaterCalls: 0,
        researchNamespaceCalls: 0,
        researchDataSetCalls: [],
        researchRepeaterCalls: [],
        researchOnChangeCalls: 0,
        d3RuntimeExecCalls: 0,
        d3RuntimeLegacyNamespaceCalls: 0,
        d3RuntimeLegacyEngineCalls: 0,
        d3RuntimeDataSetCalls: [],
        d3RuntimeRepeaterCalls: [],
        d3RuntimeGetValueCalls: 0,
        d3RuntimeOnChangeCalls: 0,
        scheduleNamespaceCalls: 0,
        scheduleDataSetCalls: [],
        scheduleRepeaterCalls: [],
        scheduleSelectCalls: 0,
        pickerNamespaceCalls: 0,
        pickerDataSetCalls: [],
        pickerRepeaterCalls: [],
        pickerOnOkCalls: 0,
        foreignDataSetCalls: 0,
        foreignRepeaterCalls: 0,
        foreignNamespaceCalls: 0,
        foreignHandlerCalls: 0
    };

    const assert = (condition, message, details = null) => {
        if (!condition) {
            const suffix = details === null ? '' : `\n${JSON.stringify(details, null, 2)}`;
            throw new Error(`${message}${suffix}`);
        }
        checks.push(message);
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

    const createEngine = ({ namespace, dataSets = {}, repeaters = {}, metricPrefix }) => ({
        getNamespace() {
            metrics[`${metricPrefix}NamespaceCalls`]++;
            return namespace;
        },
        getDataSet(name) {
            metrics[`${metricPrefix}DataSetCalls`].push(name);
            return dataSets[name] || { data: [] };
        },
        getRepeater(name) {
            metrics[`${metricPrefix}RepeaterCalls`].push(name);
            return repeaters[name] || null;
        },
        getRepeaterByName(name) {
            metrics[`${metricPrefix}RepeaterCalls`].push(name);
            return repeaters[name] || null;
        }
    });

    const exactPages = new Set();
    const makePage = (engine) => {
        const page = {
            form: engine,
            getNamespace() {
                return engine.getNamespace();
            }
        };
        exactPages.add(page);
        return page;
    };

    const foreignNamespace = {
        isFirstTime: true,
        ResearchGrid: {
            onChangeGroups() {
                metrics.foreignHandlerCalls++;
            }
        },
        selectCablab() {
            metrics.foreignHandlerCalls++;
        },
        OnOkButtonClick() {
            metrics.foreignHandlerCalls++;
        }
    };
    const foreignEngine = {
        getNamespace() {
            metrics.foreignNamespaceCalls++;
            return foreignNamespace;
        },
        getDataSet() {
            metrics.foreignDataSetCalls++;
            return { data: [] };
        },
        getRepeater() {
            metrics.foreignRepeaterCalls++;
            return null;
        },
        getRepeaterByName() {
            metrics.foreignRepeaterCalls++;
            return null;
        }
    };
    foreignEngine.containerForm = createElement('div', { cmptype: 'Form', class: 'foreign-form' });
    const foreignPage = {
        form: foreignEngine,
        d3Form: { DOM: foreignEngine.containerForm },
        getNamespace: () => foreignEngine.getNamespace()
    };

    // Real BARS can return a generic/current page from getPageByDom. The owner
    // attached to the nearest DForm root is the authoritative page.
    window.getPageByDom = () => foreignPage;
    window.addStackPage = (page) => {
        pageStack.push(page);
        if (exactPages.has(page)) {
            metrics.exactStackAdds++;
        } else {
            metrics.foreignStackAdds++;
        }
    };
    window.removeStackPage = () => pageStack.pop();
    window.getRepeater = () => {
        metrics.globalRepeaterCalls++;
        return null;
    };

    // ---------------------------------------------------------------------
    // Research order: page.form is the DForm engine; handlers live in its
    // namespace, while datasets/repeaters remain engine services.
    // ---------------------------------------------------------------------
    const orderWindow = createElement('section', { class: 'window WinContent showed' });
    const orderForm = createElement('div', {
        cmptype: 'Form',
        class: 'd3form dirline_order_alt'
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
    const researchCheckbox = createElement('input', {
        type: 'checkbox',
        name: 'GridResearch_SelectList_Item',
        item_value: 'RS-ENGINE-1'
    });
    researchGrid.append(researchCheckbox);
    const dirlineGrid = createElement('div', { name: 'GridDirline' });
    const selectedClone = createElement('div', { 'data-fixture': 'engine-repeater-clone' });
    selectedClone.clone = { data: { RS_ID: 'RS-ENGINE-1' } };
    dirlineGrid.append(selectedClone);
    orderForm.append(groups, researchGrid, dirlineGrid);
    orderWindow.append(orderForm);
    host.append(orderWindow);

    const researchNamespace = {
        isFirstTime: false,
        ResearchGrid: {
            onChangeGroups() {
                assert(pageStack.at(-1) === researchPage,
                    'ResearchGrid.onChangeGroups выполняется в exact owner page');
                metrics.researchOnChangeCalls++;
            }
        }
    };
    const researchRepeater = { clones: () => [selectedClone] };
    const researchEngine = createEngine({
        namespace: researchNamespace,
        dataSets: {
            DsProfiles: { data: [{ ID: 'PROFILE-ENGINE' }] },
            DsResearch: { data: [{ RS_ID: 'RS-ENGINE-1' }] }
        },
        repeaters: { GridDirline_repeater: researchRepeater },
        metricPrefix: 'research'
    });
    // Some BARS builds expose getRepeaterByName but return nothing there while
    // the compatible getRepeater path is populated. The adapter must continue.
    researchEngine.getRepeaterByName = (name) => {
        metrics.researchRepeaterCalls.push(`byName:${name}`);
        return null;
    };
    const researchPage = makePage(researchEngine);
    researchEngine.containerForm = orderForm;
    researchPage.d3Form = { DOM: orderForm };
    orderForm.jsParent = { page: researchPage };

    // ---------------------------------------------------------------------
    // Real openD3Form shape: page.form is only a legacy compatibility shell,
    // while datasets, repeaters and the internal Form namespace belong to the
    // capable page.d3Form. No control backlink is provided; ownership must be
    // resolved through the BARS page registries and d3Form.DOM.
    // ---------------------------------------------------------------------
    const d3RuntimeWindow = createElement('section', { class: 'window WinContent showed' });
    const d3RuntimeForm = createElement('div', {
        cmptype: 'Form',
        class: 'd3form dirline_order_alt'
    });
    const d3RuntimeGroups = createElement('table', { name: 'GridGroups' });
    const d3RuntimeGroupsBody = document.createElement('tbody');
    const d3RuntimeProfilesRow = createElement('tr', { cmptype: 'GridRow', keyvalue: 'PROFILES' });
    d3RuntimeProfilesRow.append(createElement('td', {}, 'Профили D3 runtime'));
    const d3RuntimeAllRow = createElement('tr', { cmptype: 'GridRow', keyvalue: 'ALL_RES' });
    d3RuntimeAllRow.append(createElement('td', {}, 'Все исследования D3 runtime'));
    d3RuntimeGroupsBody.append(d3RuntimeProfilesRow, d3RuntimeAllRow);
    d3RuntimeGroups.append(d3RuntimeGroupsBody);

    const d3RuntimeResearchGrid = createElement('div', { name: 'GridResearch' });
    const d3RuntimeCheckbox = createElement('input', {
        type: 'checkbox',
        name: 'GridResearch_SelectList_Item',
        item_value: 'RS-D3-RUNTIME-1'
    });
    d3RuntimeResearchGrid.append(d3RuntimeCheckbox);
    const d3RuntimeDirline = createElement('div', { name: 'GridDirline' });
    const d3RuntimeSelectedClone = createElement('div', { 'data-fixture': 'd3-runtime-clone' });
    d3RuntimeSelectedClone.clone = { data: { RS_ID: 'RS-D3-RUNTIME-1' } };
    d3RuntimeDirline.append(d3RuntimeSelectedClone);
    d3RuntimeForm.append(d3RuntimeGroups, d3RuntimeResearchGrid, d3RuntimeDirline);
    d3RuntimeWindow.append(d3RuntimeForm);
    host.append(d3RuntimeWindow);

    let d3RuntimeActiveGroup = 'PROFILES';
    const d3RuntimeNamespace = {
        isFirstTime: false,
        ResearchGrid: {
            onChangeGroups() {
                assert(pageStack.at(-1) === d3RuntimePage,
                    'D3 runtime handler выполняется в exact page.d3Form owner');
                metrics.d3RuntimeOnChangeCalls++;
            }
        }
    };
    const d3RuntimeRepeater = { clones: () => [d3RuntimeSelectedClone] };
    const d3RuntimeEngine = {
        DOM: d3RuntimeForm,
        destroyed: false,
        execScript(source, args) {
            metrics.d3RuntimeExecCalls++;
            assert(source === 'return Form' && Array.isArray(args),
                'D3 namespace получен через execScript в form closure');
            return d3RuntimeNamespace;
        },
        getDataSet(name) {
            metrics.d3RuntimeDataSetCalls.push(name);
            return name === 'DsProfiles'
                ? { data: [{ ID: 'PROFILE-D3-RUNTIME' }] }
                : name === 'DsResearch'
                    ? { data: [{ RS_ID: 'RS-D3-RUNTIME-1' }] }
                    : { data: [] };
        },
        getRepeater(name) {
            metrics.d3RuntimeRepeaterCalls.push(name);
            return name === 'GridDirline_repeater' ? d3RuntimeRepeater : null;
        },
        getValue(name) {
            assert(name === 'GridGroups', 'D3 runtime читает active group через getValue(GridGroups)');
            metrics.d3RuntimeGetValueCalls++;
            return d3RuntimeActiveGroup;
        }
    };
    const d3LegacyShell = {
        getNamespace() {
            metrics.d3RuntimeLegacyNamespaceCalls++;
            return {};
        },
        getDataSet() {
            metrics.d3RuntimeLegacyEngineCalls++;
            return { data: [] };
        },
        getRepeaterByName() {
            metrics.d3RuntimeLegacyEngineCalls++;
            return null;
        }
    };
    const d3RuntimePage = {
        form: d3LegacyShell,
        d3Form: d3RuntimeEngine,
        getNamespace() {
            return d3LegacyShell.getNamespace();
        }
    };
    exactPages.add(d3RuntimePage);
    window.SYS_pages_window = [d3RuntimePage];
    window.SYS_pages = [];
    window.SYS_lastPage = d3RuntimePage;

    window.D3Api = {
        GridCtrl: {
            activateRow(row, forceOnChange) {
                const isLegacyEngineScenario = row === allRow;
                const isRealD3Scenario = row === d3RuntimeAllRow;
                const expectedPage = isLegacyEngineScenario
                    ? researchPage
                    : isRealD3Scenario
                        ? d3RuntimePage
                        : null;
                assert(expectedPage && pageStack.at(-1) === expectedPage,
                    'D3 activateRow выполняется в exact owner page');
                assert(forceOnChange === true,
                    'D3 activateRow получает force-onchange для активной строки');
                if (isLegacyEngineScenario) {
                    groups.setAttribute('activ_keyvalue', 'ALL_RES');
                    profilesRow.classList.remove('active');
                    allRow.classList.add('active');
                    researchNamespace.ResearchGrid.onChangeGroups();
                } else {
                    d3RuntimeActiveGroup = 'ALL_RES';
                    d3RuntimeNamespace.ResearchGrid.onChangeGroups();
                }
            },
            setActiveRow(grid, row) {
                const isLegacyEngineScenario = grid === groups && row === allRow;
                const isRealD3Scenario = grid === d3RuntimeGroups && row === d3RuntimeAllRow;
                const expectedPage = isLegacyEngineScenario
                    ? researchPage
                    : isRealD3Scenario
                        ? d3RuntimePage
                        : null;
                assert(expectedPage && pageStack.at(-1) === expectedPage,
                    'D3 setActiveRow выполняется в exact owner page');
                if (isLegacyEngineScenario) {
                    groups.setAttribute('activ_keyvalue', 'ALL_RES');
                    profilesRow.classList.remove('active');
                    allRow.classList.add('active');
                } else {
                    d3RuntimeActiveGroup = 'ALL_RES';
                }
            }
        }
    };

    // ---------------------------------------------------------------------
    // Schedule and cabinet picker use the same engine/namespace split.
    // ---------------------------------------------------------------------
    const scheduleWindow = createElement('section', { class: 'window WinContent showed' });
    const scheduleForm = createElement('div', {
        cmptype: 'Form',
        class: 'd3form form-schedule'
    });
    const scheduleGrid = createElement('table', { name: 'GridServices' });
    const scheduleBody = document.createElement('tbody');
    scheduleGrid.append(scheduleBody);
    scheduleForm.append(scheduleGrid);
    scheduleWindow.append(scheduleForm);
    host.append(scheduleWindow);

    const scheduleClone = createElement('tr', { cmptype: 'GridRow', keyvalue: 'RN-ENGINE-1' });
    scheduleClone.clone = { data: { RN: 'RN-ENGINE-1', SERV_LIST: 'SERV-ENGINE-1' } };
    const cabinetControl = createElement('button', {
        type: 'button',
        name: 'ctrlCABLAB',
        cmptype: 'ButtonEdit'
    }, 'Выбрать кабинет');
    cabinetControl.__scheduleClone = scheduleClone;
    scheduleClone.__ctrlCABLAB = cabinetControl;
    const scheduleCell = document.createElement('td');
    scheduleCell.append(cabinetControl);
    scheduleClone.append(scheduleCell);
    scheduleBody.append(scheduleClone);

    const pickerWindow = createElement('section', { class: 'window WinContent showed' });
    const pickerForm = createElement('div', {
        cmptype: 'Form',
        class: 'd3form cabinet-picker'
    });
    pickerForm.style.display = 'none';
    pickerForm.append(createElement('div', { cmptype: 'title' }, 'Кабинеты'));
    const pickerGrid = createElement('table', { name: 'Grid1' });
    const pickerBody = document.createElement('tbody');
    const cabinetData = { ID: 'CAB-ENGINE-7', NAME: 'Лаборатория engine № 7' };
    const pickerRow = createElement('tr', { cmptype: 'GridRow', keyvalue: cabinetData.ID });
    pickerRow.clone = { data: cabinetData };
    pickerRow.append(createElement('td', {}, cabinetData.NAME));
    pickerBody.append(pickerRow);
    pickerGrid.append(pickerBody);
    pickerForm.append(pickerGrid);
    pickerWindow.append(pickerForm);
    host.append(pickerWindow);

    let closureClone = null;
    const scheduleNamespace = {
        _get_rec_time_lock: false,
        selectCablab(control) {
            assert(pageStack.at(-1) === schedulePage,
                'selectCablab выполняется в exact owner page расписания');
            assert(control === cabinetControl,
                'selectCablab получает ctrlCABLAB exact RN clone');
            metrics.scheduleSelectCalls++;
            pickerForm.style.display = 'block';
        }
    };
    const scheduleRepeater = { clones: () => [scheduleClone] };
    const scheduleEngine = createEngine({
        namespace: scheduleNamespace,
        repeaters: { GridServices_repeater: scheduleRepeater },
        metricPrefix: 'schedule'
    });
    const schedulePage = makePage(scheduleEngine);
    scheduleEngine.containerForm = scheduleForm;
    schedulePage.d3Form = { DOM: scheduleForm };
    scheduleForm.jsParent = { page: schedulePage };

    const pickerNamespace = {
        OnOkButtonClick() {
            assert(pageStack.at(-1) === pickerPage,
                'OnOkButtonClick выполняется в exact owner page справочника');
            assert(pickerGrid.__activeData === cabinetData,
                'OnOkButtonClick получает активную точную строку Grid1');
            metrics.pickerOnOkCalls++;
            pickerForm.style.display = 'none';
        }
    };
    const pickerEngine = createEngine({
        namespace: pickerNamespace,
        dataSets: { DS: { data: [cabinetData] } },
        metricPrefix: 'picker'
    });
    const pickerPage = makePage(pickerEngine);
    pickerEngine.containerForm = pickerForm;
    pickerPage.d3Form = { DOM: pickerForm };
    pickerForm.jsParent = { page: pickerPage };

    window.closureContext = (clone) => {
        assert(pageStack.at(-1) === schedulePage,
            'closureContext вызывается в exact schedule page');
        assert(clone === scheduleClone,
            'closureContext получает clone exact RN');
        closureClone = clone;
    };
    window.unClosureContext = () => {
        closureClone = null;
    };
    window.getControl = (name) => name === 'ctrlCABLAB' && closureClone === scheduleClone
        ? cabinetControl
        : null;
    window.getValue = () => '';
    window.getControlProperty = () => '';
    window.setThisActivRow = (row, forceOnChange) => {
        assert(pageStack.at(-1) === pickerPage,
            'Grid1 активируется в exact picker page');
        assert(row === pickerRow && forceOnChange === true,
            'Grid1 активируется штатным setThisActivRow(row, true)');
        pickerGrid.__activeData = cabinetData;
        pickerRow.classList.add('active');
    };

    try {
        assert(typeof window.FillBARSAdapter?.create === 'function',
            'подключён production bars-adapter');
        const adapter = window.FillBARSAdapter.create({ document, window });

        const orderRuntime = adapter.getOrderRuntimeState(orderForm);
        assert(orderRuntime.available
            && orderRuntime.isFirstTime === false
            && orderRuntime.initialized === true,
        'runtime state читается из DForm namespace, не из engine/foreign page', orderRuntime);
        assert(orderRuntime.profilesRowCount === 1 && orderRuntime.researchRowCount === 1,
            'DsProfiles/DsResearch читаются через exact DForm engine', orderRuntime);

        const selectedState = adapter.getSelectedResearchState(orderForm);
        assert(selectedState.values.has('RS-ENGINE-1')
            && selectedState.sourceKind.includes('repeater_clone_rs_id'),
        'GridDirline repeater читается через exact DForm engine', {
            values: Array.from(selectedState.values),
            sourceKind: selectedState.sourceKind
        });

        const allRequest = adapter.requestAllResearches(orderForm);
        assert(allRequest.requested
            && allRequest.method === 'd3_activate_row_force'
            && metrics.researchOnChangeCalls === 1,
        'ALL_RES вызывает один force-onchange через exact page', allRequest);

        const d3RuntimeState = adapter.getOrderRuntimeState(d3RuntimeForm);
        assert(d3RuntimeState.available
            && d3RuntimeState.runtimeKind === 'd3'
            && d3RuntimeState.isFirstTime === false
            && d3RuntimeState.initialized === true
            && d3RuntimeState.hasResearchOnChange === true,
        'реальный D3 runtime читается из page.d3Form и внутреннего Form', d3RuntimeState);
        assert(d3RuntimeState.activeGroup === 'PROFILES'
            && d3RuntimeState.profilesRowCount === 1
            && d3RuntimeState.researchRowCount === 1,
        'D3 active group и datasets читаются через page.d3Form', d3RuntimeState);

        const d3SelectedState = adapter.getSelectedResearchState(d3RuntimeForm);
        assert(d3SelectedState.values.has('RS-D3-RUNTIME-1')
            && d3SelectedState.sourceKind.includes('repeater_clone_rs_id'),
        'D3 GridDirline repeater читается из page.d3Form', {
            values: Array.from(d3SelectedState.values),
            sourceKind: d3SelectedState.sourceKind
        });

        const d3RuntimeRequest = adapter.requestAllResearches(d3RuntimeForm);
        assert(d3RuntimeRequest.requested
            && d3RuntimeRequest.method === 'd3_activate_row_force'
            && metrics.d3RuntimeOnChangeCalls === 1
            && adapter.isAllResearchesActive(d3RuntimeAllRow),
        'D3 ALL_RES использует один force-onchange и engine.getValue', d3RuntimeRequest);
        assert(metrics.d3RuntimeExecCalls > 0
            && metrics.d3RuntimeGetValueCalls > 0
            && metrics.d3RuntimeLegacyNamespaceCalls === 0
            && metrics.d3RuntimeLegacyEngineCalls === 0,
        'пустой legacy page.form не используется для D3 runtime', metrics);

        const rows = adapter.listScheduleRows(scheduleForm);
        assert(rows.length === 1
            && rows[0].rn === 'RN-ENGINE-1'
            && rows[0].servList === 'SERV-ENGINE-1'
            && rows[0].ctrlCABLAB === cabinetControl,
        'GridServices repeater и ctrlCABLAB разрешаются через exact DForm engine', rows);

        const opened = adapter.openScheduleCabinetPicker(scheduleForm, 'RN-ENGINE-1');
        assert(opened.requested
            && opened.method === 'form_select_cablab'
            && metrics.scheduleSelectCalls === 1,
        'кабинет открывается через namespace.selectCablab', opened);
        assert(adapter.findCabinetPickerForm() === pickerForm,
            'после открытия найден exact picker form');

        const pickerRows = adapter.listCablabPickerRows(pickerForm);
        assert(pickerRows.length === 1
            && pickerRows[0].id === cabinetData.ID
            && pickerRows[0].name === cabinetData.NAME,
        'DS справочника читается через exact picker DForm engine', pickerRows);

        const confirmed = adapter.confirmCabinetPickerSelection(pickerWindow, cabinetData.NAME);
        assert(confirmed.selected
            && confirmed.confirmed
            && metrics.pickerOnOkCalls === 1,
        'выбор подтверждается через namespace.OnOkButtonClick', confirmed);

        assert(metrics.foreignStackAdds === 0
            && metrics.foreignDataSetCalls === 0
            && metrics.foreignRepeaterCalls === 0
            && metrics.foreignNamespaceCalls === 0
            && metrics.foreignHandlerCalls === 0,
        'ложный getPageByDom fallback ни разу не использован', metrics);
        assert(metrics.researchNamespaceCalls > 0
            && metrics.scheduleNamespaceCalls > 0
            && metrics.pickerNamespaceCalls > 0,
        'namespace каждой exact DForm получен через engine/page proxy', metrics);
        assert(metrics.globalRepeaterCalls === 0,
            'global getRepeater не нужен при наличии exact DForm engine', metrics);
        assert(pageStack.length === 0,
            'addStackPage/removeStackPage сбалансированы');

        const report = {
            status: 'passed',
            assertions: checks.length,
            adapterVersion: window.FillBARSAdapter.version,
            metrics
        };
        document.body.dataset.testStatus = 'passed';
        status.textContent = `PASS — ${checks.length} DForm-проверок`;
        status.style.color = '#137333';
        results.textContent = JSON.stringify(report, null, 2);
        window.__dformRuntimeFixtureResult = report;
    } catch (error) {
        const report = {
            status: 'failed',
            assertions: checks.length,
            error: error?.stack || String(error),
            metrics
        };
        document.body.dataset.testStatus = 'failed';
        status.textContent = `FAIL — ${error.message}`;
        status.style.color = '#b3261e';
        results.textContent = JSON.stringify(report, null, 2);
        window.__dformRuntimeFixtureResult = report;
        console.error(error);
    }
})();
