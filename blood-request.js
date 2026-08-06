(function initializeBloodRequest(globalScope) {
    'use strict';

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
            console.error('Не удалось открыть заявку на компоненты крови', error);
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

    function calculateAge(birthDate, referenceDate) {
        const normalizedBirthDate = normalizeDateForInput(birthDate);
        const normalizedReferenceDate = normalizeDateForInput(referenceDate);
        if (!normalizedBirthDate || !normalizedReferenceDate) {
            return '';
        }
        const [birthYear, birthMonth, birthDay] = normalizedBirthDate.split('-').map(Number);
        const [year, month, day] = normalizedReferenceDate.split('-').map(Number);
        let age = year - birthYear;
        if (month < birthMonth || month === birthMonth && day < birthDay) {
            age -= 1;
        }
        return age >= 0 && age < 130 ? String(age) : '';
    }

    function syncPrintSelectValue(selectId, outputId) {
        const select = globalScope.document.getElementById(selectId);
        const output = globalScope.document.getElementById(outputId);
        if (select && output) {
            output.textContent = select.value || '';
        }
    }

    function syncReleasedComponent() {
        const componentName = globalScope.document.getElementById('componentName')?.value || '';
        setValue('releasedComponent1', componentName);
        syncPrintSelectValue('componentName', 'componentPrintValue');
    }

    function syncReleasedBloodGroup() {
        const abo = globalScope.document.getElementById('recipientAbo')?.value || '';
        const rh = globalScope.document.getElementById('recipientRh')?.value || '';
        setValue('releasedBloodGroup1', [abo, rh].filter(Boolean).join(' '));
    }

    function dateToPrint(value) {
        const normalized = normalizeDateForInput(value);
        if (!normalized) {
            return '';
        }
        const [year, month, day] = normalized.split('-');
        return `${day}.${month}.${year}`;
    }

    function preparePrintControls() {
        for (const control of globalScope.document.querySelectorAll('input[type="date"]')) {
            control.dataset.originalInputType = control.type;
            control.dataset.originalInputValue = control.value;
            control.type = 'text';
            control.value = dateToPrint(control.value);
        }
    }

    function restorePrintControls() {
        for (const control of globalScope.document.querySelectorAll('input[data-original-input-type]')) {
            control.type = control.dataset.originalInputType;
            control.value = control.dataset.originalInputValue;
            delete control.dataset.originalInputType;
            delete control.dataset.originalInputValue;
        }
    }

    function defaultRequestDate(payload) {
        return normalizeDateForInput(payload?.generatedAt) || new Date().toISOString().slice(0, 10);
    }

    function render(payload) {
        const patient = payload?.patient || {};
        const requestDate = defaultRequestDate(payload);
        const birthDate = normalizeDateForInput(patient.birthDate);

        setValue('patientFullName', patient.fullName);
        setValue('patientBirthDate', birthDate);
        setValue('patientHistoryNumber', patient.historyNumber);
        setValue('department', patient.department);
        setValue('requestDoctor', patient.doctorName);
        setValue('patientAge', calculateAge(birthDate, requestDate));
        setValue('requestDate', requestDate);
        syncPrintSelectValue('indication', 'indicationPrintValue');
        syncReleasedComponent();
        syncReleasedBloodGroup();
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
        calculateAge,
        render,
        clearEnteredData,
        syncReleasedComponent,
        syncReleasedBloodGroup,
        preparePrintControls,
        restorePrintControls
    };
    globalScope.__FillBARSBloodRequest__ = api;

    globalScope.document.addEventListener('DOMContentLoaded', () => {
        const payload = readPayload();
        render(payload);
        globalScope.document.getElementById('printButton')?.addEventListener('click', () => globalScope.print());
        globalScope.document.getElementById('indication')?.addEventListener('change', () => {
            syncPrintSelectValue('indication', 'indicationPrintValue');
        });
        globalScope.document.getElementById('componentName')?.addEventListener('change', syncReleasedComponent);
        globalScope.document.getElementById('recipientAbo')?.addEventListener('change', syncReleasedBloodGroup);
        globalScope.document.getElementById('recipientRh')?.addEventListener('change', syncReleasedBloodGroup);
        globalScope.document.getElementById('patientBirthDate')?.addEventListener('change', () => {
            setValue('patientAge', calculateAge(
                globalScope.document.getElementById('patientBirthDate')?.value,
                globalScope.document.getElementById('requestDate')?.value
            ));
        });
        globalScope.document.getElementById('requestDate')?.addEventListener('change', () => {
            setValue('patientAge', calculateAge(
                globalScope.document.getElementById('patientBirthDate')?.value,
                globalScope.document.getElementById('requestDate')?.value
            ));
        });
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
