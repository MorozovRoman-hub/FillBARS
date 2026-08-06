const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp-transfusion-export');
vm.runInThisContext(fs.readFileSync(path.join(root, 'office-templates.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'office-export.js'), 'utf8'));

const values = {
    patientFullName: 'Иванов Иван Иванович',
    patientBirthDate: '07.08.1970',
    patientHistoryNumber: '1340014-70784/00765',
    department: 'ХО2 Амурск',
    requestDate: '06.08.2026',
    requestTime: '09:30',
    transfusionDate: '06.08.2026',
    startTime: '10:00',
    endTime: '11:30',
    recipientAbo: 'A(II)',
    recipientRh: 'Rh(+)',
    recipientAntigens: 'C, c, E, e, K',
    recipientAntibodies: 'не выявлены',
    indication: 'Восполнение объема циркулирующих эритроцитов',
    previousTransfusions: 'без особенностей',
    previousReactions: 'нет',
    previousIndividualSelection: 'нет',
    componentName: 'Эритроцитарная взвесь',
    componentDetails: 'лейкофильтрованная',
    donorOrganization: 'КГБУЗ «Станция переливания крови»',
    donorAbo: 'A(II)',
    donorRh: 'Rh(+)',
    donorAntigens: 'C, c, E, e, K',
    componentUnitNumber: '27022500351305',
    componentVolume: '283',
    collectionDate: '09.04.2026',
    expirationDate: '21.05.2026',
    componentNotes: 'контрольный образец',
    selectionOrganization: 'КГБУЗ "ГОРОДСКАЯ БОЛЬНИЦА" ИМЕНИ М.И. ШЕВЧУК',
    selectionDate: '06.08.2026',
    selectionResponsible: '',
    selectionConclusion: 'совместимо',
    reagentName: 'желатин',
    reagentSeries: '4',
    reagentExpiration: '21.05.2026',
    planeTest: 'совместимо',
    biologicalTest: 'совместимо',
    reactionSymptoms: 'нет',
    reactionSeverity: 'нет',
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
    afterTwoHoursDiuresis: 'Свжел',
    transfusionDoctor: 'Морозов Р.В.'
};

fs.mkdirSync(outputDir, { recursive: true });
const docx = globalThis.__FillBARSOfficeExport__.createDocx(values);
const xlsx = globalThis.__FillBARSOfficeExport__.createXlsx(values);
fs.writeFileSync(path.join(outputDir, 'qa-protocol.docx'), docx);
fs.writeFileSync(path.join(outputDir, 'qa-protocol.xlsx'), xlsx);
console.log(`DOCX=${docx.length}; XLSX=${xlsx.length}`);
