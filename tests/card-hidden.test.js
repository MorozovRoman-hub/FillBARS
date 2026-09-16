'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const Hidden = require('../diary-hidden-adapter');
function onWorker(window, initialize) {
    const append = window.document.body.append.bind(window.document.body);
    window.document.body.append = host => {
        append(host);
        const body = host.contentDocument.body;
        const appendInner = body.append.bind(body);
        body.append = element => {
            appendInner(element);
            if (element.tagName === 'IFRAME') initialize(element);
        };
    };
}
function setup(options = {}) {
    const dom = new JSDOM('<body><div id="card"></div></body>', { url: 'http://fixture.invalid/' });
    const w = dom.window, card = w.document.getElementById('card');
    let key = 'patient1', child, opened = 0;
    const calls = [];
    w.SYS_pages_window = [{ form: { name: 'ArmPatientsInDep/hosp_history_new', containerForm: card, getVar: key => options.missing?.includes(key) ? null : 'test-id' } }];
    const foreground = { patientContext: () => ({ key, card }), execute: async r => ({ ok: true, action: r.action }) };
    onWorker(w, frame => {
        child = frame.contentWindow;
        Object.defineProperty(child.document, 'readyState', { get: () => 'complete' });
        child.openWindow = config => { opened++; assert.equal(config.name, 'ArmPatientsInDep/hosp_history_new'); assert.equal('PATIENT_ID' in config.vars, false); };
    });
    const factory = { create: ({ guard }) => ({
        patientContext: () => ({ key: 'patient1' }),
        execute: async request => {
            calls.push(request.action);
            if (options.dialog && request.action === 'prepare') child.confirm('Test');
            if (options.change && request.action === 'prepare') key = 'patient2';
            if (request.action === 'save') guard();
            if (options.failed && request.action === 'save') return { ok: false, message: 'Test failure' };
            return { ok: true, verified: true, recordId: 'test-record' };
        }
    }) };
    const adapter = Hidden.create({ window: w, foreground, factory, timeout: 20 });
    const args = { runId: 'run', context: { key }, row: { id: 'row' }, values: { S_DNEVNIK: 'fixture text' } };
    return { dom, w, adapter, args, calls, get opened() { return opened; } };
}
test('фон: подготовка только загружает карточку, создание начинается на save, фрейм удаляется после подтверждения', async () => {
    const s = setup();
    try {
        assert.equal((await s.adapter.execute({ ...s.args, action: 'prepare' })).ok, true);
        assert.equal(s.opened, 1); assert.deepEqual(s.calls, []);
        const frame = s.w.document.querySelector('iframe');
        assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-forms');
        assert.equal(frame.getAttribute('aria-hidden'), 'true');
        assert.equal((await s.adapter.execute({ ...s.args, action: 'save' })).verified, true);
        assert.deepEqual(s.calls, ['prepare', 'save']);
        assert.equal(s.w.document.querySelector('iframe'), null);
        assert.equal((await s.adapter.execute({ ...s.args, action: 'save' })).code, 'not_prepared');
    } finally { s.dom.window.close(); }
});
for (const [name, options] of [['ошибка сохранения', { failed: true }], ['смена пациента', { change: true }], ['подтверждение БАРС', { dialog: true }]]) {
    test('фон: ' + name + ' блокирует повтор и требует ручной проверки', async () => {
        const s = setup(options);
        try {
            assert.equal((await s.adapter.execute({ ...s.args, action: 'prepare' })).ok, true);
            assert.equal((await s.adapter.execute({ ...s.args, action: 'save' })).code, 'save_uncertain');
            const count = s.calls.length;
            assert.equal((await s.adapter.execute({ ...s.args, action: 'save' })).code, 'save_uncertain');
            assert.equal(s.calls.length, count);
            assert.equal((await s.adapter.execute({ action: 'release' })).code, 'save_uncertain');
            assert.equal((await s.adapter.execute({ action: 'release', checkedInBars: true })).ok, true);
            assert.equal(s.w.document.querySelector('iframe'), null);
        } finally { s.dom.window.close(); }
    });
}
test('заполнение без сохранения остаётся явно видимым ручным режимом', async () => {
    const s = setup();
    try {
        assert.equal((await s.adapter.execute({ ...s.args, action: 'prepare', fillOnly: true })).ok, true);
        assert.equal(s.opened, 0); assert.deepEqual(s.calls, []);
    } finally { s.dom.window.close(); }
});
test('свежая карточка без PATIENT_ID и HH_VIEW_MODE загружается до открытия осмотров', async () => {
    const s = setup({ missing: ['PATIENT_ID', 'HH_VIEW_MODE'] });
    try {
        const result = await s.adapter.execute({ ...s.args, action: 'prepare' });
        assert.equal(result.ok, true, result.message); assert.equal(s.opened, 1);
        assert.deepEqual(s.calls, []);
    } finally { s.dom.window.close(); }
});
test('загрузчик БАРС обращается только к частному родителю и не снимает блокировку ручного запроса', async () => {
    const s = setup();
    try {
        const root = s.w.document.createElement('spinner-ctrl');
        let shows = 0, hides = 0;
        root.show = () => { shows++; root.setAttribute('aria-busy', 'true'); };
        root.hide = () => { hides++; root.setAttribute('aria-busy', 'false'); };
        s.w.document.body.appendChild(root);
        root.show(); // A request started by the physician in the visible card.
        assert.equal((await s.adapter.execute({ ...s.args, action: 'prepare' })).ok, true);
        const host = s.w.document.querySelector('iframe');
        const worker = host.contentDocument.querySelector('[data-fillbars-worker]').contentWindow;
        // Exact parent lookup used by the observed BARS DLoading implementation.
        const target = worker.parent.document.querySelector('spinner-ctrl');
        assert.notEqual(target, root);
        target.show(); target.hide(); target.show(); target.hide();
        assert.equal(shows, 1); assert.equal(hides, 0);
        assert.equal(root.getAttribute('aria-busy'), 'true');
        await s.adapter.execute({ action: 'release' });
        assert.equal(root.getAttribute('aria-busy'), 'true');
        root.hide(); assert.equal(hides, 1);
    } finally { s.dom.window.close(); }
});
for (const field of ['HH_ID', 'HH_DEP_ID']) test('без ' + field + ' загрузка блокируется с точным именем реквизита', async () => {
    const s = setup({ missing: [field] });
    try {
        const result = await s.adapter.execute({ ...s.args, action: 'prepare' });
        assert.equal(result.code, 'background_context'); assert.ok(result.message.includes(field));
        assert.equal(s.opened, 0); assert.deepEqual(s.calls, []);
    } finally { s.dom.window.close(); }
});
test('реальный адаптер проходит полный цикл внутри отдельного документа, не открывая форм в исходной карточке', async () => {
    const Adapter = require('../diary-bars-adapter');
    const Core = require('../diary-core');
    const { buildFixture } = require('./card-fixture');
    const dom = new JSDOM('<body></body>', { url: 'http://fixture.invalid/' });
    const w = dom.window;
    try {
        const original = buildFixture(w);
        const foreground = Adapter.create({ window: w, document: w.document, isVisible: original.visible });
        const context = foreground.patientContext();
        w.SYS_pages_window = [{ form: { name: 'ArmPatientsInDep/hosp_history_new', containerForm: context.card, getVar: () => 'fixture-id' } }];
        let hiddenFixture;
        onWorker(w, frame => {
            const child = frame.contentWindow;
            Object.defineProperty(child.document, 'readyState', { get: () => 'complete' });
            child.openWindow = () => {
                child.document.open(); child.document.write('<html><body></body></html>'); child.document.close();
                hiddenFixture = buildFixture(child);
            };
        });
        const factory = { create: options => Adapter.create({ ...options, isVisible: hiddenFixture.visible, interval: 2, settleMs: 8, timeout: 300 }) };
        const adapter = Hidden.create({ window: w, foreground, factory, timeout: 100 });
        const row = Core.createRow({ date: '2026-09-16', time: '08:00' });
        row.diary = 'Только искусственные данные'; row.treatment = 'Учебная тактика'; row.reviewed = true;
        const { card: ignoredCard, ...patient } = context;
        const args = { runId: 'synthetic', context: patient, row, values: Core.fields(row) };
        const prepared = await adapter.execute({ ...args, action: 'prepare' });
        assert.equal(prepared.ok, true, prepared.message);
        assert.equal(hiddenFixture.saveClicks, 0);
        const result = await adapter.execute({ ...args, action: 'save' });
        assert.equal(result.ok, true, result.message); assert.equal(result.verified, true);
        assert.equal(hiddenFixture.saveClicks, 1); assert.equal(original.saveClicks, 0);
        assert.equal(hiddenFixture.saved[0].fields.S_DNEVNIK, row.diary);
        assert.equal(w.document.querySelector('[formname="UniversalTemplate/UniversalTemplate"]'), null);
    } finally { dom.window.close(); }
});
