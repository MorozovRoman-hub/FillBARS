'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const C = require('../diary-core');
const Adapter = require('../diary-bars-adapter');
const {buildFixture}=require('./card-fixture');
async function setup(options={}){
    const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://fixture.invalid/'});
    const fixture=buildFixture(dom.window,options);
    const adapter=Adapter.create({document:dom.window.document,window:dom.window,isVisible:fixture.visible,timeout:180,interval:2,settleMs:8});
    const probe=await adapter.execute({action:'probe'});
    const row=C.createRow({date:'2026-09-01',time:'08:00'});row.diary='Учебный текст';row.examination='';row.treatment='Учебный план';row.reviewed=true;
    const args={runId:'run-test',context:probe.patient,row,values:C.fields(row)};
    return {dom,fixture,adapter,args};
}
test('полный цикл двух дневников подтверждается строками списка без контекстного меню и повторного открытия',async()=>{
    const {dom,fixture,adapter,args}=await setup({noContextMenu:true});
    for(let i=0;i<2;i++){
        args.row.time='0'+(8+i)+':00';args.row.id='row'+i;args.values=C.fields(args.row);
        const prepare=await adapter.execute({action:'prepare',...args});assert.equal(prepare.ok,true,prepare.message);
        assert.equal(fixture.saveClicks,i);
        const save=await adapter.execute({action:'save',...args});assert.equal(save.ok,true,save.message);assert.equal(save.verified,true);assert.equal(save.verification,'list');
        assert.equal(fixture.saved[i].fields.STAC_PLAN,'');assert.equal(fixture.saved[i].fields.S_DNEVNIK,'Учебный текст');
    }
    assert.equal(fixture.saveClicks,2);assert.equal(fixture.menuClicks,0);dom.window.close();
});
test('новый приём с предварительным текстом полностью заменяется, без сохранения',async()=>{
    const {dom,fixture,adapter,args}=await setup();fixture.openList();fixture.openEditor();
    assert.equal((await adapter.execute({action:'prepare',...args})).ok,true);
    assert.equal(dom.window.document.querySelector('[template_field="STAC_PLAN"] textarea').value,'');
    assert.equal(fixture.saveClicks,0);dom.window.close();
});
test('смена пациента между подготовкой и сохранением блокирует запись',async()=>{
    const {dom,fixture,adapter,args}=await setup();
    assert.equal((await adapter.execute({action:'prepare',...args})).ok,true);
    fixture.card.querySelector('[name="HH_PREF_NUMB"]').textContent='Другая история 123';
    const result=await adapter.execute({action:'save',...args});
    assert.equal(result.code,'patient_changed');assert.equal(fixture.saveClicks,0);dom.window.close();
});
test('правки в БАРС после подготовки не сохраняются без новой проверки',async()=>{
    const {dom,fixture,adapter,args}=await setup();await adapter.execute({action:'prepare',...args});
    dom.window.document.querySelector('[template_field="AD"] input').value='130/90';
    assert.equal((await adapter.execute({action:'save',...args})).code,'edited_after_preview');
    assert.equal(fixture.saveClicks,0);dom.window.close();
});
test('неоднозначность полей останавливает заполнение до записи',async()=>{
    const {dom,fixture,adapter,args}=await setup();fixture.openList();const form=fixture.openEditor();
    form.append(form.querySelector('[template_field="AD"]').cloneNode(true));
    assert.equal((await adapter.execute({action:'prepare',...args})).code,'field_structure');
    assert.equal(fixture.saveClicks,0);dom.window.close();
});
test('редактор старого дневника нельзя использовать как новый',async()=>{
    const {dom,fixture,adapter,args}=await setup();fixture.openList();fixture.openEditor({},true);
    assert.equal((await adapter.execute({action:'prepare',...args})).code,'existing_editor');
    assert.equal(fixture.saveClicks,0);dom.window.close();
});
test('при неподтверждённом сохранении повторный вызов не отправляет дубль',async()=>{
    const {dom,fixture,adapter,args}=await setup({saveMode:'timeout'});await adapter.execute({action:'prepare',...args});
    assert.equal((await adapter.execute({action:'save',...args})).code,'save_uncertain');
    assert.equal((await adapter.execute({action:'save',...args})).ok,false);
    assert.equal(fixture.saveClicks,1);dom.window.close();
});
test('подтверждение по списку сообщает свой тип и не выдаётся за сверку сохранённого текста',async()=>{
    const {dom,fixture,adapter,args}=await setup({saveMode:'mismatch'});await adapter.execute({action:'prepare',...args});
    const result=await adapter.execute({action:'save',...args});
    assert.equal(result.verification,'list');assert.equal(result.ok,true);
    assert.notEqual(fixture.saved[0].fields.RECOMEND_CONS,args.values.RECOMEND_CONS);
    assert(!result.trace.some(event=>/перечитан/.test(event.stage)));
    assert.equal(fixture.saveClicks,1);dom.window.close();
});
test('существующая строка с той же датой и временем блокирует повторную подготовку',async()=>{
    const {dom,fixture,adapter,args}=await setup();
    await adapter.execute({action:'prepare',...args});assert.equal((await adapter.execute({action:'save',...args})).ok,true);
    assert.equal((await adapter.execute({action:'prepare',...args,runId:'new-run'})).code,'duplicate');
    assert.equal(fixture.saveClicks,1);dom.window.close();
});
test('две открытые карточки не смешиваются в один контекст',async()=>{
    const {dom,fixture,adapter}=await setup();dom.window.document.body.append(fixture.card.cloneNode(true));
    assert.equal((await adapter.execute({action:'probe'})).code,'patient_card');dom.window.close();
});

test('ошибка самого вызова сохранения считается неопределённой и не допускает повтора',async()=>{
    const {dom,adapter,args}=await setup();await adapter.execute({action:'prepare',...args});
    let clicks=0;
    dom.window.document.querySelector('[name="Btn_SaveClose"]').click=()=>{clicks++;throw new Error('Сбой обработчика');};
    assert.equal((await adapter.execute({action:'save',...args})).code,'save_uncertain');
    assert.equal((await adapter.execute({action:'release'})).code,'save_uncertain');
    assert.equal((await adapter.execute({action:'save',...args})).ok,false);
    assert.equal(clicks,1);dom.window.close();
});

test('текст показателей и будущая дата передаются на сохранение без преобразования',async()=>{
    const {dom,fixture,adapter,args}=await setup();
    Object.assign(args.row,{date:'2099-01-01',vitals:{temperature:'36.6',pressure:'120/80 мм рт. ст.',pulse:'60 + ЭКС',respiration:'16; сатурация 98% на воздухе'}});
    args.values=C.fields(args.row);
    assert.equal((await adapter.execute({action:'prepare',...args})).ok,true);
    const result=await adapter.execute({action:'save',...args});assert.equal(result.ok,true,result.message);
    assert.equal(fixture.saved[0].fields.THSS,'60 + ЭКС');
    assert.equal(fixture.saved[0].fields.THD,'16; сатурация 98% на воздухе');
    assert.equal(fixture.saved[0].fields.TEMPERATURE,'36.6');dom.window.close();
});

test('запоздавшая строка списка подтверждает сохранение без повторного клика',async()=>{
    const {dom,fixture,adapter,args}=await setup({rowDelay:35});
    try{
        await adapter.execute({action:'prepare',...args});
        const result=await adapter.execute({action:'save',...args});
        assert.equal(result.ok,true,result.message);assert.equal(fixture.saveClicks,1);
        assert(result.trace.some(event=>event.stage==='Окно закрылось после сохранения'));
        assert(result.trace.some(event=>event.verification==='list'&&event.matchingRows===1));
    }finally{dom.window.close();}
});

test('закрытие формы без строки списка сохраняет неопределённость и точный этап в журнале',async()=>{
    const {dom,fixture,adapter,args}=await setup({saveMode:'no-list-row'});
    try{
        await adapter.execute({action:'prepare',...args});
        const result=await adapter.execute({action:'save',...args});
        assert.equal(result.code,'save_uncertain');
        const event=result.trace.find(event=>event.stage==='Подтверждение сохранения не получено');
        assert.equal(event.at,'wait_list');assert.equal(event.cause,'timeout');assert.equal(event.newRows,0);
        assert.equal((await adapter.execute({action:'save',...args})).ok,false);assert.equal(fixture.saveClicks,1);
    }finally{dom.window.close();}
});

test('смена пациента при ожидании списка не подтверждает запись в другой карточке',async()=>{
    const {dom,fixture,adapter,args}=await setup({rowDelay:50});
    try{
        await adapter.execute({action:'prepare',...args});
        dom.window.setTimeout(()=>fixture.card.querySelector('[name="HH_PREF_NUMB"]').textContent='Другая история 123',8);
        const result=await adapter.execute({action:'save',...args});
        assert.equal(result.code,'save_uncertain');assert.equal(fixture.saveClicks,1);
        assert(result.trace.some(event=>event.cause==='patient_changed'));
    }finally{dom.window.close();}
});

test('услуга и история читаются из самого INPUT, без поиска вложенного поля',async()=>{
    const {dom,fixture,adapter,args}=await setup({directControls:true});
    assert.equal((await adapter.execute({action:'prepare',...args})).ok,true);
    assert.equal((await adapter.execute({action:'save',...args})).verified,true);
    assert.deepEqual(fixture.saved[0].fields,args.values);dom.window.close();
});

test('скрытые идентификаторы внутри компонентов не подменяют отображаемые реквизиты',async()=>{
    const {dom,adapter,args}=await setup({hiddenControlIds:true});
    const result=await adapter.execute({action:'prepare',...args});
    assert.equal(result.ok,true,result.message);dom.window.close();
});

test('появление окна раньше реквизитов и унаследованных полей не вызывает ложный отказ',async()=>{
    const {dom,fixture,adapter,args}=await setup({directControls:true,loadDelay:35});
    fixture.openList();fixture.openEditor();
    assert.equal((await adapter.execute({action:'probe'})).ok,true);
    const result=await adapter.execute({action:'prepare',...args});
    assert.equal(result.ok,true,result.message);
    assert(result.trace.some(entry=>entry.stage==='Приём загружен'));
    assert.deepEqual(adapter.readFields(dom.window.document.querySelector('[formname="UniversalTemplate/UniversalTemplate"]')),args.values);
    assert.equal(fixture.saveClicks,0);dom.window.close();
});

test('позднее наследование заново заменяется во всех девяти полях, включая пустой план',async()=>{
    const {dom,fixture,adapter,args}=await setup({inheritAfterFill:true});
    const prepared=await adapter.execute({action:'prepare',...args});
    assert.equal(prepared.ok,true,prepared.message);
    assert(prepared.trace.some(entry=>entry.stage==='БАРС изменил поля после заполнения'));
    assert.equal((await adapter.execute({action:'save',...args})).verified,true);
    assert.deepEqual(fixture.saved[0].fields,args.values);
    assert.equal(fixture.saved[0].fields.STAC_PLAN,'');dom.window.close();
});

test('штатный setter с добавлением текста всё равно заканчивается точной заменой значения',async()=>{
    const {dom,fixture,adapter,args}=await setup();fixture.openList();const form=fixture.openEditor();
    form.page={setValue(name,value){const control=form.querySelector('[name="'+name+'"]');const input=control.querySelector('textarea')||control.querySelector('input');input.value+=value;}};
    assert.equal((await adapter.execute({action:'prepare',...args})).ok,true);
    assert.deepEqual(adapter.readFields(form),args.values);dom.window.close();
});

test('заголовок снаружи внутреннего контейнера окна учитывается при сверке пациента',async()=>{
    const {dom,fixture,adapter,args}=await setup();fixture.openList();const form=fixture.openEditor();
    const shell=form.closest('.window'),heading=shell.querySelector('h2'),outer=dom.window.document.createElement('section');
    shell.replaceWith(outer);outer.append(heading,shell);
    assert.equal((await adapter.execute({action:'prepare',...args})).ok,true);dom.window.close();
});

test('имя в унаследованном тексте не маскирует несовпадение пациента в заголовке',async()=>{
    const {dom,fixture,adapter,args}=await setup();fixture.openList();const form=fixture.openEditor();
    form.closest('.window').querySelector('h2').textContent='Добавление приема: Другой Пациент Тестович';
    form.querySelector('[template_field="S_DNEVNIK"] textarea').value='Учебный Пациент Тестович';
    const result=await adapter.execute({action:'prepare',...args});
    assert.equal(result.code,'editor_patient');assert.equal(fixture.saveClicks,0);
    const log=JSON.stringify(result.trace);
    assert(!log.includes('Тестович'));assert(result.trace.some(entry=>entry.nameMatches===false));dom.window.close();
});

test('история сверяется с выбранным пунктом SELECT, а не со всеми его вариантами',async()=>{
    const {dom,fixture,adapter,args}=await setup();fixture.openList();const form=fixture.openEditor();
    const select=dom.window.document.createElement('select');
    select.append(new dom.window.Option('Другая история № 999','other',true,true),new dom.window.Option('УЧЕБНАЯ_0001-0002/0003','correct'));
    form.querySelector('[name="Ctrl_DISEASECASES"]').replaceChildren(select);
    const result=await adapter.execute({action:'prepare',...args});
    assert.equal(result.code,'editor_patient');assert(result.trace.some(entry=>entry.historyMatches===false));
    assert.equal(fixture.saveClicks,0);dom.window.close();
});
