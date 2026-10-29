'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const trends=require('../lab-trends');

test('trend dates validate real calendar dates and sort across years',()=>{
    assert.equal(trends.dateStamp('29.02.2023'),null);
    assert.equal(trends.dateStamp('31.04.2026'),null);
    assert.equal(trends.dateStamp('29.10.2026 24:00'),null);
    assert.equal(trends.dateStamp('вчера'),null);
    assert.equal(trends.dateStamp('29.10.2026 12:30'),trends.dateStamp('2026-10-29T12:30:00'));
    const rows=trends.series('hemoglobin',[
        {date:'01.01.2026',value:'12',unit:'г/дл'},
        {date:'31.12.2025',value:'110',unit:'г/л'},
        {date:'',value:'100',unit:'г/л'},
        {date:'29.10.2026',value:'5',unit:'неизвестно'}
    ]);
    assert.deepEqual(rows.map(row=>row.value),[110,120,100]);
    assert.equal(rows.at(-1).stamp,null);
});

test('trends normalize units before comparing results',()=>{
    const rows=trends.series('creatinine',[
        {value:'0,0884',unit:'ммоль/л'}, {value:'1',unit:'mg/dL'}, {value:'88.4',unit:'µmol/l'}
    ]);
    assert(rows.every(row=>Math.abs(row.value-88.4)<1e-9));
    assert(Math.abs(trends.series('glucose',[{value:'100',unit:'mg/dL'}])[0].value-100/18.0182)<1e-9);
});

test('render keeps undated results off chart and text from BARS inert',()=>{
    const doc=new JSDOM('<div id="host"></div>').window.document,host=doc.querySelector('#host');
    trends.render(host,{hemoglobin:[
        {date:'28.10.2026',value:'120',unit:'г/л',service:'<img src=x onerror=alert(1)>'},
        {date:'29.10.2026',value:'120',unit:'г/л'},
        {date:'',value:'80',unit:'г/л'}
    ]},3);
    assert.equal(host.querySelectorAll('svg circle').length,2);
    assert.equal(host.querySelectorAll('tbody tr').length,3);
    assert(!host.querySelector('img'));
    assert(host.textContent.includes('<img src=x'));
    assert(host.textContent.includes('Дата неизвестна'));
    assert(!/NaN|Infinity/.test(host.innerHTML));
    trends.render(host,null);
    assert.equal(host.querySelectorAll('svg,table').length,0,'refresh clears previous patient results');
});

test('graph uses real time spacing, shows latest 12, and handles one result',()=>{
    const doc=new JSDOM('<div></div>').window.document,host=doc.querySelector('div');
    const rows=Array.from({length:15},(_,i)=>({date:`${String(i+1).padStart(2,'0')}.10.2026`,value:String(100+i),unit:'г/л'}));
    trends.render(host,{hemoglobin:rows},15);
    assert.equal(host.querySelectorAll('circle').length,12);
    assert.equal(host.querySelector('tbody td').textContent,'15.10.2026');
    assert.equal(host.querySelector('tbody tr:last-child td').textContent,'04.10.2026');
    trends.render(host,{glucose:[{date:'01.10.2026',value:'5',unit:'ммоль/л'},{date:'02.10.2026',value:'6',unit:'ммоль/л'},{date:'11.10.2026',value:'7',unit:'ммоль/л'}]},3);
    const points=[...host.querySelectorAll('circle')].map(dot=>Number(dot.getAttribute('cx')));
    assert(Math.abs((points[1]-points[0])/(points[2]-points[0])-0.1)<1e-9);
    trends.render(host,{hemoglobin:[rows[0]]},1);
    assert.equal(host.querySelectorAll('svg').length,0);
    assert.equal(host.querySelectorAll('tbody tr').length,1);
});
