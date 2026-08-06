(async function runScheduleFixture() {
    'use strict';

    const host = document.getElementById('fixture-host');
    const status = document.getElementById('status');
    const results = document.getElementById('results');
    const checks = [];
    const TARGET_CABINET = Object.freeze({ id: 'CAB-7', name: 'Лаборатория № 7' });
    const states = new Map(Array.from({ length: 4 }, (_, index) => [String(index + 1), {
        value: '',
        caption: ''
    }]));
    const metrics = {
        openedRns: [],
        openedControls: [],
        activatedPickerIds: [],
        onOkCalls: []
    };

    const assert = (condition, message) => {
        if (!condition) {
            throw new Error(message);
        }
        checks.push(message);
    };

    const waitFor = async (predicate, timeout = 1500, interval = 20) => {
        const startedAt = performance.now();
        while (performance.now() - startedAt < timeout) {
            const value = predicate();
            if (value) {
                return value;
            }
            await new Promise((resolve) => setTimeout(resolve, interval));
        }
        return null;
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

    const windowRoot = createElement('section', { class: 'window WinContent showed' });
    const scheduleForm = createElement('div', { cmptype: 'Form', class: 'd3form form-schedule' });
    const scheduleGrid = createElement('table', { name: 'GridServices' });
    const scheduleBody = document.createElement('tbody');
    scheduleGrid.append(scheduleBody);
    scheduleForm.append(scheduleGrid);
    windowRoot.append(scheduleForm);
    host.append(windowRoot);

    const pickerWindow = createElement('section', { class: 'window WinContent showed' });
    const pickerForm = createElement('div', {
        cmptype: 'Form',
        class: 'd3form cabinet-picker'
    });
    pickerForm.style.display = 'none';
    pickerForm.append(createElement('div', { cmptype: 'title' }, 'Кабинеты'));
    const pickerGrid = createElement('table', { name: 'Grid1' });
    const pickerBody = document.createElement('tbody');
    pickerGrid.append(pickerBody);
    pickerForm.append(pickerGrid);
    pickerWindow.append(pickerForm);
    host.append(pickerWindow);

    const pickerData = [
        { ID: 'CAB-70', NAME: 'Лаборатория № 7 (резерв)' },
        { ID: TARGET_CABINET.id, NAME: TARGET_CABINET.name },
        { ID: 'CAB-8', NAME: 'Лаборатория № 8' }
    ];
    const pickerRows = pickerData.map((data) => {
        const row = createElement('tr', { cmptype: 'GridRow', keyvalue: data.ID });
        row.clone = { data };
        row.append(createElement('td', {}, data.NAME));
        return row;
    });
    const renderPickerRows = () => pickerBody.replaceChildren(...pickerRows);
    renderPickerRows();

    let repeaterClones = [];
    let currentClosure = null;
    let activeScheduleRn = '';
    let pickerDataReady = true;
    let delayNextPickerLoad = false;
    let partialNextPickerLoad = false;
    let pickerModalResult = 'cancel';
    let rejectRn4Apply = true;
    const pageStack = [];
    const schedulePage = { form: null };
    const pickerPage = { form: null };

    const makeScheduleClone = (rn, generation) => {
        const clone = createElement('tr', {
            cmptype: 'GridRow',
            'data-rn': rn,
            'data-generation': generation
        });
        clone.clone = {
            data: {
                RN: rn,
                SERV_LIST: `SERV-${rn};SERV-COMMON`
            }
        };
        const control = createElement('button', {
            type: 'button',
            name: 'ctrlCABLAB',
            cmptype: 'ButtonEdit'
        }, `Выбрать кабинет для RN ${rn}`);
        control.__scheduleClone = clone;
        clone.__ctrlCABLAB = control;
        clone.append(createElement('td', {}, `RN ${rn}`));
        const cabinetCell = document.createElement('td');
        cabinetCell.append(control);
        clone.append(cabinetCell);
        return clone;
    };

    const installCloneGeneration = (generation, domOrder, repeaterOrder) => {
        const oldClones = repeaterClones.slice();
        const byRn = new Map(Array.from({ length: 4 }, (_, index) => {
            const rn = String(index + 1);
            return [rn, makeScheduleClone(rn, generation)];
        }));
        scheduleBody.replaceChildren(...domOrder.map((rn) => byRn.get(rn)));
        repeaterClones = repeaterOrder.map((rn) => byRn.get(rn));
        return { oldClones, byRn };
    };

    const firstGeneration = installCloneGeneration(
        'first',
        ['4', '2', '3', '1'],
        ['3', '1', '4', '2']
    );

    const applyCabinet = (rn, data) => {
        const state = states.get(rn);
        state.value = data.ID;
        state.caption = data.NAME;
    };

    const scheduleRuntimeForm = {
        _get_rec_time_lock: false,
        selectCablab(ctrl) {
            assert(pageStack.at(-1) === schedulePage,
                'Form.selectCablab вызван в точном page stack расписания');
            const clone = ctrl?.__scheduleClone || null;
            const rn = String(clone?.clone?.data?.RN || '');
            if (!rn) {
                throw new Error('selectCablab получил control без schedule clone');
            }
            activeScheduleRn = rn;
            metrics.openedRns.push(rn);
            metrics.openedControls.push(ctrl);
            pickerModalResult = 'cancel';
            pickerGrid.__activeData = null;
            for (const row of pickerGrid.querySelectorAll('[cmptype="GridRow"]')) {
                row.classList.remove('active');
            }
            if (delayNextPickerLoad) {
                delayNextPickerLoad = false;
                pickerDataReady = false;
                pickerBody.replaceChildren();
                setTimeout(() => {
                    pickerDataReady = true;
                    renderPickerRows();
                }, 280);
            } else if (partialNextPickerLoad) {
                partialNextPickerLoad = false;
                pickerDataReady = true;
                pickerBody.replaceChildren(pickerRows[0]);
                setTimeout(renderPickerRows, 280);
            } else {
                pickerDataReady = true;
                renderPickerRows();
            }
            pickerForm.style.display = 'block';
            pickerWindow.style.display = 'block';
        }
    };
    const getScheduleRepeater = (name) => name === 'GridServices_repeater'
        ? {
            clones: () => repeaterClones.slice(),
            clonesCount: () => repeaterClones.length
        }
        : null;
    const scheduleEngine = {
        containerForm: scheduleForm,
        getNamespace: () => scheduleRuntimeForm,
        getRepeater: getScheduleRepeater,
        getRepeaterByName: getScheduleRepeater
    };
    schedulePage.form = scheduleEngine;
    schedulePage.d3Form = { DOM: scheduleForm };
    schedulePage.getNamespace = () => scheduleEngine.getNamespace();
    scheduleForm.jsParent = { page: schedulePage };

    const pickerRuntimeForm = {
        OnOkButtonClick() {
            assert(pageStack.at(-1) === pickerPage,
                'Form.OnOkButtonClick вызван в точном page stack справочника');
            const selected = pickerGrid.__activeData;
            if (!selected) {
                throw new Error('OnOkButtonClick вызван без активной строки Grid1');
            }
            const rn = activeScheduleRn;
            metrics.onOkCalls.push({ rn, id: selected.ID, name: selected.NAME });
            pickerModalResult = 'ok';
            pickerForm.style.display = 'none';
            pickerWindow.style.display = 'none';

            if (rn === '2') {
                scheduleRuntimeForm._get_rec_time_lock = true;
                setTimeout(() => {
                    applyCabinet(rn, selected);
                    scheduleRuntimeForm._get_rec_time_lock = false;
                }, 180);
                return;
            }

            scheduleRuntimeForm._get_rec_time_lock = false;
            if (rn !== '4' || !rejectRn4Apply) {
                applyCabinet(rn, selected);
            }
        }
    };
    const pickerEngine = {
        containerForm: pickerForm,
        getNamespace: () => pickerRuntimeForm,
        getDataSet: (name) => name === 'DS' && pickerDataReady ? { data: pickerData } : { data: [] }
    };
    pickerPage.form = pickerEngine;
    pickerPage.d3Form = { DOM: pickerForm };
    pickerPage.getNamespace = () => pickerEngine.getNamespace();
    pickerForm.jsParent = { page: pickerPage };

    window.getPageByDom = (element) => {
        if (element === scheduleForm || scheduleForm.contains(element)) {
            return schedulePage;
        }
        if (element === pickerForm || pickerForm.contains(element)) {
            return pickerPage;
        }
        return null;
    };
    window.addStackPage = (page) => pageStack.push(page);
    window.removeStackPage = () => pageStack.pop();
    window.getRepeater = (name) => {
        if (pageStack.at(-1) !== schedulePage || name !== 'GridServices_repeater') {
            return null;
        }
        return getScheduleRepeater(name);
    };
    window.closureContext = (clone) => {
        if (pageStack.at(-1) !== schedulePage || !repeaterClones.includes(clone)) {
            throw new Error('closureContext получил неактуальный clone или неверную страницу');
        }
        currentClosure = clone;
    };
    window.unClosureContext = () => {
        currentClosure = null;
    };
    window.getControl = (name) => {
        return name === 'ctrlCABLAB' ? currentClosure?.__ctrlCABLAB || null : null;
    };
    window.D3Api = {
        ButtonEditCtrl: {
            getValue(control) {
                const rn = control?.__scheduleClone?.clone?.data?.RN;
                return rn ? states.get(String(rn)).value : '';
            },
            getCaption(control) {
                const rn = control?.__scheduleClone?.clone?.data?.RN;
                return rn ? states.get(String(rn)).caption : '';
            }
        }
    };
    window.getControlValue = (control) => {
        const rn = control?.__scheduleClone?.clone?.data?.RN;
        return rn ? states.get(String(rn)).caption : '';
    };
    window.getControlCaption = (control) => {
        const rn = control?.__scheduleClone?.clone?.data?.RN;
        return rn ? states.get(String(rn)).caption : '';
    };
    // Реальная сборка БАРС может вернуть пустое значение из name-based API
    // даже при уже заполненном точном control текущего clone.
    window.getValue = () => '';
    window.getCaption = () => '';
    window.getControlProperty = () => '';
    window.setThisActivRow = (row, forceOnChange) => {
        if (!pickerGrid.contains(row) || forceOnChange !== true) {
            throw new Error('Grid1 должен активироваться штатным setThisActivRow(row, true)');
        }
        for (const candidate of pickerGrid.querySelectorAll('[cmptype="GridRow"]')) {
            candidate.classList.toggle('active', candidate === row);
        }
        pickerGrid.__activeData = row.clone.data;
        metrics.activatedPickerIds.push(row.clone.data.ID);
    };

    const openAndConfirm = (adapter, rn, expectedControl) => {
        const opened = adapter.openScheduleCabinetPicker(scheduleForm, rn);
        assert(opened.requested && opened.method === 'form_select_cablab',
            `RN ${rn}: справочник открыт через Form.selectCablab`);
        assert(metrics.openedRns.at(-1) === rn && metrics.openedControls.at(-1) === expectedControl,
            `RN ${rn}: Form.selectCablab получил control точного clone`);
        assert(adapter.findCabinetPickerForm() === pickerForm,
            `RN ${rn}: найден точный видимый справочник кабинетов`);

        const confirmed = adapter.confirmCabinetPickerSelection(pickerWindow, TARGET_CABINET.name);
        assert(confirmed.selected && confirmed.confirmed,
            `RN ${rn}: внешнее окно разрешено к form и штатный Form.OnOkButtonClick вызван после активации Grid1`);
        assert(metrics.activatedPickerIds.at(-1) === TARGET_CABINET.id,
            `RN ${rn}: выбрана точная строка, а не строка с похожим названием`);
        assert(metrics.onOkCalls.at(-1)?.rn === rn
            && metrics.onOkCalls.at(-1)?.id === TARGET_CABINET.id,
        `RN ${rn}: OnOkButtonClick подтвердил ожидаемый кабинет`);
        return confirmed;
    };

    try {
        assert(window.FillBARSAdapter?.version === '5.1.14',
            'подключён production bars-adapter версии 5.1.14');
        const adapter = window.FillBARSAdapter.create({ document, window });
        assert(adapter.findScheduleForm() === scheduleForm,
            'найдена видимая .form-schedule с GridServices');

        const initialRows = adapter.listScheduleRows(scheduleForm);
        assert(initialRows.length === 4,
            'GridServices_repeater вернул четыре строки расписания');
        assert(initialRows.map((row) => row.rn).sort().join(',') === '1,2,3,4',
            'RN 1..4 остаются стабильными при несовпадении DOM и repeater order');
        assert(initialRows.every((row) => row.servList === `SERV-${row.rn};SERV-COMMON`),
            'SERV_LIST прочитан из данных каждого clone');
        assert(initialRows.every((row) => row.value === ''),
            'D3Api.ButtonEditCtrl.getValue имеет приоритет над generic API, возвращающим caption вместо ID');

        openAndConfirm(adapter, '3', firstGeneration.byRn.get('3').__ctrlCABLAB);
        const rn3State = adapter.readScheduleCabinetState(scheduleForm, '3');
        assert(rn3State.found && rn3State.value === TARGET_CABINET.id
            && rn3State.caption === TARGET_CABINET.name && !rn3State.pending,
        'RN 3: value/caption прочитаны из closure после немедленного применения');

        const secondGeneration = installCloneGeneration(
            'second',
            ['3', '1', '4', '2'],
            ['2', '4', '1', '3']
        );
        assert(firstGeneration.byRn.get('2').isConnected === false,
            'старые clone полностью удалены из DOM');
        assert(adapter.listScheduleRows(scheduleForm).map((row) => row.rn).join(',') === '2,4,1,3',
            'после полной замены адаптер читает новый repeater order');
        assert(adapter.readScheduleCabinetState(scheduleForm, '3').value === TARGET_CABINET.id,
            'после замены clone состояние RN 3 разрешается через новый control');

        openAndConfirm(adapter, '2', secondGeneration.byRn.get('2').__ctrlCABLAB);
        const rn2Immediately = adapter.readScheduleCabinetState(scheduleForm, '2');
        assert(pickerForm.style.display === 'none' && rn2Immediately.pending,
            'RN 2: справочник закрыт, пока _get_rec_time_lock остаётся активным');
        assert(!rn2Immediately.value && !rn2Immediately.caption,
            'RN 2: одно закрытие справочника ещё не считается применением');
        const rn2Applied = await waitFor(() => {
            const state = adapter.readScheduleCabinetState(scheduleForm, '2');
            return state.value === TARGET_CABINET.id
                && state.caption === TARGET_CABINET.name
                && !state.pending
                ? state
                : null;
        });
        assert(!!rn2Applied,
            'RN 2: успех подтверждён только после value/caption и снятия lock');

        openAndConfirm(adapter, '1', secondGeneration.byRn.get('1').__ctrlCABLAB);
        const rn1State = adapter.readScheduleCabinetState(scheduleForm, '1');
        assert(rn1State.value === TARGET_CABINET.id
            && rn1State.caption === TARGET_CABINET.name && !rn1State.pending,
        'RN 1: кабинет применён к точному clone после reorder');

        openAndConfirm(adapter, '4', secondGeneration.byRn.get('4').__ctrlCABLAB);
        await new Promise((resolve) => setTimeout(resolve, 220));
        const rn4State = adapter.readScheduleCabinetState(scheduleForm, '4');
        assert(!rn4State.value && !rn4State.caption && !rn4State.pending,
            'RN 4: закрытие без применения оставляет кабинет пустым');
        rejectRn4Apply = false;
        openAndConfirm(adapter, '4', secondGeneration.byRn.get('4').__ctrlCABLAB);
        const rn4AppliedState = adapter.readScheduleCabinetState(scheduleForm, '4');
        assert(rn4AppliedState.value === TARGET_CABINET.id
            && rn4AppliedState.caption === TARGET_CABINET.name
            && !rn4AppliedState.pending,
        'RN 4: после штатного применения точный ID подтверждён и последняя строка заполнена');

        states.set('1', { value: '', caption: '' });
        delayNextPickerLoad = true;
        const activationsBeforeDelayedLoad = metrics.activatedPickerIds.length;
        const confirmationsBeforeDelayedLoad = metrics.onOkCalls.length;
        const delayedOpened = adapter.openScheduleCabinetPicker(
            scheduleForm,
            '1'
        );
        assert(delayedOpened.requested && pickerModalResult === 'cancel',
            'отложенный справочник сразу видим, но до штатного подтверждения сохраняет ModalResult=cancel');
        const earlyConfirm = adapter.confirmCabinetPickerSelection(pickerWindow, TARGET_CABINET.name);
        assert(!earlyConfirm.confirmed
            && earlyConfirm.reason === 'picker_rows_not_loaded'
            && earlyConfirm.rowCount === 0
            && earlyConfirm.retryable,
        'видимое окно без DS/Grid1 распознано как повторяемая готовность, а не exact_row_not_found');
        const delayedConfirm = await adapter.waitForCabinetPickerSelection(
            pickerWindow,
            TARGET_CABINET.name,
            { timeoutMs: 1500, intervalMs: 50 }
        );
        assert(delayedConfirm.confirmed
            && delayedConfirm.attempts > 1
            && delayedConfirm.matchMode === 'exact_name',
        'адаптер дождался отложенной загрузки DS/Grid1 и подтвердил точную строку');
        assert(metrics.activatedPickerIds.length === activationsBeforeDelayedLoad + 1
            && metrics.onOkCalls.length === confirmationsBeforeDelayedLoad + 1
            && pickerModalResult === 'ok',
        'после готовности выполнена ровно одна цепочка setThisActivRow(row,true) → Form.OnOkButtonClick');
        const delayedState = adapter.readScheduleCabinetState(scheduleForm, '1');
        assert(delayedState.value === TARGET_CABINET.id && delayedState.caption === TARGET_CABINET.name,
            'отложенный source-backed выбор применился к стабильной строке RN 1');

        states.set('1', { value: '', caption: '' });
        partialNextPickerLoad = true;
        const activationsBeforePartialLoad = metrics.activatedPickerIds.length;
        const confirmationsBeforePartialLoad = metrics.onOkCalls.length;
        adapter.openScheduleCabinetPicker(scheduleForm, '1');
        const partialConfirm = adapter.confirmCabinetPickerSelection(pickerWindow, TARGET_CABINET.name);
        assert(!partialConfirm.confirmed
            && partialConfirm.reason === 'picker_rows_rendering'
            && partialConfirm.rowCount === 1
            && partialConfirm.dataSetRowCount === pickerData.length
            && partialConfirm.retryable,
        'частичный Grid1 не считается окончательным exact_row_not_found до завершения отрисовки DS');
        const completedPartialConfirm = await adapter.waitForCabinetPickerSelection(
            pickerWindow,
            TARGET_CABINET.name,
            { timeoutMs: 1500, intervalMs: 50 }
        );
        assert(completedPartialConfirm.confirmed && completedPartialConfirm.attempts > 1,
            'source-backed ожидание переживает частичную отрисовку и находит точную строку позже');
        assert(metrics.activatedPickerIds.length === activationsBeforePartialLoad + 1
            && metrics.onOkCalls.length === confirmationsBeforePartialLoad + 1,
        'частичная отрисовка также приводит ровно к одному штатному подтверждению');

        delayNextPickerLoad = true;
        const activationsBeforeClosedPicker = metrics.activatedPickerIds.length;
        const confirmationsBeforeClosedPicker = metrics.onOkCalls.length;
        adapter.openScheduleCabinetPicker(scheduleForm, '1');
        const closedPickerWait = adapter.waitForCabinetPickerSelection(
            pickerWindow,
            TARGET_CABINET.name,
            { timeoutMs: 1500, intervalMs: 50 }
        );
        setTimeout(() => {
            pickerForm.style.display = 'none';
            pickerWindow.style.display = 'none';
        }, 100);
        const closedPickerResult = await closedPickerWait;
        assert(!closedPickerResult.confirmed
            && closedPickerResult.terminal
            && closedPickerResult.reason === 'picker_closed',
        'закрытый во время ожидания справочник завершается terminal без позднего OnOkButtonClick');
        assert(metrics.activatedPickerIds.length === activationsBeforeClosedPicker
            && metrics.onOkCalls.length === confirmationsBeforeClosedPicker
            && pickerModalResult === 'cancel',
        'после закрытия справочника строка не активируется и ModalResult остаётся cancel');

        const finalStates = ['1', '2', '3', '4']
            .map((rn) => adapter.readScheduleCabinetState(scheduleForm, rn));
        const selected = finalStates.filter((state) => state.value && state.caption).length;
        const summary = {
            selected,
            total: finalStates.length,
            complete: selected === finalStates.length,
            rows: finalStates.map(({ rn, value, caption, pending }) => ({ rn, value, caption, pending })),
            openedRns: metrics.openedRns.slice(),
            checks: checks.length
        };
        assert(summary.selected === 4 && summary.total === 4 && summary.complete === true,
            'итог расписания: 4/4, complete=true');
        summary.checks = checks.length;

        window.__scheduleFixtureResult = summary;
        document.body.dataset.testStatus = 'passed';
        status.textContent = `PASS — ${checks.length} проверок; кабинеты 4/4; complete=true`;
        results.textContent = JSON.stringify(summary, null, 2);
    } catch (error) {
        document.body.dataset.testStatus = 'failed';
        status.textContent = `FAIL — ${error.message}`;
        results.textContent = error.stack || String(error);
        console.error(error);
    }
})();
