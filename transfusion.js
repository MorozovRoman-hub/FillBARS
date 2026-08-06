(function initializeTransfusionProtocol(globalScope) {
    'use strict';

    const OBSERVATION_DEFAULTS = {
        beforeBp: '110/70',
        beforePulse: '76',
        beforeTemperature: '36,6',
        beforeDiuresis: 'Свжел',
        afterOneHourBp: '110/70',
        afterOneHourPulse: '76',
        afterOneHourTemperature: '36,6',
        afterOneHourDiuresis: 'Свжел',
        afterTwoHoursBp: '110/70',
        afterTwoHoursPulse: '76',
        afterTwoHoursTemperature: '36,6',
        afterTwoHoursDiuresis: 'Свжел'
    };
    const EXPORT_SECTIONS = [
        ['Данные пациента и трансфузии', [
            ['Фамилия, имя, отчество реципиента', 'patientFullName'],
            ['Дата рождения', 'patientBirthDate'],
            ['№ истории болезни', 'patientHistoryNumber'],
            ['Отделение', 'department'],
            ['Дата заявки', 'requestDate'],
            ['Время заявки', 'requestTime'],
            ['Дата трансфузии', 'transfusionDate'],
            ['Начало', 'startTime'],
            ['Окончание', 'endTime']
        ]],
        ['Данные медицинского обследования реципиента', [
            ['Группа крови реципиента AB0', 'recipientAbo'],
            ['Резус-принадлежность', 'recipientRh'],
            ['Антигены C, c, E, e, K', 'recipientAntigens'],
            ['Аллоиммунные антитела', 'recipientAntibodies']
        ]],
        ['Показания к трансфузии', [['Основное показание', 'indication']]],
        ['Анамнез реципиента', [
            ['Трансфузии компонентов крови в анамнезе', 'previousTransfusions'],
            ['Реакции и осложнения в анамнезе', 'previousReactions'],
            ['Трансфузии по индивидуальному подбору', 'previousIndividualSelection']
        ]],
        ['Данные о донорской крови или её компоненте', [
            ['Наименование компонента', 'componentName'],
            ['Уточнение компонента/среды', 'componentDetails'],
            ['Организация, осуществившая заготовку', 'donorOrganization'],
            ['Группа крови донора AB0', 'donorAbo'],
            ['Резус донора', 'donorRh'],
            ['Антигены эритроцитов донора', 'donorAntigens'],
            ['№ единицы компонента крови', 'componentUnitNumber'],
            ['Количество, мл', 'componentVolume'],
            ['Дата заготовки', 'collectionDate'],
            ['Срок годности', 'expirationDate'],
            ['Дополнительные сведения', 'componentNotes']
        ]],
        ['Результаты индивидуального подбора', [
            ['Медицинская организация', 'selectionOrganization'],
            ['Дата исследования', 'selectionDate'],
            ['Ответственное лицо', 'selectionResponsible'],
            ['Заключение', 'selectionConclusion']
        ]],
        ['Пробы на индивидуальную совместимость', [
            ['Наименование реагента', 'reagentName'],
            ['Серия реагента', 'reagentSeries'],
            ['Срок годности реагента', 'reagentExpiration'],
            ['На плоскости', 'planeTest'],
            ['Биологическая проба', 'biologicalTest']
        ]],
        ['Реакции и осложнения', [
            ['Основные симптомы', 'reactionSymptoms'],
            ['Степень тяжести', 'reactionSeverity']
        ]],
        ['Наблюдение за состоянием реципиента', [
            ['Перед переливанием — АД', 'beforeBp'],
            ['Перед переливанием — пульс', 'beforePulse'],
            ['Перед переливанием — температура', 'beforeTemperature'],
            ['Перед переливанием — диурез/цвет мочи', 'beforeDiuresis'],
            ['Через 1 час — АД', 'afterOneHourBp'],
            ['Через 1 час — пульс', 'afterOneHourPulse'],
            ['Через 1 час — температура', 'afterOneHourTemperature'],
            ['Через 1 час — диурез/цвет мочи', 'afterOneHourDiuresis'],
            ['Через 2 часа — АД', 'afterTwoHoursBp'],
            ['Через 2 часа — пульс', 'afterTwoHoursPulse'],
            ['Через 2 часа — температура', 'afterTwoHoursTemperature'],
            ['Через 2 часа — диурез/цвет мочи', 'afterTwoHoursDiuresis']
        ]],
        ['Ответственный врач', [['Врач, осуществивший трансфузию', 'transfusionDoctor']]]
    ];

    function getPayloadKey() {
        return new URLSearchParams(globalScope.location.search).get('payload') || '';
    }

    function readPayload() {
        const key = getPayloadKey();
        if (!key) {
            return null;
        }

        try {
            const rawPayload = globalScope.localStorage.getItem(key);
            globalScope.localStorage.removeItem(key);
            return rawPayload ? JSON.parse(rawPayload) : null;
        } catch (error) {
            console.error('Не удалось открыть протокол трансфузии', error);
            return null;
        }
    }

    function normalizeDateForInput(value) {
        const rawValue = String(value || '').trim();
        if (!rawValue) {
            return '';
        }

        const isoMatch = rawValue.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
        if (isoMatch) {
            return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        }

        const ruMatch = rawValue.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
        return ruMatch
            ? `${ruMatch[3]}-${ruMatch[2].padStart(2, '0')}-${ruMatch[1].padStart(2, '0')}`
            : '';
    }

    function setValue(id, value) {
        const control = globalScope.document.getElementById(id);
        if (control) {
            control.value = String(value || '');
        }
    }

    function defaultProtocolDate(payload) {
        return normalizeDateForInput(payload?.generatedAt) || new Date().toISOString().slice(0, 10);
    }

    function syncPrintSelectValue(selectId, outputId) {
        const select = globalScope.document.getElementById(selectId);
        const output = globalScope.document.getElementById(outputId);
        if (select && output) {
            output.textContent = select.value || '';
        }
    }

    function applyObservationDefaults() {
        for (const [id, value] of Object.entries(OBSERVATION_DEFAULTS)) {
            setValue(id, value);
        }
    }

    function syncRecipientBloodGroup() {
        const recipientAbo = globalScope.document.getElementById('recipientAbo');
        const recipientRh = globalScope.document.getElementById('recipientRh');
        const donorAbo = globalScope.document.getElementById('donorAbo');
        const donorRh = globalScope.document.getElementById('donorRh');

        if (recipientAbo && donorAbo) {
            donorAbo.value = Array.from(donorAbo.options || []).some((option) => option.value === recipientAbo.value)
                ? recipientAbo.value
                : '';
        }
        if (recipientRh && donorRh) {
            donorRh.value = Array.from(donorRh.options || []).some((option) => option.value === recipientRh.value)
                ? recipientRh.value
                : '';
        }
    }

    function dateToPrint(value) {
        const normalized = normalizeDateForInput(value);
        if (!normalized) {
            return '';
        }
        const [year, month, day] = normalized.split('-');
        return `${day}.${month}.${year}`;
    }

    function getControlExportValue(id) {
        const control = globalScope.document.getElementById(id);
        if (!control) {
            return '';
        }
        if (control.type === 'date') {
            return dateToPrint(control.value);
        }
        return String(control.value || control.textContent || '').trim();
    }

    function buildExportRows() {
        return EXPORT_SECTIONS.map(([section, fields]) => ({
            section,
            fields: fields.map(([label, id]) => ({
                label,
                id,
                value: getControlExportValue(id)
            }))
        }));
    }

    function buildExportValues() {
        return Object.fromEntries(buildExportRows()
            .flatMap((section) => section.fields)
            .map((field) => [field.id, field.value]));
    }

    function buildProtocolFileBaseName() {
        const identity = getControlExportValue('patientHistoryNumber')
            || getControlExportValue('patientFullName')
            || dateToPrint(getControlExportValue('transfusionDate'))
            || 'без_номера';
        const safeIdentity = identity
            .replace(/[<>:"/\\|?*]+/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 80);
        return `Протокол_трансфузии_${safeIdentity || 'без_номера'}`;
    }

    function exportToWord() {
        globalScope.__FillBARSOfficeExport__.downloadDocx(
            buildExportValues(),
            `${buildProtocolFileBaseName()}.docx`
        );
    }

    function exportToExcel() {
        globalScope.__FillBARSOfficeExport__.downloadXlsx(
            buildExportValues(),
            `${buildProtocolFileBaseName()}.xlsx`
        );
    }

    function preparePrintControls() {
        for (const control of globalScope.document.querySelectorAll('input[type="date"], input[type="time"]')) {
            control.dataset.originalInputType = control.type;
            control.dataset.originalInputValue = control.value;
            const printValue = control.type === 'date' ? dateToPrint(control.value) : control.value;
            control.type = 'text';
            control.value = printValue;
        }
    }

    function restorePrintControls() {
        for (const control of globalScope.document.querySelectorAll('input[data-original-input-type]')) {
            const originalType = control.dataset.originalInputType;
            const originalValue = control.dataset.originalInputValue;
            control.type = originalType;
            control.value = originalValue;
            delete control.dataset.originalInputType;
            delete control.dataset.originalInputValue;
        }
    }

    function render(payload) {
        const patient = payload?.patient || {};
        const protocolDate = defaultProtocolDate(payload);

        setValue('patientFullName', patient.fullName);
        setValue('patientBirthDate', normalizeDateForInput(patient.birthDate));
        setValue('patientHistoryNumber', patient.historyNumber);
        setValue('department', patient.department);
        setValue('selectionOrganization', patient.medicalOrganization);
        setValue('transfusionDoctor', patient.doctorName);
        setValue('requestDate', protocolDate);
        setValue('transfusionDate', protocolDate);
        applyObservationDefaults();
        syncRecipientBloodGroup();
        syncPrintSelectValue('indication', 'indicationPrintValue');

        globalScope.document.getElementById('payloadWarning')?.classList.toggle('hidden', !!payload);
    }

    function clearEnteredData(payload) {
        for (const control of globalScope.document.querySelectorAll('[data-user-field]')) {
            control.value = '';
        }
        render(payload);
    }

    const api = {
        normalizeDateForInput,
        render,
        clearEnteredData,
        applyObservationDefaults,
        syncRecipientBloodGroup,
        buildExportRows,
        buildExportValues,
        buildProtocolFileBaseName,
        exportToWord,
        exportToExcel,
        preparePrintControls,
        restorePrintControls
    };
    globalScope.__FillBARSTransfusionProtocol__ = api;

    globalScope.document.addEventListener('DOMContentLoaded', () => {
        const payload = readPayload();
        render(payload);

        globalScope.document.getElementById('printButton')?.addEventListener('click', () => globalScope.print());
        globalScope.document.getElementById('exportWordButton')?.addEventListener('click', exportToWord);
        globalScope.document.getElementById('exportExcelButton')?.addEventListener('click', exportToExcel);
        globalScope.document.getElementById('indication')?.addEventListener('change', () => {
            syncPrintSelectValue('indication', 'indicationPrintValue');
        });
        globalScope.document.getElementById('recipientAbo')?.addEventListener('change', syncRecipientBloodGroup);
        globalScope.document.getElementById('recipientRh')?.addEventListener('change', syncRecipientBloodGroup);
        globalScope.document.getElementById('clearButton')?.addEventListener('click', () => {
            if (globalScope.confirm('Очистить все введённые данные, кроме данных пациента и текущей даты?')) {
                clearEnteredData(payload);
            }
        });
        globalScope.document.getElementById('closeButton')?.addEventListener('click', () => globalScope.close());
        globalScope.addEventListener('beforeprint', preparePrintControls);
        globalScope.addEventListener('afterprint', restorePrintControls);
    });
})(globalThis);
