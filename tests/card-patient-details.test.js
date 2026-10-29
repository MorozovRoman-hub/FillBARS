const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const adapter=require('../patient-details-adapter');
const context={agentId:'agent-test',medicalCardId:'card-test'};
function fixture({empty=false,wrong=false,fail=false}={}){
 const dom=new JSDOM('<div class="persmedcard_edit"><input name="SURNAME" value="Тестов"><input name="FIRSTNAME" value="Тест"><input name="LASTNAME" value="Тестович"><input name="BIRTHDATE" value="01.01.1980"><input name="SNILS" value="TEST-SNILS"><input name="ENP" value="TEST-POLICY"></div>',{url:'http://fixture.invalid/'});
 const rows={DS_PERSDOCS:empty?[]:[{PD_TYPE:'Тест',PD_SER:'00',PD_NUMB:'TEST-NUMBER',PD_WHO:'Тестовый орган',PD_WHEN:'01.01.2000'}],DS_REAL_ADDRS:[{ADR_FULL:'ACTUAL'}],DS_REG_ADDRS:[{ADR_FULL:'REGISTERED'}],DS_POLIS_OMS:[{P_NUM:'TEST-POLICY',P_WHO:'INSURER'}]};
 const datasets=Object.fromEntries(Object.keys(rows).map(name=>[name,{data:null,setData(data){this.data=data;}}]));
 const original=Object.fromEntries(Object.entries(datasets).map(([n,ds])=>[n,ds.setData]));
 const calls=[];const page={getVar:n=>n==='AGENT'?(wrong?'wrong':context.agentId):n==='PERSMEDCARD'?context.medicalCardId:'',getDataSet:n=>datasets[n],refreshDataSet(n){calls.push(n);dom.window.setTimeout(()=>{if(!fail)datasets[n].setData(rows[n]);},2);}};
 dom.window.document.querySelector('.persmedcard_edit').form={page};
 return {dom,calls,datasets,original};
}
test('details are fetched automatically with only a history in foreground; background is disposed',async()=>{
 const main=new JSDOM('',{url:'http://fixture.invalid/'}),child=fixture();let disposed=0,opened=0;
 child.dom.window.openWindow=(options)=>{opened++;assert.equal(options.name,'Persmedcard/persmedcard_edit');assert.equal(options.vars.AGENT,context.agentId);assert.equal(options.vars.PERSMEDCARD,context.medicalCardId);};
 const result=await adapter.read({window:main.window,context,isCurrent:()=>true,loadEnvironment:async()=>({window:child.dom.window,dispose:()=>disposed++})});
 assert.equal(result.passportNumber,'TEST-NUMBER');assert.equal(result.registeredAddress,'REGISTERED');assert.equal(result.actualAddress,'ACTUAL');assert.equal(result.snils,'TEST-SNILS');assert.equal(opened,1);assert.equal(disposed,1);assert.equal(child.calls.length,4);
 for(const [n,ds]of Object.entries(child.datasets))assert.equal(ds.setData,child.original[n]);main.window.close();child.dom.window.close();
});
test('an already open same-patient card is refreshed without changing tabs or saving',async()=>{
 const f=fixture();const result=await adapter.read({window:f.dom.window,context,isCurrent:()=>true});assert.equal(result.insurer,'INSURER');assert.equal(f.calls.length,4);f.dom.window.close();
});
test('empty passport source completes instead of timing out or inventing identity',async()=>{
 const f=fixture({empty:true});const result=await adapter.read({window:f.dom.window,context,isCurrent:()=>true});assert.equal(result.passportNumber,'');assert(result.patientDataWarning);f.dom.window.close();
});
test('patient change stops read and restores temporary dataset observers',async()=>{
 const f=fixture();let current=true;f.dom.window.setTimeout(()=>current=false,3);
 await assert.rejects(adapter.read({window:f.dom.window,context,isCurrent:()=>current}),/Пациент изменился/);
 for(const [n,ds]of Object.entries(f.datasets))assert.equal(ds.setData,f.original[n]);f.dom.window.close();
});
test('timeout disposes isolated context and does not retry',async()=>{
 const main=new JSDOM('',{url:'http://fixture.invalid/'}),child=fixture({fail:true});let disposed=0;
 child.dom.window.openWindow=()=>{};
 await assert.rejects(adapter.read({window:main.window,context,isCurrent:()=>true,timeout:10,loadEnvironment:async()=>({window:child.dom.window,dispose:()=>disposed++})}),/паспорт, адрес и полис/);
 assert.equal(disposed,1);assert.equal(child.calls.length,4);main.window.close();child.dom.window.close();
});
