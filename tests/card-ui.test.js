'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const C=require('../diary-core');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function setup({state,library,settings={},failConnect=false,otherState,statusGate,continueResult}={}){
    const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../diaries.html'),'utf8'),{url:'https://extension.invalid/diaries.html?tab=1',runScripts:'outside-only'});
    const win=dom.window;
    let poll;
    win.setInterval=fn=>{poll=fn;return 0;};
    win.confirm=()=>true;
    win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    win.HTMLDialogElement.prototype.close=function(){this.open=false;};
    const row=C.createRow({date:'2026-09-01',time:'08:00'});
    let current=state||{patient:{key:'test',fullName:'Учебный пациент',birth:'01.01.1980',history:'ДЕМО'},draft:{rows:[row],defaults:{...C.DEFAULTS},profileId:'',hourStep:4},run:null};
    let lib=library||C.emptyLibrary();
    const calls=[];
    let sourceListener;
    win.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{sourceListener=fn;}},sendMessage:async message=>{
        calls.push(message);
        if(message.action==='load'){if(message.tabId===2&&otherState)current=otherState;return {ok:true,state:current,library:lib,settings};}
        if(message.action==='connect'&&failConnect)return {ok:false,error:'Карточка закрыта'};
        if(message.action==='draft'){current={...current,draft:JSON.parse(JSON.stringify(message.draft))};return {ok:true,state:current};}
        if(message.action==='status'){const snapshot=JSON.parse(JSON.stringify(current));if(statusGate)await statusGate;return {ok:true,state:snapshot};}
        if(message.action==='continue'&&continueResult){const result=await continueResult(message,current);if(result.state)current=result.state;return result;}
        if(message.action==='saveLibrary'){lib=C.cleanLibrary(message.library);return {ok:true,library:lib};}
        if(message.action==='saveSettings'){settings=C.cleanSettings(message.settings);return {ok:true,settings};}
        return {ok:true,state:current};
    }}};
    win.eval(fs.readFileSync(path.join(__dirname,'../diary-core.js'),'utf8'));
    await win.eval(fs.readFileSync(path.join(__dirname,'../diaries.js'),'utf8'));
    const $=id=>win.document.getElementById(id);
    const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new win.Event('input',{bubbles:true}));};
    const source=tabId=>new Promise(resolve=>sourceListener({namespace:'fillbars-card-ui-v1',action:'source',tabId},{id:'test'},resolve));
    return {dom,win,$,input,calls,source,poll:()=>poll(),get state(){return current;},get library(){return lib;},get settings(){return settings;}};
}
test('редактирование сбрасывает подтверждение и новые записи наследуют изменённые показатели',async()=>{
    const app=await setup();
    app.input('diary','Учебный текст');app.$('reviewed').click();assert.equal(app.$('reviewed').checked,true);
    app.input('temperature','37,3');assert.equal(app.$('reviewed').checked,false);
    app.$('addTime').click();assert.equal(app.$('temperature').value,'37,3');assert.equal(app.$('time').value,'12:00');
    await pause(420);assert.equal(app.state.draft.rows.length,2);assert.equal(app.state.draft.rows[0].vitals.temperature,'37,3');
    app.dom.window.close();
});

function recoveryState(count=2){
    const rows=Array.from({length:count},(_,index)=>({...C.createRow({date:'2026-09-01',time:index?'22:00':'18:00'}),diary:'Учебный дневник '+index,reviewed:true}));
    return {patient:{key:'test',fullName:'Учебный пациент'},draft:{rows,defaults:{...C.DEFAULTS},hourStep:4,profileId:''},run:{id:'run-recovery',index:0,status:'uncertain',phase:'saving',rows:structuredClone(rows),results:[],updatedAt:1}};
}

test('подтверждение текущего дневника отправляет команду продолжения и сохраняет список черновиков',async()=>{
    let unblock;const gate=new Promise(resolve=>{unblock=resolve;});
    const app=await setup({state:recoveryState(),continueResult:async(message,current)=>{
        await gate;
        const state=structuredClone(current);
        state.draft.rows[0].status='saved';
        Object.assign(state.run,{status:'running',phase:'preparing',index:1,results:[{rowId:state.run.rows[0].id,verification:'manual'}]});
        return {ok:true,state};
    }});
    try{
        assert.equal(app.$('resolveRun').textContent,'Запись сохранена — продолжить');
        assert(app.$('runRecovery').textContent.includes('18:00'));
        assert(app.$('runRecovery').textContent.includes('остальные записи: 1'));
        app.$('resolveRun').click();app.$('resolveRun').click();
        assert.equal(app.$('resolveRun').disabled,true);
        const sent=app.calls.filter(call=>call.action==='continue');
        assert.equal(sent.length,1);assert.equal(sent[0].checkedInBars,true);
        assert.equal(sent[0].rowId,app.state.run.rows[0].id);assert.equal(sent[0].runId,'run-recovery');
        assert(!app.calls.some(call=>call.action==='clear'));
        unblock();await pause(20);
        assert.equal(app.$('rowCount').textContent,'2');assert.equal(app.$('runProgress').value,1);
        assert.equal(app.$('resolveRun').hidden,true);assert.equal(app.$('stop').hidden,false);
        assert.equal(app.state.draft.rows[0].status,'saved');
        assert.equal(app.state.draft.rows[1].diary,'Учебный дневник 1');
    }finally{unblock();app.dom.window.close();}
});

test('последняя неопределённая запись предлагает завершение, а прерванная очередь — продолжение остатка',async()=>{
    const last=await setup({state:recoveryState(1)});
    assert.equal(last.$('resolveRun').textContent,'Запись сохранена — завершить');
    assert(last.$('runRecovery').textContent.includes('последняя запись'));last.dom.window.close();
    const state=recoveryState();
    Object.assign(state.run,{status:'interrupted',phase:'confirmed',results:[{rowId:state.run.rows[0].id,verification:'manual'}]});
    state.draft.rows[0].status='saved';
    const resumed=await setup({state});
    assert.equal(resumed.$('resolveRun').textContent,'Продолжить оставшиеся записи');
    resumed.$('resolveRun').click();await pause(20);
    assert.equal(resumed.calls.find(call=>call.action==='continue').checkedInBars,false);
    assert(!resumed.calls.some(call=>call.action==='clear'));resumed.dom.window.close();
});

test('ошибка продолжения оставляет черновики и кнопку повторного продолжения',async()=>{
    const app=await setup({state:recoveryState(),continueResult:async()=>({ok:false,error:'Откройте пациента этой очереди'})});
    try{
        app.$('resolveRun').click();await pause(20);
        assert.equal(app.$('resolveRun').disabled,false);assert.equal(app.$('resolveRun').hidden,false);
        assert.equal(app.$('rowCount').textContent,'2');assert.equal(app.state.run.results.length,0);
        assert(app.$('message').textContent.includes('Откройте пациента'));
        assert(!app.calls.some(call=>call.action==='clear'));
    }finally{app.dom.window.close();}
});
test('создание заболевания и двух вариантов сохраняет три отдельных текста',async()=>{
    const app=await setup();app.$('manageTemplates').click();app.$('newProfile').click();
    app.input('profileName','Учебное заболевание');app.input('templateDiary','Первый текст');app.input('templateExamination','Первое обследование');app.input('templateTreatment','Первый план');
    app.$('newVariant').click();app.input('templateDiary','Второй текст');app.input('templateExamination','Второе обследование');app.input('templateTreatment','Второй план');
    app.$('saveTemplates').click();await pause(20);
    assert.equal(app.library.profiles[0].variants.length,2);
    assert.equal(app.library.profiles[0].variants[0].treatment,'Первый план');
    assert.equal(app.library.profiles[0].variants[1].examination,'Второе обследование');app.dom.window.close();
});
test('пояснения в показателях и будущая дата проходят подтверждение и отправку',async()=>{
    const app=await setup();app.input('diary','Учебный текст');
    app.input('pressure','120/80 мм рт. ст.');app.input('pulse','80-120 + ЭКС');
    app.input('temperature','36.6');app.input('respiration','16; SpO2 98% на воздухе');app.input('date','2099-01-01');
    app.$('reviewed').click();
    assert.equal(app.$('errors').hidden,true);assert.equal(app.$('reviewed').checked,true);
    app.$('fillOnly').click();await pause(20);
    const sent=app.calls.find(call=>call.action==='start');
    assert(sent);assert.equal(sent.rows[0].vitals.respiration,'16; SpO2 98% на воздухе');
    assert.equal(sent.rows[0].vitals.temperature,'36.6');
    assert.equal(app.win.document.querySelector('.inline-error'),null);app.dom.window.close();
});

test('карточка определяется автоматически, пациент находится в шапке без версии и кнопки подключения',async()=>{
    const app=await setup();
    assert(app.calls.some(call=>call.action==='connect'));
    assert.equal(app.$('connect'),null);
    assert(app.$('patientName').closest('header'));
    assert.equal(app.$('patientName').textContent,'Учебный пациент');
    assert.equal(app.win.document.querySelector('header .version'),null);
    assert.equal(app.$('manageTemplates').textContent,'Шаблоны дневников');
    app.dom.window.close();
});

test('при недоступной карточке старый пациент не показывается как текущий',async()=>{
    const app=await setup({failConnect:true});
    assert.equal(app.$('patientName').textContent,'Карточка не найдена');
    assert.equal(app.$('fillOnly').disabled,true);assert.equal(app.$('sendAll').disabled,true);
    assert(app.$('message').textContent.includes('Карточка закрыта'));app.dom.window.close();
});

test('переключение источника сохраняет старый черновик до подключения другого пациента',async()=>{
    const otherState={patient:{key:'second',fullName:'Второй учебный пациент',birth:'02.02.1980',history:'ДЕМО-2'},draft:null,run:null};
    const app=await setup({otherState});app.input('diary','Незавершённый текст первого пациента');
    assert.equal((await app.source(2)).ok,true);
    const oldSave=app.calls.findIndex(call=>call.action==='draft'&&call.draft.rows[0].diary==='Незавершённый текст первого пациента');
    const loadNew=app.calls.findIndex(call=>call.action==='load'&&call.tabId===2);
    assert(oldSave>=0&&oldSave<loadNew);assert.equal(app.calls[oldSave].tabId,1);
    assert.equal(app.$('patientName').textContent,'Второй учебный пациент');
    assert.equal(app.$('diary').value,'');assert(app.win.location.search.includes('tab=2'));app.dom.window.close();
});

test('запоздалый статус прежней вкладки не подменяет нового пациента и его черновик',async()=>{
    let release;const statusGate=new Promise(resolve=>{release=resolve;});
    const oldRow={...C.createRow(),diary:'Текст первого пациента'};
    const state={patient:{key:'first',fullName:'Первый'},draft:{rows:[oldRow],defaults:{...C.DEFAULTS},hourStep:4,profileId:''},run:{id:'old',status:'done',updatedAt:1,rows:[oldRow],results:[]}};
    const otherState={patient:{key:'second',fullName:'Второй'},draft:null,run:null};
    const app=await setup({state,otherState,statusGate});const pending=app.poll();
    await app.source(2);release();await pending;
    assert.equal(app.$('patientName').textContent,'Второй');assert.equal(app.$('diary').value,'');app.dom.window.close();
});

test('экспорт журнала содержит этапы, но исключает пациента и тексты очереди',async()=>{
    const row={...C.createRow(),diary:'Конфиденциальный учебный текст'};
    const trace=[{time:'2026-09-07T06:00:00Z',row:1,stage:'Готовность приёма не подтверждена',caseReady:false}];
    const state={patient:{key:'private-key',fullName:'Не экспортировать имя',history:'private-history'},draft:{rows:[row],defaults:{...C.DEFAULTS},profileId:'',hourStep:4},run:{id:'run',status:'failed',phase:'preparing',code:'editor_loading',trace,rows:[row],results:[]}};
    const app=await setup({state});let content;
    app.win.Blob=class{constructor(parts){this.text=parts.join('');}};
    app.win.URL.createObjectURL=blob=>{content=blob.text;return 'blob:test';};app.win.URL.revokeObjectURL=()=>{};
    app.win.HTMLAnchorElement.prototype.click=function(){};
    assert.equal(app.$('runDiagnostics').hidden,false);
    assert(app.$('runLog').textContent.includes('Готовность приёма'));
    app.$('downloadRunLog').click();
    assert.deepEqual(JSON.parse(content).events,trace);
    for(const value of ['Конфиденциальный','Не экспортировать','private-key','private-history'])assert(!content.includes(value));
    app.dom.window.close();
});
test('демонстрационная запись не допускает подтверждения и заполнения',async()=>{
    const app=await setup();app.$('openSettings').click();app.$('addDemo').click();await pause(20);
    assert.equal(app.$('reviewed').disabled,true);assert.equal(app.$('fillOnly').disabled,true);
    assert.equal(app.$('rowBadge').textContent,'Демонстрация');app.dom.window.close();
});
test('название заболевания не интерпретируется как HTML',async()=>{
    const library={type:'fillbars-card-templates',version:1,profiles:[{id:'x',name:'<img src=x onerror=alert(1)>',variants:[]}]};
    const app=await setup({library});app.$('manageTemplates').click();
    assert.equal(app.$('templateList').querySelector('img'),null);
    assert(app.$('templateList').textContent.includes('<img'));app.dom.window.close();
});

test('смена варианта в середине списка не повторяет ни предыдущий, ни следующий дневник',async()=>{
    const profile={id:'p',name:'Учебное заболевание',variants:['А','Б','В'].map((diary,i)=>({id:'v'+i,title:diary,diary,examination:'-',treatment:'-'}))};
    const rows=['А','В','Б'].map((diary,i)=>({...C.createRow({date:'2026-09-01',time:'0'+(8+i)+':00'}),diary,examination:'-',treatment:'-',profileId:'p'}));
    const state={patient:{key:'test'},draft:{rows,defaults:{...C.DEFAULTS},profileId:'p',hourStep:4},run:null};
    const app=await setup({state,library:{...C.emptyLibrary(),profiles:[profile]}});
    app.win.Math.random=()=>0;
    app.$('rowList').children[1].click();app.$('anotherVariant').click();
    assert.equal(app.$('diary').value,'В');app.dom.window.close();
});

test('свободные дневники копируются, а выбор шаблона заменяет только тексты выбранной записи',async()=>{
    const profile={id:'p',name:'Тестовый шаблон',variants:[{id:'v',title:'Вариант',diary:'Из шаблона',examination:'Обследование из шаблона',treatment:'Лечение из шаблона'}]};
    const app=await setup({library:{...C.emptyLibrary(),profiles:[profile]}});
    try{
        app.input('time','18:00');app.input('diary','Первый ручной дневник');app.input('examination','');app.input('treatment','Мой план');app.input('pulse','60 + ЭКС');
        app.$('reviewed').click();app.$('addTime').click();
        assert.equal(app.$('time').value,'22:00');assert.equal(app.$('diary').value,'Первый ручной дневник');
        assert.equal(app.$('examination').value,'');assert.equal(app.$('treatment').value,'Мой план');
        assert.equal(app.$('pulse').value,'60 + ЭКС');assert.equal(app.$('reviewed').checked,false);
        app.$('profile').value='p';app.$('profile').dispatchEvent(new app.win.Event('change'));
        assert.equal(app.$('diary').value,'Из шаблона');assert.equal(app.$('pulse').value,'60 + ЭКС');
        app.$('rowList').querySelectorAll('button')[0].click();
        assert.equal(app.$('diary').value,'Первый ручной дневник');assert.equal(app.$('treatment').value,'Мой план');assert.equal(app.$('profile').value,'');
        app.$('addTime').click();
        assert.equal(app.$('time').value,'02:00');assert.equal(app.$('date').value,'2026-09-02');
        assert.equal(app.$('diary').value,'Первый ручной дневник');
    }finally{app.dom.window.close();}
});

test('настройки находятся в отдельном окне, сохраняются и применяются к новой очереди',async()=>{
    const app=await setup();
    try{
        app.input('diary','Не менять этот текст');
        assert.equal(app.$('spreadTemperature').closest('dialog').id,'settingsDialog');
        assert.equal(app.win.document.querySelector('.editor .demo-settings'),null);
        app.$('openSettings').click();assert.equal(app.$('settingsHourStep').value,'4');
        app.input('settingsTemperature','37,1');app.input('settingsPulse','60 + ЭКС');app.input('spreadSystolic','12');
        app.$('saveSettings').click();await pause(20);
        assert.equal(app.settings.defaults.temperature,'37,1');assert.equal(app.settings.spread.systolic,12);
        assert.equal(app.$('temperature').value,'36,6');assert.equal(app.$('diary').value,'Не менять этот текст');
        app.$('openSettings').click();assert.equal(app.$('settingsTemperature').value,'37,1');app.$('closeSettings').click();
        const fresh=await setup({settings:app.settings,state:{patient:{key:'test'},draft:null,run:null}});
        try{assert.equal(fresh.$('temperature').value,'37,1');assert.equal(fresh.$('pulse').value,'60 + ЭКС');assert.equal(fresh.$('hourStep').value,'4');}
        finally{fresh.dom.window.close();}
    }finally{app.dom.window.close();}
});

test('род определяется автоматически, ручной выбор не меняет другие записи и не переносится другому пациенту',async()=>{
    const profile={id:'p',name:'С родом',genderPairs:[{id:'1',male:'Больной',female:'Больная'}],variants:[{id:'v',title:'Вариант',diary:'{{род:1}} осмотрен(а)',examination:'',treatment:''}]};
    const row=C.createRow(),otherState={patient:{key:'other',fullName:'Учебный Пётр Петрович'},draft:null,run:null};
    const state={patient:{key:'first',fullName:'Учебная Анна Петровна'},draft:{rows:[row],defaults:{...C.DEFAULTS},hourStep:4},run:null};
    const app=await setup({state,otherState,library:{...C.emptyLibrary(),profiles:[profile]}});
    try{
        assert(app.$('textGender').options[0].textContent.includes('женский'));
        app.$('profile').value='p';app.$('profile').dispatchEvent(new app.win.Event('change'));
        assert.equal(app.$('diary').value,'Больная осмотрен(а)');
        app.$('addTime').click();
        app.$('textGender').value='male';app.$('textGender').dispatchEvent(new app.win.Event('change'));
        assert.equal(app.$('diary').value,'Больная осмотрен(а)');
        app.$('anotherVariant').click();assert.equal(app.$('diary').value,'Больной осмотрен(а)');
        app.$('rowList').querySelectorAll('button')[0].click();assert.equal(app.$('diary').value,'Больная осмотрен(а)');
        await app.source(2);assert.equal(app.$('textGender').value,'auto');assert(app.$('textGender').options[0].textContent.includes('мужской'));
    }finally{app.dom.window.close();}
});

test('неопределённый род не заменяет ручной текст незаполненной вставкой',async()=>{
    const profile={id:'p',name:'С родом',genderPairs:[{id:'1',male:'Больной',female:'Больная'}],variants:[{id:'v',title:'Вариант',diary:'{{род:1}}',examination:'',treatment:''}]};
    const app=await setup({library:{...C.emptyLibrary(),profiles:[profile]}});
    try{
        app.input('diary','Мой текст');app.$('profile').value='p';app.$('profile').dispatchEvent(new app.win.Event('change'));
        assert.equal(app.$('diary').value,'Мой текст');assert.equal(app.$('profile').value,'');
        assert(app.$('message').textContent.includes('Выберите мужской'));
    }finally{app.dom.window.close();}
});

test('редактор пар сохраняет обычный текст без кнопки вставки и автоматически применяет формы',async()=>{
    const app=await setup();
    try{
        app.$('manageTemplates').click();app.$('newProfile').click();app.input('profileName','Согласование');
        app.input('templateDiary','Состояние больной тяжёлое.');
        app.$('addGenderPair').click();
        const inputs=app.$('genderPairs').querySelectorAll('input');
        inputs[0].value='больного';inputs[0].dispatchEvent(new app.win.Event('input',{bubbles:true}));
        inputs[1].value='больной';inputs[1].dispatchEvent(new app.win.Event('input',{bubbles:true}));
        assert.equal(app.$('genderPairs').querySelector('[aria-label="Вставить пару 1"]'),null);
        assert.equal(app.$('genderPairs').querySelector('code'),null);
        assert.equal(app.$('templateDiary').value,'Состояние больной тяжёлое.');
        app.$('saveTemplates').click();await pause(20);
        assert.equal(app.library.profiles[0].genderPairs[0].male,'больного');
        assert.equal(app.library.profiles[0].variants[0].diary,'Состояние больной тяжёлое.');
        app.$('textGender').value='male';app.$('textGender').dispatchEvent(new app.win.Event('change'));
        app.$('profile').value=app.library.profiles[0].id;app.$('profile').dispatchEvent(new app.win.Event('change'));
        assert.equal(app.$('diary').value,'Состояние больного тяжёлое.');
        assert.equal(app.library.profiles[0].variants[0].diary,'Состояние больной тяжёлое.');
        app.$('manageTemplates').click();app.$('genderPairs').querySelector('[aria-label="Удалить пару 1"]').click();
        assert.equal(app.$('genderPairs').children.length,0);assert.equal(app.$('templateDiary').value,'Состояние больной тяжёлое.');
    }finally{app.dom.window.close();}
});

test('старый шаблон открывается в редакторе обычными словами без служебного обозначения',async()=>{
    const profile={id:'old',name:'Старый',genderPairs:[{id:'1',male:'больного',female:'больной'}],variants:[{id:'v',title:'Первый',diary:'Состояние {{род:1}} тяжёлое.',examination:'',treatment:''}]};
    const app=await setup({library:{...C.emptyLibrary(),version:2,profiles:[profile]}});
    try{
        app.$('manageTemplates').click();
        assert.equal(app.$('templateDiary').value,'Состояние больного тяжёлое.');
        assert(!app.$('genderPairs').textContent.includes('{{род:'));
        assert(![...app.$('genderPairs').querySelectorAll('button')].some(button=>button.textContent.includes('Вставить')));
    }finally{app.dom.window.close();}
});
