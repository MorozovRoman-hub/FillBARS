document.addEventListener('DOMContentLoaded', () => {
    const assertions = [];
    const assert = (condition, message) => {
        if (!condition) {
            throw new Error(message);
        }
        assertions.push(message);
    };

    try {
        const api = window.__FillBARSTransfusionProtocol__;
        assert(!!api, 'production API протокола опубликован');
        assert(api.normalizeDateForInput('06.08.2026') === '2026-08-06', 'русская дата нормализуется');

        const payload = {
            generatedAt: '2026-08-06T09:30:00.000Z',
            patient: {
                fullName: 'Иванов Иван Иванович',
                birthDate: '07.08.1970',
                historyNumber: '1340014-70784/00765',
                department: 'ХО2 Амурск',
                medicalOrganization: 'КГБУЗ "ГОРОДСКАЯ БОЛЬНИЦА" ИМЕНИ М.И. ШЕВЧУК',
                doctorName: 'Морозов Р.В.'
            }
        };
        api.render(payload);

        assert(document.getElementById('patientFullName').value === payload.patient.fullName, 'ФИО подставлено');
        assert(document.getElementById('patientBirthDate').value === '1970-08-07', 'дата рождения подставлена');
        assert(document.getElementById('patientHistoryNumber').value === payload.patient.historyNumber, 'номер ИБ подставлен');
        assert(document.getElementById('department').value === payload.patient.department, 'отделение подставлено');
        assert(document.getElementById('selectionOrganization').value === payload.patient.medicalOrganization,
            'медицинская организация подставлена');
        assert(document.getElementById('transfusionDoctor').value === payload.patient.doctorName,
            'врач подставлен в сокращённом виде');
        assert(document.getElementById('requestDate').value === '2026-08-06', 'дата заявки заполнена');
        assert(document.getElementById('transfusionDate').value === '2026-08-06', 'дата трансфузии заполнена');
        assert(document.getElementById('payloadWarning').classList.contains('hidden'), 'предупреждение скрыто при payload');
        assert(document.getElementById('beforeBp').value === '110/70'
            && document.getElementById('afterOneHourPulse').value === '76'
            && document.getElementById('afterTwoHoursTemperature').value === '36,6'
            && document.getElementById('afterTwoHoursDiuresis').value === 'Свжел',
            'таблица наблюдения заполнена значениями из образца');

        document.getElementById('recipientAbo').value = 'A(II)';
        document.getElementById('recipientRh').value = 'Rh(-)';
        api.syncRecipientBloodGroup();
        assert(document.getElementById('donorAbo').value === 'A(II)'
            && document.getElementById('donorRh').value === 'Rh(-)',
            'AB0 и Rh реципиента перенесены в донорскую среду');

        api.preparePrintControls();
        assert(document.getElementById('requestDate').type === 'text'
            && document.getElementById('requestDate').value === '06.08.2026', 'дата переводится в печатный формат');
        api.restorePrintControls();
        assert(document.getElementById('requestDate').type === 'date'
            && document.getElementById('requestDate').value === '2026-08-06', 'экранный date-control восстанавливается');

        const exportRows = api.buildExportRows();
        const exportedValues = exportRows.flatMap((section) => section.fields.map((field) => field.value));
        assert(exportedValues.includes(payload.patient.medicalOrganization)
            && exportedValues.includes(payload.patient.doctorName),
            'Word/Excel получают организацию и врача из заполненной формы');
        const exportValues = api.buildExportValues();
        const officeApi = window.__FillBARSOfficeExport__;
        assert(!!officeApi, 'production API Office-выгрузки опубликован');
        const wordDocument = officeApi.createDocx(exportValues);
        const excelDocument = officeApi.createXlsx(exportValues);
        const wordText = new TextDecoder().decode(wordDocument);
        const excelText = new TextDecoder().decode(excelDocument);
        assert(wordDocument[0] === 0x50 && wordDocument[1] === 0x4B
            && wordText.includes('ПРОТОКОЛ ТРАНСФУЗИИ')
            && wordText.includes('Морозов Р.В.')
            && wordText.includes('ГОРОДСКАЯ БОЛЬНИЦА'),
            'настоящий DOCX содержит исходный бланк и заполненные данные');
        assert(excelDocument[0] === 0x50 && excelDocument[1] === 0x4B
            && excelText.includes('xl/workbook.xml')
            && excelText.includes('Морозов Р.В.')
            && excelText.includes('ГОРОДСКАЯ БОЛЬНИЦА'),
            'настоящий XLSX содержит бланк и заполненные данные');
        assert(!/[<>:"/\\|?*]/.test(api.buildProtocolFileBaseName()),
            'имя выгружаемого файла безопасно для Windows');

        document.getElementById('department').value = 'Другое отделение';
        api.clearEnteredData(payload);
        assert(document.getElementById('department').value === payload.patient.department, 'отделение восстанавливается после очистки');
        assert(document.getElementById('selectionOrganization').value === payload.patient.medicalOrganization,
            'организация восстанавливается после очистки');
        assert(document.getElementById('transfusionDoctor').value === payload.patient.doctorName,
            'врач восстанавливается после очистки');
        assert(document.getElementById('patientFullName').value === payload.patient.fullName, 'данные пациента восстанавливаются после очистки');
        assert(document.getElementById('beforeBp').value === '110/70'
            && document.getElementById('afterTwoHoursDiuresis').value === 'Свжел',
            'значения наблюдения восстанавливаются после очистки');

        document.body.dataset.testStatus = 'passed';
        document.getElementById('status').textContent = `PASS — ${assertions.length} проверок`;
    } catch (error) {
        document.body.dataset.testStatus = 'failed';
        document.getElementById('status').textContent = `FAIL — ${error.message}`;
        throw error;
    }
});
