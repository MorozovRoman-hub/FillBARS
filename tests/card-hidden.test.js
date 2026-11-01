'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const HiddenImpl = require('../diary-hidden-adapter');
const Hidden = {...HiddenImpl, create: options => HiddenImpl.create({runtimeSettleMs:0,...options})};
test('сбой загрузки второй карточки не создаёт осмотров ни в одном контексте', async () => {
    const s = setup(); let cards = 0, mutations = 0;
    const foreground = { patientContext: () => ({ key: 'patient1', card: s.w.document.getElementById('card') }), execute: async () => ({ ok: true }) };
    const factory = { create: () => {
        const index = cards++;
        return { patientContext: () => { if (index === 1) throw Object.assign(new Error('fixture'), { code: 'patient_card' }); return { key: 'patient1' }; }, execute: async () => { mutations++; return { ok: true }; } };
    } };
    try {
        const adapter = Hidden.create({ window: s.w, foreground, factory, timeout: 10 });
        const result = await adapter.execute({ action: 'parallel', items: [0,1,2].map(i => ({ ...s.args, row: { id: 'row' + i } })) });
        assert.equal(cards, 3); assert.equal(mutations, 0);
        assert.equal(result.noWrites, true); assert.equal(result.uncertain, false);
        assert.equal(result.results[1].code, 'background_loading_card');
        assert.ok(result.trace.some(e => e.row === 2 && e.at === 'card' && e.identityError === 'patient_card'));
        assert.equal(s.w.document.querySelector('iframe'), null);
    } finally { s.dom.window.close(); }
});
test('группы из 1–3 записей ждут подготовки всех участников перед сохранением', async () => {
    for (const size of [1,2,3]) for (const failedIndex of size > 1 ? [-1, 1] : [-1]) {
        const s = setup();
        let created = 0, prepared = 0, saves = 0;
        const factory = { create: () => {
            const index = created++;
            return { patientContext: () => ({ key: 'patient1' }), execute: async r => {
                if (r.action === 'prepare') {
                    await new Promise(resolve => setTimeout(resolve, 3 + index * 7)); prepared++;
                    if (index === failedIndex) return { ok: false, message: 'fixture failure' };
                    return { ok: true };
                }
                assert.equal(prepared, size); saves++;
                return { ok: true, verified: true, recordId: 'record' + index };
            } };
        } };
        const foreground = { patientContext: () => ({ key: 'patient1', card: s.w.document.getElementById('card') }), execute: async () => ({ ok: true }) };
        const adapter = Hidden.create({ window: s.w, foreground, factory });
        try {
            const items = Array.from({length:size},(_,i) => ({ ...s.args, row: { id: 'row' + i } }));
            const result = await adapter.execute({ action: 'parallel', items });
            assert.equal(created, size); assert.equal(result.results.length, size);
            assert.equal(saves, failedIndex < 0 ? size : 0);
            assert.equal(result.uncertain, failedIndex >= 0);
            assert.equal(result.trace.filter(e => e.stage === 'Запуск сохранения').length, saves);
            if (failedIndex >= 0) assert.equal((await adapter.execute({ action: 'parallel', items })).code, 'save_uncertain');
            assert.equal((await adapter.execute({ action: 'release', checkedInBars: true })).ok, true);
        } finally { s.dom.window.close(); }
    }
});
function onWorker(window, initialize) {
    const append = window.document.body.append.bind(window.document.body);
    window.document.body.append = host => {
        append(host);
        const body = host.contentDocument.body;
        const appendInner = body.append.bind(body);
        body.append = element => {
            appendInner(element);
            if (element.tagName === 'IFRAME') {
                initialize(element);
                const doc=element.contentDocument,root=doc.documentElement||doc.appendChild(doc.createElement('html'));
                const content=doc.body||root.appendChild(doc.createElement('body'));
                const container=doc.createElement('div');container.id='_mainContainer';content.append(container);
            }
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
        if(options.http)child.XMLHttpRequest=class extends child.EventTarget{
            open(){} send(){this.status=200;this.dispatchEvent(new child.Event('loadend'));}
        };
        let readyState=options.delayedBootstrap?'interactive':'complete';
        child.SYS_countRequests=options.delayedBootstrap?1:0;
        if(options.login)child.SYS_pages_window=[{form:{name:'System/login'}}];
        Object.defineProperty(child.document, 'readyState', { get: () => readyState });
        if(options.delayedBootstrap){setTimeout(()=>{readyState='complete';},20);setTimeout(()=>{child.SYS_countRequests=0;},50);}
        child.openWindow = config => {
            opened++; assert.equal(readyState,'complete');assert.equal(child.SYS_countRequests,0);assert.equal(config.name, 'ArmPatientsInDep/hosp_history_new'); assert.equal('PATIENT_ID' in config.vars, false);
            if(options.http){const request=new child.XMLHttpRequest();request.open('POST','http://fixture.invalid/getform.php?private-id=secret');request.send('private-body=secret');}
        };
    });
    const factory = { create: ({ guard }) => ({
        patientContext: () => ({ key: 'patient1' }),
        execute: async request => {
            calls.push(request.action);
            if (options.dialog && request.action === 'prepare') child.confirm('Test');
            if (options.change && request.action === 'prepare') key = 'patient2';
            if (request.action === 'save') guard();
            if (options.failed && request.action === 'save') return { ok: false, message: 'Test failure' };
            if (options.readback && request.action === 'save') return options.readback;
            return { ok: true, verified: true, recordId: 'test-record' };
        }
    }) };
    const adapter = Hidden.create({ window: w, foreground, factory, timeout: options.timeout || 20, diagnostic: options.diagnostic });
    const args = { runId: 'run', context: { key }, row: { id: 'row' }, values: { S_DNEVNIK: 'fixture text' } };
    return { dom, w, adapter, args, calls, get opened() { return opened; } };
}
test('фон сохраняет сведения о расхождениях и блокирует повторное сохранение',async()=>{
    const receipt={ok:true,saved:true,verified:false,recordId:'saved',verification:'mismatch',differences:[{field:'S_DNEVNIK',actual:'Фактический текст',truncated:false}]};
    const s=setup({readback:receipt});
    try{
        await s.adapter.execute({...s.args,action:'prepare'});
        const result=await s.adapter.execute({...s.args,action:'save'});
        assert.equal(result.saved,true);assert.equal(result.verification,'mismatch');assert.deepEqual(result.differences,receipt.differences);
        assert.equal((await s.adapter.execute({...s.args,action:'save'})).ok,false);
        assert.equal(s.calls.filter(action=>action==='save').length,1);
    }finally{s.dom.window.close();}
});

test('entry URL preserves the BARS deployment directory without patient query parameters',()=>{
    assert.equal(Hidden.entryUrl('https://mis.example/bars/index.php?page=private#patient'),'https://mis.example/bars/');
    assert.equal(Hidden.entryUrl('https://mis.example/bars/'),'https://mis.example/bars/');
    assert.equal(Hidden.entryUrl('https://mis.example/'),'https://mis.example/');
    assert.throws(()=>Hidden.entryUrl('https://mis.example/','https://other.example/'),/том же сервере/);
    assert.equal(Hidden.entryDocumentMatches('https://mis.example/bars/index.php','https://mis.example/bars/'),true);
    assert.equal(Hidden.entryDocumentMatches('https://other.example/bars/','https://mis.example/bars/'),false);
    assert.equal(Hidden.entryDocumentMatches('https://mis.example/login','https://mis.example/bars/'),false);
});

test('callable openWindow during bootstrap does not open a card until native requests finish',async()=>{
    const s=setup({delayedBootstrap:true,timeout:600});
    try{
        const result=await s.adapter.execute({...s.args,action:'prepare'});
        assert.equal(result.ok,true,result.message);assert.equal(s.opened,1);assert.deepEqual(s.calls,[]);
    }finally{s.dom.window.close();}
});

test('a login request stops background initialization before any card or observation is created',async()=>{
    const s=setup({login:true});
    try{
        const result=await s.adapter.execute({...s.args,action:'prepare'});
        assert.equal(result.code,'background_login');assert.equal(s.opened,0);assert.deepEqual(s.calls,[]);
    }finally{s.dom.window.close();}
});
test('form-loading diagnostics include endpoint and status without request identifiers or bodies',async()=>{
    const trace=[],s=setup({http:true,diagnostic:(stage,details)=>trace.push({stage,...details})});
    try{
        assert.equal((await s.adapter.execute({...s.args,action:'prepare'})).ok,true);
        assert(trace.some(item=>item.stage==='HTTP начало'&&item.endpoint==='getform.php'));
        assert(trace.some(item=>item.stage==='HTTP завершение'&&item.status===200));
        assert(!/secret|private-id|private-body|test-id|fixture.invalid/.test(JSON.stringify(trace)));
    }finally{s.dom.window.close();}
});

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
