/* Visual QA of the same source-derived HTML used by the in-extension iframe. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
require('../medical-print-layouts');

const root = path.resolve(__dirname, 'artifacts/new-form-refs-518/browser');
fs.mkdirSync(root, { recursive: true });
const patient = {
    fullName: 'Тестов Тест Тестович', surname: 'Тестов', firstName: 'Тест', patronymic: 'Тестович',
    birthDate: '02.03.1980', birthYear: '1980', age: '46', department: 'Тестовое отделение',
    registeredAddress: 'Тестовый адрес', medicalOrganization: 'Тестовая больница',
    diagnosis: 'Тестовый диагноз', doctorName: 'Тестов Т. Т.', historyNumber: 'TEST-123',
    operationName: 'Тестовая операция', operationDescription: 'Тестовое описание операции.',
    documentDate: '03.10.2026', startDate: '01.10.2026', endDate: '03.10.2026'
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

(async () => {
    const browser = await chromium.launch({headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try {
        const page = await browser.newPage({viewport: {width: 1300, height: 1000}});
        for (const [kind, layout] of Object.entries(globalThis.__FillBARSMedicalPrintLayouts__)) {
            const html = layout.html.replace(/\{\{(\w+)\}\}/g, (_match, field) => escape(patient[field] || ''));
            await page.setContent(html, {waitUntil: 'load'});
            await page.pdf({path: path.join(root, `${kind}.pdf`), preferCSSPageSize: true, printBackground: true});
            console.log(kind, layout.pages, await page.evaluate(() => document.documentElement.scrollHeight));
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
