'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const C=require('../diary-core');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// All storage and page responses are in memory. No browser or BARS connection.
function host(settings={}){
    const session={},local={cardSettingsV1:settings},pages=new Map([[1,'A'],[2,'B']]);
    let backend;
    const storage=data=>({
        get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>data[k]!==undefined).map(k=>[k,structuredClone(data[k])])),
        set:async entries=>Object.assign(data,structuredClone(entries)),
        remove:async key=>{delete data[key];}
    });
    const chrome={storage:{session:storage(session),local:storage(local)},
        runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>{backend=fn;}}},
        tabs:{onRemoved:{addListener(){}}},
        scripting:{executeScript:async options=>{
            if(options.files)return [];
            const id=pages.get(options.target.tabId);
            return [{frameId:0,documentId:'document-'+options.target.tabId,result:{ok:true,patient:{key:id,fullName:'Манекен '+id,birth:'01.01.1980',history:id}}}];
        }}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../diary-background.js'),'utf8'),{chrome,FillBARSCardCore:C,Map,Promise,Date,console});
    const send=message=>new Promise(resolve=>backend({namespace:'fillbars-card-v1',...message},{id:'test',url:'chrome-extension://test/diaries.html'},resolve));
    async function editor(tabId=1){
        const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../diaries.html'),'utf8'),{url:'https://extension.invalid/diaries.html?tab='+tabId,runScripts:'outside-only'});
        const w=dom.window;let source;
        w.Math.random=()=>.1;
        w.setInterval=()=>0;w.confirm=()=>true;
        w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
        w.HTMLDialogElement.prototype.close=function(){this.open=false;};
        w.chrome={runtime:{id:'test',sendMessage:send,onMessage:{addListener:fn=>{source=fn;}}}};
        w.eval(fs.readFileSync(path.join(__dirname,'../diary-core.js'),'utf8'));
        await w.eval(fs.readFileSync(path.join(__dirname,'../diaries.js'),'utf8'));
        const $=id=>w.document.getElementById(id);
        return {dom,w,$,
            input(id,value){$(id).value=value;$(id).dispatchEvent(new w.Event('input',{bubbles:true}));},
            source:id=>new Promise(resolve=>source({namespace:'fillbars-card-ui-v1',action:'source',tabId:id},{id:'test'},resolve)),
            async close(){w.dispatchEvent(new w.Event('beforeunload'));await pause(5);dom.window.close();}
        };
    }
    return {session,pages,send,editor};
}

test('закрытие сразу после правки и повторное открытие того же пациента сохраняют черновик',async()=>{
    const app=host();let ui=await app.editor();
    ui.input('diary','Текст A');ui.input('pulse','120');ui.$('addTime').click();
    await ui.close();
    ui=await app.editor();
    try{
        assert.equal(ui.$('rowCount').textContent,'2');assert.equal(ui.$('pulse').value,'120');
        assert.equal(ui.$('diary').value,'Текст A');
    }finally{await ui.close();}
});

for(const separateTabs of [false,true])test('А → Б → А сбрасывает строки, тексты, показатели и род: '+(separateTabs?'разные вкладки':'одна вкладка'),async()=>{
    const app=host();const ui=await app.editor();
    try{
        ui.input('diary','Текст A');ui.input('pulse','120');
        ui.$('textGender').value='female';ui.$('textGender').dispatchEvent(new ui.w.Event('change'));
        ui.$('addTime').click();
        if(!separateTabs)app.pages.set(1,'B');
        await ui.source(separateTabs?2:1);
        assert.equal(ui.$('patientName').textContent,'Манекен B');
        assert.equal(ui.$('rowCount').textContent,'1');assert.equal(ui.$('diary').value,'');assert.equal(ui.$('pulse').value,'80');
        assert.equal(ui.$('textGender').value,'auto');assert.equal(ui.$('reviewed').checked,false);
        ui.input('diary','Текст B');ui.input('temperature','38,5');
        if(!separateTabs)app.pages.set(1,'A');
        await ui.source(1);
        assert.equal(ui.$('patientName').textContent,'Манекен A');assert.equal(ui.$('rowCount').textContent,'1');
        assert.equal(ui.$('diary').value,'');assert.equal(ui.$('temperature').value,'36,6');assert.equal(ui.$('pulse').value,'80');
        assert.equal(JSON.stringify(app.session).includes('Текст A'),false);assert.equal(JSON.stringify(app.session).includes('Текст B'),false);
    }finally{await ui.close();}
});

test('А → Б → А в отдельных окнах не восстанавливает историю пациентов',async()=>{
    const app=host();let ui=await app.editor(1);
    ui.input('diary','Текст A');await ui.close();
    ui=await app.editor(2);assert.equal(ui.$('diary').value,'');ui.input('diary','Текст B');await ui.close();
    ui=await app.editor(1);
    try{assert.equal(ui.$('diary').value,'');assert.equal(ui.$('rowCount').textContent,'1');}
    finally{await ui.close();}
});

test('запоздавший черновик старого контекста не перезаписывает другого пациента',async()=>{
    const app=host();const a=await app.send({action:'connect',tabId:1});
    app.pages.set(1,'B');const b=await app.send({action:'connect',tabId:1});
    const result=await app.send({action:'draft',tabId:1,contextId:a.state.contextId,draft:{rows:[{diary:'Текст A'}]}});
    assert.equal(result.ok,false);assert.equal(app.session['cardSessionV1:1'].patient.key,'B');
    assert.equal(app.session['cardSessionV1:1'].contextId,b.state.contextId);assert.equal(app.session['cardSessionV1:1'].draft,null);
});

test('автоподбор первой записи, наследование правок и повторное открытие без нового подбора',async()=>{
    const app=host({autoPick:true});let ui=await app.editor();
    assert.notEqual(ui.$('pulse').value,'80');
    ui.input('pulse','120');ui.$('addTime').click();
    const pulse=ui.$('pulse').value;
    assert(Number(pulse)>=110&&Number(pulse)<=130);assert.notEqual(pulse,'120');
    await ui.close();ui=await app.editor();
    try{
        ui.$('rowList').children[1].click();assert.equal(ui.$('pulse').value,pulse);
        ui.$('openSettings').click();assert.equal(ui.$('autoPickVitals').checked,true);
        ui.$('autoPickVitals').checked=false;ui.$('saveSettings').click();await pause(10);
        ui.input('pulse','130');ui.$('addTime').click();assert.equal(ui.$('pulse').value,'130');
        // Even when an earlier row is selected, vitals come from the last row.
        ui.$('rowList').children[0].click();ui.$('addTime').click();assert.equal(ui.$('pulse').value,'130');
    }finally{await ui.close();}
});
