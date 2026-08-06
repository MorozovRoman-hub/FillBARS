document.addEventListener('DOMContentLoaded', () => {
    const assertions = [];
    const assert = (condition, message) => {
        if (!condition) throw new Error(message);
        assertions.push(message);
    };

    try {
        const api = window.__FillBARSBloodRequest__;
        assert(!!api, 'production API заявки опубликован');
        assert(api.calculateAge('07.08.1970', '2026-08-06') === '55', 'возраст вычислен на дату заявки');

        const payload = {
            generatedAt: '2026-08-06T09:30:00.000Z',
            patient: {
                fullName: 'Иванов Иван Иванович',
                birthDate: '07.08.1970',
                historyNumber: '1340014-70784/00765',
                department: 'ХО2 Амурск',
                doctorName: 'Морозов Р.В.'
            }
        };
        api.render(payload);
        assert(document.getElementById('patientFullName').value === payload.patient.fullName, 'ФИО подставлено');
        assert(document.getElementById('patientBirthDate').value === '1970-08-07', 'дата рождения подставлена');
        assert(document.getElementById('patientHistoryNumber').value === payload.patient.historyNumber, 'номер ИБ подставлен');
        assert(document.getElementById('department').value === payload.patient.department, 'отделение подставлено');
        assert(document.getElementById('requestDoctor').value === payload.patient.doctorName,
            'врач подставлен в сокращённом виде');
        assert(document.getElementById('patientAge').value === '55', 'возраст подставлен');
        assert(document.getElementById('requestDate').value === '2026-08-06', 'дата заявки подставлена');

        document.getElementById('componentName').value = 'Свежезамороженная плазма';
        api.syncReleasedComponent();
        assert(document.getElementById('releasedComponent1').value === 'Свежезамороженная плазма', 'среда перенесена на оборотную сторону');

        document.getElementById('recipientAbo').value = 'A(II)';
        document.getElementById('recipientRh').value = 'Rh(-)';
        api.syncReleasedBloodGroup();
        assert(document.getElementById('releasedBloodGroup1').value === 'A(II) Rh(-)', 'AB0 и Rh перенесены на оборотную сторону');

        api.preparePrintControls();
        assert(document.getElementById('requestDate').type === 'text'
            && document.getElementById('requestDate').value === '06.08.2026', 'дата подготовлена к печати');
        api.restorePrintControls();
        assert(document.getElementById('requestDate').type === 'date', 'date-control восстановлен');

        document.getElementById('department').value = 'Другое отделение';
        api.clearEnteredData(payload);
        assert(document.getElementById('department').value === payload.patient.department, 'отделение восстанавливается после очистки');
        assert(document.getElementById('requestDoctor').value === payload.patient.doctorName,
            'врач восстанавливается после очистки');
        assert(document.getElementById('patientFullName').value === payload.patient.fullName, 'данные пациента восстановлены');

        document.body.dataset.testStatus = 'passed';
        document.getElementById('status').textContent = `PASS — ${assertions.length} проверок`;
    } catch (error) {
        document.body.dataset.testStatus = 'failed';
        document.getElementById('status').textContent = `FAIL — ${error.message}`;
        throw error;
    }
});
