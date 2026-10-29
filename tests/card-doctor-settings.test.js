const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
function section(start, end) {
    return source.slice(source.indexOf(`function ${start}(`), source.indexOf(`function ${end}(`));
}
const code = [section('getPatientPrintFields', 'renderDoctorSettings'), section('formatDoctorName', 'getPatientDataFromActiveBarsPage')].join('\n');

function context(settings) {
    const identity = value => value || '';
    const sandbox = {
        DOCTOR_SETTINGS_STORAGE_KEY: 'fillbarsDoctorsV1',
        readJsonStorage: () => settings,
        document: { getElementById: () => ({ value: '2026-09-29' }) },
        sanitizePulledFullName: identity, normalizeDateForInput: identity,
        sanitizePatientHistoryNumber: identity, sanitizePatientDepartment: identity,
        sanitizeMedicalOrganization: identity, normalizeBloodGroupAbo: identity,
        normalizeBloodGroupRh: identity
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return sandbox;
}

test('selected doctor overrides BARS doctor and supplies contacts for forms', () => {
    const c = context({ doctors: [{ id: 'one', fullName: 'Морозов Роман Владимирович', position: 'Врач-хирург', phone: '+7 900 000-00-00', email: 'doctor@example.test' }], activeDoctorId: 'one' });
    const result = c.getPatientPrintFields({ fullName: 'Учебный Пациент', doctorName: 'Другой Врач Николаевич' });
    assert.equal(result.doctorName, 'Морозов Р.В.');
    assert.equal(result.doctorPosition, 'Врач-хирург');
    assert.equal(result.doctorPhone, '+7 900 000-00-00');
    assert.equal(result.doctorEmail, 'doctor@example.test');
});

test('BARS doctor remains fallback when no saved doctor is selected', () => {
    const c = context({ doctors: [], activeDoctorId: '' });
    const result = c.getPatientPrintFields({ doctorName: 'Морозов Роман Владимирович' });
    assert.equal(result.doctorName, 'Морозов Р.В.');
    assert.equal(result.doctorPosition, '');
});
