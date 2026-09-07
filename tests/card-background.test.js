'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const C=require('../diary-core');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup({session={},page={},gate}={}){
    const local={},calls=[],requests=[];let listener;
    const storage=data=>({get:async keys=>{const names=Array.isArray(keys)?keys:[keys];return Object.fromEntries(names.filter(k=>data[k]!==undefined).map(k=>[k,structuredClone(data[k])]));},set:async entries=>Object.assign(data,structuredClone(entries)),remove:async key=>{delete data[key];}});
    const patient={fullName:'Учебный',birth:'01.01.1980',history:'ДЕМО-1',key:'key1'};
    const chrome={storage:{session:storage(session),local:storage(local)},runtime:{id:'test',getURL:name=>'chrome-extension://test/'+name,onMessage:{addListener:fn=>{listener=fn;}}},tabs:{onRemoved:{addListener(){}}},scripting:{executeScript:async options=>{
        if(options.files)return [];
        const request=options.args?.[0]||{action:'probe'};calls.push(request.action);requests.push(structuredClone(request));
        if(request.action==='prepare'&&gate)await gate;
        const configured=page[request.action];
        const result=typeof configured==='function'?await configured(request):configured||({probe:{ok:true,patient},prepare:{ok:true,prepared:true},save:{ok:true,saved:true,verified:true,recordId:'r'+calls.length},release:{ok:true}})[request.action];
        return [{frameId:0,documentId:'document-1',result}];
    }}};
    const context=vm.createContext({chrome,FillBARSCardCore:C,Map,Promise,Date,console});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../diary-background.js'),'utf8'),context);
    const send=(action,data={},sender={id:'test',url:'chrome-extension://test/diaries.html'})=>new Promise(resolve=>listener({namespace:'fillbars-card-v1',tabId:1,action,...data},sender,resolve));
    return {send,session,calls,requests,patient};
}
function validRow(time='08:00'){
    const row=C.createRow({date:'2026-09-01',time});row.diary='Учебный дневник';row.reviewed=true;return row;
}
async function finished(app){
    for(let i=0;i<100;i++){const state=app.session['cardSessionV1:1'];if(state?.run&&state.run.status!=='running')return state;await pause(3);}
    throw new Error('Очередь не закончилась');
}
test('фоновая очередь сохраняет две записи, фиксирует квитанции и блокирует повтор по ID',async()=>{
    const app=setup();await app.send('connect');
    const rows=[validRow(),validRow('09:00')];
    await app.send('draft',{draft:{rows}});
    assert.equal((await app.send('start',{rows})).ok,true);
    const state=await finished(app);
    assert.equal(state.run.status,'done');assert.equal(state.run.results.length,2);assert.equal(app.calls.filter(c=>c==='save').length,2);
    assert(state.draft.rows.every(row=>row.status==='saved'));
    assert.equal((await app.send('start',{rows})).ok,false);
});
test('fillOnly никогда не вызывает сохранение',async()=>{
    const app=setup();await app.send('connect');const rows=[validRow()];
    await app.send('draft',{draft:{rows}});await app.send('start',{rows,fillOnly:true});
    assert.equal((await finished(app)).run.status,'filled');assert(!app.calls.includes('save'));
});
test('серверная неопределённость останавливает остаток очереди и запрещает перезапуск',async()=>{
    const app=setup({page:{save:{ok:false,code:'save_uncertain',message:'Неопределённый результат'}}});
    await app.send('connect');const rows=[validRow(),validRow('09:00')];
    await app.send('draft',{draft:{rows}});await app.send('start',{rows});
    assert.equal((await finished(app)).run.status,'uncertain');
    assert.equal(app.calls.filter(c=>c==='prepare').length,1);
    assert.equal((await app.send('start',{rows})).ok,false);
    assert.equal((await app.send('clear')).ok,false);
    assert.equal((await app.send('clear',{checkedInBars:true})).ok,true);
});
test('перезапуск worker на этапе сохранения не повторяет запрос',async()=>{
    const row=validRow();
    const session={'cardSessionV1:1':{patient:{key:'key1'},binding:{tabId:1,documentId:'old'},draft:{rows:[row]},run:{id:'old',status:'running',phase:'saving',rows:[row]}}};
    const app=setup({session});
    const response=await app.send('load');
    assert.equal(response.state.run.status,'uncertain');assert.equal(app.calls.length,0);
});
test('остановка во время подготовки не отправляет сохранение',async()=>{
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const app=setup({gate});await app.send('connect');const rows=[validRow()];
    await app.send('draft',{draft:{rows}});await app.send('start',{rows});
    await app.send('stop');release();
    assert.equal((await finished(app)).run.status,'stopped');assert(!app.calls.includes('save'));
});
test('demo и неподтверждённые записи отклоняются фоновым обработчиком, а не только UI',async()=>{
    const app=setup();await app.send('connect');const row=validRow();row.demo=true;
    assert.equal((await app.send('start',{rows:[row]})).ok,false);
    row.demo=false;row.reviewed=false;
    assert.equal((await app.send('start',{rows:[row]})).ok,false);assert(!app.calls.includes('save'));
});
test('посторонняя страница не может прислать команду отправки',async()=>{
    const app=setup();const response=await app.send('start',{rows:[validRow()]},{id:'test',url:'http://fixture.invalid'});
    assert.equal(response.ok,false);assert.equal(app.calls.length,0);
});
test('черновик до первого подключения не теряется',async()=>{
    const app=setup();const rows=[validRow()];await app.send('draft',{draft:{rows}});
    const response=await app.send('connect');assert.equal(response.state.draft.rows[0].diary,'Учебный дневник');
});

test('после отказа до сохранения новая очередь освобождает старую подготовку',async()=>{
    const page={save:{ok:false,code:'save_disabled',message:'Кнопка недоступна'}};
    const app=setup({page});await app.send('connect');const rows=[validRow()];
    await app.send('draft',{draft:{rows}});await app.send('start',{rows});
    assert.equal((await finished(app)).run.status,'failed');
    page.save={ok:true,saved:true,verified:true,recordId:'retry-record'};
    const before=app.calls.length;
    assert.equal((await app.send('start',{rows})).ok,true);
    assert.equal((await finished(app)).run.status,'done');
    assert.deepEqual(app.calls.slice(before),['probe','release','prepare','save']);
});

test('причина отказа и журнал этапов сохраняются для просмотра после закрытия окна',async()=>{
    const app=setup({page:{prepare:{ok:false,code:'editor_loading',message:'Реквизиты ещё не загружены',trace:[{time:'2026-09-07T06:00:00Z',stage:'Ожидание загрузки приёма',serviceReady:false}]}}});
    await app.send('connect');await app.send('start',{rows:[validRow()]});
    const state=await finished(app);
    assert.equal(state.run.code,'editor_loading');assert.equal(state.run.trace[0].row,1);
    assert.equal((await app.send('load')).state.run.trace[0].stage,'Ожидание загрузки приёма');
});

async function uncertainQueue(app, rows=[validRow('18:00'),validRow('22:00')]){
    await app.send('connect');await app.send('draft',{draft:{rows}});
    await app.send('start',{rows});const state=await finished(app);
    assert.equal(state.run.status,'uncertain');
    return {rows,runId:state.run.id,rowId:rows[0].id,checkedInBars:true};
}

test('настройки сохраняются отдельно от черновика и возвращаются после открытия окна',async()=>{
    const app=setup();await app.send('connect');const rows=[validRow()];await app.send('draft',{draft:{rows}});
    const settings=C.cleanSettings({defaults:{pulse:'60 + ЭКС'},spread:{systolic:12}});
    assert.equal((await app.send('saveSettings',{settings})).ok,true);
    const loaded=await app.send('load');
    assert.equal(loaded.settings.hourStep,4);assert.equal(loaded.settings.defaults.pulse,'60 + ЭКС');
    assert.equal(loaded.state.draft.rows[0].vitals.pulse,'80');
    assert.equal((await app.send('saveSettings',{settings:{spread:{systolic:21}}})).ok,false);
    assert.equal((await app.send('load')).settings.spread.systolic,12);
});

test('ручное подтверждение первого дневника продолжает второй и сохраняет оба черновика',async()=>{
    let saves=0;
    const app=setup({page:{save:()=>++saves===1?{ok:false,code:'save_uncertain'}:{ok:true,verified:true,recordId:'second'}}});
    const confirmation=await uncertainQueue(app);
    assert.equal((await app.send('continue',confirmation)).ok,true);
    const state=await finished(app);
    assert.equal(state.run.status,'done');assert.equal(saves,2);
    assert.deepEqual(app.requests.filter(r=>r.action==='save').map(r=>r.row.id),confirmation.rows.map(r=>r.id));
    assert.equal(state.draft.rows.length,2);assert(state.draft.rows.every(row=>row.status==='saved'));
    assert.equal(state.run.results[0].verification,'manual');
    assert.equal(state.run.results[1].recordId,'second');
    assert(state.run.trace.some(event=>event.stage==='Пользователь подтвердил сохранение в БАРС'));
    assert.equal((await app.send('continue',confirmation)).ok,false);
    assert.equal((await app.send('start',{rows:confirmation.rows})).ok,false);assert.equal(saves,2);
});

test('подтверждение последней записи завершает очередь без повторной отправки и очистки',async()=>{
    const app=setup({page:{save:{ok:false,code:'save_uncertain'}}});
    const confirmation=await uncertainQueue(app,[validRow()]);
    assert.equal((await app.send('continue',confirmation)).ok,true);
    const state=await finished(app);
    assert.equal(state.run.status,'done');assert.equal(state.draft.rows.length,1);
    assert.equal(state.draft.rows[0].status,'saved');assert.equal(app.calls.filter(c=>c==='save').length,1);
});

test('отсутствие подтверждения, старая очередь, другая запись и смена пациента не разрешают продолжение',async()=>{
    const page={save:{ok:false,code:'save_uncertain'}},app=setup({page});
    const confirmation=await uncertainQueue(app);
    for(const changes of [{checkedInBars:false},{runId:'stale'},{rowId:confirmation.rows[1].id}]){
        assert.equal((await app.send('continue',{...confirmation,...changes})).ok,false);
    }
    page.probe={ok:true,patient:{key:'another-patient'}};
    assert.equal((await app.send('continue',confirmation)).ok,false);
    const state=app.session['cardSessionV1:1'];
    assert.equal(state.run.results.length,0);assert(state.draft.rows.every(r=>r.status!=='saved'));
    assert.equal(app.calls.filter(c=>c==='save').length,1);
});

test('квитанция фиксируется до освобождения страницы и переживает сбой связи и перезапуск worker',async()=>{
    const page={save:{ok:false,code:'save_uncertain'}},app=setup({page});
    const confirmation=await uncertainQueue(app);
    page.release=()=>{
        const state=app.session['cardSessionV1:1'];
        assert.equal(state.run.results[0].rowId,confirmation.rowId);
        assert.equal(state.draft.rows[0].status,'saved');
        throw new Error('Страница временно недоступна');
    };
    assert.equal((await app.send('continue',confirmation)).state.run.status,'interrupted');
    const resumed=setup({session:structuredClone(app.session)});
    assert.equal((await resumed.send('continue',{...confirmation,checkedInBars:false})).ok,true);
    const state=await finished(resumed);
    assert.equal(state.run.status,'done');assert.equal(state.run.results.length,2);
    assert.deepEqual(resumed.requests.filter(r=>r.action==='save').map(r=>r.row.id),[confirmation.rows[1].id]);
    assert.equal(resumed.requests.find(r=>r.action==='release').checkedInBars,true);
});

test('прерывание между записями продолжает только остаток, не требует ложного подтверждения текущей',async()=>{
    const rows=[validRow(),validRow('09:00')];rows[0].status='saved';
    const session={'cardSessionV1:1':{patient:{key:'key1'},binding:{tabId:1,documentId:'old'},draft:{rows},run:{id:'old',status:'running',phase:'verified',index:0,rows,results:[{rowId:rows[0].id,recordId:'first'}]}}};
    const app=setup({session});
    assert.equal((await app.send('continue',{runId:'old',rowId:rows[0].id,checkedInBars:false})).ok,true);
    assert.equal((await finished(app)).run.results.length,2);
    assert.deepEqual(app.requests.filter(r=>r.action==='save').map(r=>r.row.id),[rows[1].id]);
});

test('продолжение прерванного заполнения без сохранения не превращается в отправку',async()=>{
    const rows=[validRow()];
    const session={'cardSessionV1:1':{patient:{key:'key1'},binding:{tabId:1,documentId:'old'},draft:{rows},run:{id:'old',status:'running',phase:'preparing',fillOnly:true,index:0,rows,results:[]}}};
    const app=setup({session});
    assert.equal((await app.send('continue',{runId:'old',rowId:rows[0].id})).ok,true);
    assert.equal((await finished(app)).run.status,'filled');assert(!app.calls.includes('save'));
});

test('двойное быстрое подтверждение не создаёт параллельных очередей',async()=>{
    let unblock,prepares=0,saves=0;
    const gate=new Promise(resolve=>{unblock=resolve;});
    const app=setup({page:{prepare:async()=>{if(++prepares===2)await gate;return {ok:true};},save:()=>++saves===1?{ok:false,code:'save_uncertain'}:{ok:true,verified:true}}});
    const confirmation=await uncertainQueue(app);
    const responses=await Promise.all([app.send('continue',confirmation),app.send('continue',confirmation)]);
    assert.equal(responses.filter(r=>r.ok).length,1);
    unblock();assert.equal((await finished(app)).run.results.length,2);assert.equal(saves,2);
});

test('интеграция очереди и DOM: потерянное подтверждение реального сохранения не дублирует первый дневник',async()=>{
    const {JSDOM}=require('jsdom'),Adapter=require('../diary-bars-adapter'),{buildFixture}=require('./card-fixture');
    const dom=new JSDOM('<body></body>',{url:'http://fixture.invalid/'});
    const fixture=buildFixture(dom.window,{noContextMenu:true});
    const adapter=Adapter.create({document:dom.window.document,window:dom.window,isVisible:fixture.visible,timeout:180,interval:2,settleMs:8});
    let saves=0;
    const page=Object.fromEntries(['probe','prepare','release'].map(action=>[action,request=>adapter.execute(request)]));
    page.save=async request=>{
        const result=await adapter.execute(request);assert.equal(result.ok,true,result.message);
        return ++saves===1?{ok:false,code:'save_uncertain'}:result;
    };
    try{
        const app=setup({page}),confirmation=await uncertainQueue(app);
        assert.equal((await app.send('continue',confirmation)).ok,true);
        const state=await finished(app);
        assert.equal(state.run.status,'done');assert.equal(fixture.saveClicks,2);assert.equal(fixture.saved.length,2);
        assert.deepEqual(fixture.saved.map(record=>record.fields.VISIT_TIME),['18:00','22:00']);
        assert(fixture.saved.every(record=>record.fields.S_DNEVNIK==='Учебный дневник'));
    }finally{dom.window.close();}
});
