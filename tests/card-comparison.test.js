'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../diary-core');
test('phrase diff reconstructs both versions, including punctuation, Cyrillic and line breaks',()=>{
    for(const [before,after] of [
        ['Боли слева.\nЖивот мягкий.','Боли справа.\nЖивот мягкий.'],
        ['Нет жалоб.','Есть жалобы.'],['','Новый текст'],['Удалить',''],['Без изменений','Без изменений'],
        ['a '.repeat(1800),'b '.repeat(1800)],['<script>текст</script>','<img>правка']
    ]){
        const parts=C.diffText(before,after);
        assert.equal(parts.filter(p=>p.type!=='added').map(p=>p.text).join(''),before);
        assert.equal(parts.filter(p=>p.type!=='removed').map(p=>p.text).join(''),after);
    }
    const parts=C.diffText('Боли слева. Живот мягкий.','Боли справа. Живот мягкий.');
    assert(parts.some(p=>p.type==='removed'&&p.text==='слева'));
    assert(parts.some(p=>p.type==='added'&&p.text==='справа'));
    assert(parts.some(p=>p.type==='equal'&&p.text.includes('Живот мягкий.')));
});
test('comparison snapshots are independent of later edits and exclude patient metadata',()=>{
    const row={...C.createRow(),diary:'Исходный текст',patient:'private'};
    const snapshot=C.comparisonSnapshot(row);
    row.diary='Правка';row.vitals.pulse='90';
    assert.equal(snapshot.diary,'Исходный текст');assert.equal(snapshot.vitals.pulse,'80');assert(!('patient' in snapshot));
});
