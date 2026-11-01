const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../diary-core');

test('history template produces relative dates and never pre-approves clinical data', () => {
    const library = C.cleanHistoryLibrary(C.starterHistoryLibrary());
    const rows = C.instantiateHistoryTemplate(library.templates[0], '2026-09-30', '17:05');
    assert.deepEqual(rows.map(row => `${row.date} ${row.time}`), [
        '2026-09-30 17:05', '2026-10-01 09:30', '2026-10-02 09:30', '2026-10-03 09:30'
    ]);
    assert(rows.every(row => !row.reviewed && row.status === 'draft'));
    assert(rows.every(row => Object.values(row.vitals).every(value => !value)));
    assert(C.validateQueue(rows, { forSending: true }).some(error => error.field === 'reviewed'));
});

test('starter history preserves all four supplied diary narratives and plans without patient identity', () => {
    const entries = C.starterHistoryLibrary().templates[0].entries;
    assert.equal(entries.length, 4);
    assert(entries.every(item => item.diary.startsWith('Состояние пациента удовлетворительное . Жалобы: нет')));
    assert(entries.every(item => item.diary.includes('Стул без крови. Мочеиспускание свободное.')));
    assert(entries.every(item => item.diary.includes('Данных за рецидив кровотечения нет.')));
    assert(entries[0].diary.endsWith('Готовиться на колоноскопию.'));
    assert.equal(entries[0].examination, '-колоноскопия');
    assert(entries[1].diary.endsWith('На колоноскопии хронический внутренний геморрой 2 ст.'));
    assert.equal(entries[1].treatment, 'гемостатическая терапия');
    assert(entries.slice(1).every(item => item.examination === '-'));
    assert(entries.slice(2).every(item => item.treatment === ''));
    const serialized = JSON.stringify(entries);
    assert(!/Пациент:|Врач |23\.09\.2026|24\.09\.2026/.test(serialized));
});

function legacyStarterLibrary() {
    const library = C.starterHistoryLibrary();
    library.templates = library.templates.slice(0, 1);
    delete library.builtinRevision;
    const old = [
        ['Осмотр перед колоноскопией. Жалобы: [уточнить]. Общее состояние и данные осмотра: [уточнить]. Стул и признаки повторного кровотечения: [уточнить].', 'Колоноскопия по показаниям; уточнить подготовку и результаты обследования.', 'Лечение и рекомендации: [уточнить по назначению врача].'],
        ['Осмотр после колоноскопии. Жалобы и общее состояние: [уточнить]. Результат колоноскопии: [внести из протокола]. Стул и признаки кровотечения: [уточнить].', 'Оценить результат колоноскопии и динамику состояния.', 'Коррекция лечения: [уточнить].'],
        ['Контрольный осмотр. Жалобы, общее состояние, живот, стул и признаки кровотечения: [уточнить по фактическому осмотру].', 'Дальнейшее обследование: [уточнить].', 'Продолжение лечения: [уточнить].'],
        ['Повторный контрольный осмотр. Динамика состояния, жалобы, данные осмотра и стул: [уточнить по фактическому осмотру].', 'Дальнейшее обследование: [уточнить].', 'Рекомендации: [уточнить].']
    ];
    library.templates[0].entries.forEach((item, index) => [item.diary, item.examination, item.treatment] = old[index]);
    return library;
}

test('untouched stored starter migrates while preserving entry IDs and other templates', () => {
    const library = legacyStarterLibrary();
    const originalId = library.templates[0].id;
    const entryIds = library.templates[0].entries.map(item => item.id);
    const custom = C.starterHistoryLibrary().templates[0];
    custom.name = 'Мой шаблон'; custom.entries[0].diary = 'Мой клинический текст';
    library.templates.push(custom);
    const upgraded = C.upgradeStarterHistoryLibrary(library);
    assert.equal(upgraded.templates[0].id, originalId);
    assert.deepEqual(upgraded.templates[0].entries.map(item => item.id), entryIds);
    assert(upgraded.templates[0].entries[1].diary.includes('хронический внутренний геморрой 2 ст.'));
    assert.equal(upgraded.templates[1].entries[0].diary, 'Мой клинический текст');
    assert(!library.templates[0].entries[0].diary.includes('Состояние пациента'));
});

test('one edited field prevents automatic replacement of a clinician-customized starter', () => {
    const library = legacyStarterLibrary();
    library.templates[0].entries[0].examination = 'Индивидуальный план обследования';
    const upgraded = C.upgradeStarterHistoryLibrary(library);
    assert.equal(upgraded.templates[0].entries[0].examination, 'Индивидуальный план обследования');
    assert(upgraded.templates[0].entries[1].diary.includes('[внести из протокола]'));
});

test('history library rejects nonascending or excessive offsets', () => {
    const library = C.starterHistoryLibrary();
    library.templates[0].entries[1].offsetMinutes = 0;
    assert.throws(() => C.cleanHistoryLibrary(library), /возрастанию/);
    library.templates[0].entries[1].offsetMinutes = 985;
    library.templates[0].entries[3].offsetMinutes = 999999;
    assert.throws(() => C.cleanHistoryLibrary(library), /смещения/);
});

test('renal colic history preserves six source observations and relative day intervals without measured vitals', () => {
    const template = C.starterHistoryLibrary().templates.find(item => item.name === 'Почечная колика');
    assert.equal(template.side, 'left');
    assert.deepEqual(template.entries.map(item => item.offsetMinutes / 1440), [0, 1, 2, 5, 7, 9]);
    const rows = C.instantiateHistoryTemplate(template, '2026-10-29', '10:00');
    assert.equal(rows.length, 6);
    assert.equal(rows.at(-1).date, '2026-11-07');
    assert(rows[0].diary.includes('болезненный в проекции левой почки'));
    assert(rows[0].diary.includes('Обоснование клинического диагноза'));
    assert(rows[1].diary.includes('слабо положительный слева'));
    assert(rows.slice(2).every(row => row.diary.includes('отрицательный с двух сторон')));
    assert(rows.every(row => !row.reviewed && Object.values(row.vitals).every(value => value === '')));
    assert(!/120\/80|110\/80|PS 7|ЧД 1|2022|Морозов|Подпись/.test(JSON.stringify(rows)));
});

test('side switch is reversible, preserves case and contralateral text across all fields', () => {
    const template = C.renalColicHistoryTemplate();
    template.entries[0].examination = 'УЗИ левой почки. СЛЕВА. Справа без особенностей. С двух сторон.';
    template.entries[0].treatment = 'Левосторонняя колика. Левая почка. Не заменять: справочник, левофлоксацин.';
    const right = C.changeHistorySide(template, 'right');
    assert(right.entries[0].diary.includes('правой почки'));
    assert(!/слева|левой/.test(right.entries[0].diary));
    assert.equal(right.entries[0].examination, 'УЗИ правой почки. СПРАВА. Слева без особенностей. С двух сторон.');
    assert.equal(right.entries[0].treatment, 'Правосторонняя колика. Правая почка. Не заменять: справочник, левофлоксацин.');
    assert(right.entries.slice(2).every(row => row.diary.includes('с двух сторон')));
    assert.deepEqual(C.changeHistorySide(right, 'left'), template);
    assert.deepEqual(C.changeHistorySide(right, 'right'), right);
    assert.throws(() => C.changeHistorySide(template, 'both'), /сторону/);
    const tooLong = { diary: 'левой '.repeat(600), examination: '', treatment: '' };
    assert.throws(() => C.switchSideTexts(tooLong), /длину/);
    assert(tooLong.diary.startsWith('левой '));
});

test('existing history library gains renal template once without replacing custom text or undoing deletion', () => {
    const old = legacyStarterLibrary();
    old.templates[0].entries[0].treatment = 'Собственный план';
    const upgraded = C.upgradeStarterHistoryLibrary(old);
    assert.equal(upgraded.templates.length, 2);
    assert.equal(upgraded.templates[0].entries[0].treatment, 'Собственный план');
    assert.equal(C.upgradeStarterHistoryLibrary(upgraded).templates.length, 2);
    upgraded.templates = upgraded.templates.filter(item => item.id !== 'renal-colic-history-v1');
    assert.equal(C.upgradeStarterHistoryLibrary(upgraded).templates.length, 1);
    const right = C.changeHistorySide(C.renalColicHistoryTemplate(), 'right');
    assert.equal(C.cleanHistoryLibrary({type:old.type, version:1, templates:[right]}).templates[0].side, 'right');
});


test('history vitals survive cleaning, side change and draft creation independently per entry',()=>{
    const template=C.renalColicHistoryTemplate();
    template.entries[0].vitals={temperature:'37,2',pressure:'130/80',pulse:'92',respiration:'20'};
    template.entries[1].vitals={temperature:'36,8',pulse:'82',respiration:'18'};
    const library=C.cleanHistoryLibrary({type:'fillbars-card-history-templates',version:1,templates:[template]});
    const right=C.changeHistorySide(library.templates[0],'right');
    const rows=C.instantiateHistoryTemplate(right,'2026-11-01','10:00');
    assert.deepEqual(rows[0].vitals,template.entries[0].vitals);
    assert.deepEqual(rows[1].vitals,{temperature:'36,8',pressure:'',pulse:'82',respiration:'18'});
    assert(Object.values(rows[2].vitals).every(value=>value===''));
    assert.equal(C.fields(rows[0]).TEMPERATURE,'37,2');assert.equal(C.fields(rows[0]).THSS,'92');assert.equal(C.fields(rows[0]).THD,'20');
    assert(rows.every(row=>!row.reviewed&&row.status==='draft'));
    rows[0].vitals.pulse='100';assert.equal(right.entries[0].vitals.pulse,'92');assert.equal(rows[1].vitals.pulse,'82');
});
test('history vitals reject corrupt or oversized stored fields without affecting old templates',()=>{
    const library=C.starterHistoryLibrary(),entry=library.templates[0].entries[0];
    for(const vitals of [null,[],{pulse:80},{respiration:'x'.repeat(68)}]){
        entry.vitals=vitals;assert.throws(()=>C.cleanHistoryLibrary(library),/показател/i);
    }
    delete entry.vitals;
    assert(Object.values(C.cleanHistoryLibrary(library).templates[0].entries[0].vitals).every(value=>value===''));
});
