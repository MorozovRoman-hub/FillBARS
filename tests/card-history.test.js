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
