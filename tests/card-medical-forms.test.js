const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
require('../office-export');require('../medical-templates');require('../histology-template');require('../commission-templates');require('../skt-template');require('../consent-templates');require('../extra-templates');require('../followup-templates');require('../medical-print-layouts');require('../operation-catalog');
const forms=require('../medical-forms');
const templates=globalThis.__FillBARSMedicalTemplates__;
const synthetic={fullName:'Тестов Тест Тестович',surname:'Тестов',firstName:'Тест',patronymic:'Тестович',birthDate:'02.03.1980',documentDate:'24.09.2026',medicalOrganization:'ТЕСТОВАЯ МЕДИЦИНСКАЯ ОРГАНИЗАЦИЯ',registeredAddress:'Тестовый город, улица Примерная, дом 1',passport:'ТЕСТОВЫЙ ДОКУМЕНТ',doctorName:'Тестов Т.Т.',department:'Тестовое отделение',diagnosis:'Тестовый текст для проверки оформления',icdCode:'TEST',policyNumber:'0000000000000000',snils:'000-000-000 00',destination:'Тестовое учреждение'};
function unzipStored(bytes){const b=Buffer.from(bytes), result={};let at=0;while(b.readUInt32LE(at)===0x04034b50){const size=b.readUInt32LE(at+18),n=b.readUInt16LE(at+26),extra=b.readUInt16LE(at+28);const name=b.subarray(at+30,at+30+n).toString();const start=at+30+n+extra;result[name]=b.subarray(start,start+size);at=start+size;}return result;}
test('twenty genuine Office packages export, preserve untouched parts and escape XML',()=>{
 const out=path.join(root,'tests/artifacts/medical');fs.mkdirSync(out,{recursive:true});
 assert.equal(Object.keys(templates).length,20);
 for(const [kind,t]of Object.entries(templates)){
  const values={...synthetic};for(const key of Object.keys(t.checkboxes||{}))values[key]='□';
  const bytes=forms.createFile(t,values), parts=unzipStored(bytes);
  assert(parts['[Content_Types].xml']);
  for(const entry of t.entries){
   const original=Buffer.from(entry.data,'base64');
   if(!original.toString().includes('{{'))assert.deepEqual(parts[entry.name],original,`${kind}/${entry.name}`);
   if(/\.(xml|rels)$/.test(entry.name)){const text=parts[entry.name].toString();assert(!text.includes('{{'),`${kind}/${entry.name}`);const doc=new JSDOM(text,{contentType:'application/xml'});assert.equal(doc.window.document.querySelectorAll('[TargetMode="External"]').length,0,`${kind}/${entry.name}`);doc.window.close();}
  }
  fs.writeFileSync(path.join(out,`${kind}.${t.extension}`),bytes);
 }
 const t=templates.military, values={...synthetic,fullName:'Тест < & > "'};
 assert(unzipStored(forms.createFile(t,values))['word/document.xml'].toString().includes('Тест &lt; &amp; &gt; &quot;'));
});
test('consent packages fill only demographics and keep declaration and signature fields untouched',()=>{
 for(const kind of ['operationConsent','anesthesiaConsent']){
  const template=templates[kind];
  const xml=unzipStored(forms.createFile(template,{...synthetic,birthYear:'1980',address:synthetic.registeredAddress,operationName:'Тестовая операция'}))['word/document.xml'].toString();
  assert(xml.includes('Тестов Тест Тестович'));
  assert(xml.includes('1980'));
  assert(xml.includes('Тестовое отделение'));
  assert(!xml.includes('{{'));
  assert(xml.includes('Подпись')||xml.includes('подпись'));
  assert(!template.fields.includes('signature'));
 }
});
test('operation consent uses source-derived Word layout for preview and print',()=>{
 const html=fs.readFileSync(path.join(root,'medical-forms.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://extension.test/medical-forms.html?template=operationConsent&payload=fillbars-medical-operation-test',runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.localStorage.setItem('fillbars-medical-operation-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{...synthetic,birthDate:'1980-03-02'}}));
 for(const f of ['office-export.js','medical-templates.js','skt-template.js','consent-templates.js','extra-templates.js','followup-templates.js','medical-print-layouts.js','operation-catalog.js','medical-forms.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 const frame=w.document.querySelector('iframe.source-preview-frame');
 assert(frame);assert.equal(w.__FillBARSMedicalPrintLayouts__.operationConsent.pages,2);
 assert(frame.srcdoc.includes(synthetic.fullName));
 assert(frame.srcdoc.includes('1980'));
 assert(!frame.srcdoc.includes('{{fullName}}'));
 assert.equal(w.document.querySelectorAll('.source-print-page').length,0);
 dom.window.close();
});
test('new medical forms preserve source pages, scrub example data, and leave clinical judgments manual',()=>{
 const expected={workInjury315:1,workInjury316:1,epidemicInvestigation:8};
 for(const [kind,pages] of Object.entries(expected)){
  const layout=globalThis.__FillBARSMedicalPrintLayouts__[kind];
  assert.equal(layout.pages,pages);assert(layout.html.includes('WordSection1'));
  assert(!/\b(?:src|href)=["'](?:https?:|file:)/i.test(layout.html));
 }
 const catheter=templates.centralCatheter;
 const xml=unzipStored(forms.createFile(catheter,{...synthetic,historyNumber:'SYNTHETIC-123'}))['word/document.xml'].toString();
 assert(xml.includes('SYNTHETIC-123'));
 assert(!xml.includes('1473\\00463'));
 assert(!xml.includes('2025_ г.'));
 for(const kind of ['workInjury315','workInjury316']){
  const t=templates[kind];
  assert(t.fields.includes('injurySeverity'));
  const body=unzipStored(forms.createFile(t,{...synthetic,injurySeverity:''}))['word/document.xml'].toString();
  assert(!body.includes('{{'));assert(!body.includes('тяжелой степени'));
 }
});
test('CT referral keeps one blank source form, fills BARS fields and leaves clinical choices blank',()=>{
 const t=templates.skt;
 assert(t.fields.includes('historyNumber'));assert(t.fields.includes('studyType'));
 const xml=unzipStored(forms.createFile(t,{...synthetic,historyNumber:'123/456',studyType:'',clinicalInfo:''}))['word/document.xml'].toString();
 assert.equal((xml.match(/Приложение № 1/g)||[]).length,1);
 assert(xml.includes('123/456'));
 assert(xml.includes('Тестов Тест Тестович'));
 assert(!xml.includes('{{'));
});
test('Excel retains formulas, validation formulas, styles and numeric dates',()=>{
 const t=structuredClone(templates.tmk),sheet=t.entries.find(e=>e.name==='xl/worksheets/sheet1.xml');
 let xml=Buffer.from(sheet.data,'base64').toString();
 // Add a synthetic formula to prove we do not roundtrip the workbook through a values-only model.
 const prefix=xml.match(/<([\w]+:)?worksheet/)[1]||'';
 xml=xml.replace(`</${prefix}sheetData>`,`<${prefix}row r="99"><${prefix}c r="C99"><${prefix}f>SUM(C1:C2)</${prefix}f><${prefix}v>7</${prefix}v></${prefix}c></${prefix}row></${prefix}sheetData>`);
 sheet.data=Buffer.from(xml).toString('base64');
 const output=unzipStored(forms.createFile(t,synthetic))['xl/worksheets/sheet1.xml'].toString();
 assert(output.includes('SUM(C1:C2)'));assert(output.includes('>7<'));
 const doc=new JSDOM(output,{contentType:'application/xml'}).window.document;
 const date=Array.from(doc.getElementsByTagNameNS('*','c')).find(c=>c.getAttribute('r')==='C9');
 assert.notEqual(date.getAttribute('t'),'inlineStr');assert.equal(date.textContent,String(forms.excelDate(synthetic.documentDate)));
 assert.equal(forms.excelDate('31.02.2026'),null);
});
function popupFunction(name){const source=fs.readFileSync(path.join(root,'popup.js'),'utf8');const start=source.indexOf(`async function ${name}`)>=0?source.indexOf(`async function ${name}`):source.indexOf(`function ${name}`);let end=source.indexOf('\nfunction ',start+1);if(end<0)end=source.length;return source.slice(start,end);}
async function readPatient({wrong=false,equal=true,blood=false,discharge='25.09.2026 12:15'}={}){
 const dom=new JSDOM(`<div class="hosp_history_new"></div><div class="persmedcard_edit"><table name="SURNAME"><input value="Тестов"></table><input name="FIRSTNAME" value="Тест"><input name="LASTNAME" value="Тестович"><input name="BIRTHDATE" value="02.03.1980"><input name="SNILS" value="000"><span name="PERSDOC_NUMB">TEST-PASSPORT</span><span name="REAL_ADDRS_ADR_FULL">ACTUAL</span><span name="REG_ADDRS_ADR_FULL">REGISTERED</span><span name="ADDR_REAL_EQ_REG"><input type="checkbox" ${equal?'checked':''}></span></div>`);
 dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});
 const vars={AGENT:'A',PERSMEDCARD:'P',HH_ID:'H'};
 const captions={PAT_FIO:'Тестов Тест Тестович',PAT_BDATE:'02.03.1980',HH_PREF_NUMB:'ХО2_123456-123/123',MKB_CLINIC:'TEST',MKB_CLINIC_EXACT:'Синтетический диагноз',MKB_FINAL_EXACT:'Проверенный заключительный диагноз',HH_DATE_IN:'01.09.2026 09:30',HH_DATE_OUT:discharge,PLAN_DATE_OUT:'30.09.2026'};
 dom.window.document.querySelector('.hosp_history_new').form={page:{getVar:n=>vars[n],getCaption:n=>captions[n]||''}};
 dom.window.document.querySelector('.persmedcard_edit').form={page:{getVar:n=>n==='AGENT'?(wrong?'OTHER':'A'):''}};
 let closed=0;
 const context={document:dom.window.document,window:dom.window,console,setTimeout,clearTimeout};
 if(blood){context.openWindow=(options)=>{const page={setVar:(n,v)=>assert.equal(v,vars[n]),getVar:n=>({BLOODGROUPE:'A(II)',RHESUS:0}[n]),getCaption:()=>'',executeServerAction:(n,ok)=>ok()};queueMicrotask(()=>options.onshow.call({page}));return page;};context.closeWindow=()=>closed++;}
 const result=await vm.runInNewContext(popupFunction('readPatientDataFromBarsPage')+';readPatientDataFromBarsPage()',context);
 dom.window.close();return {result,closed};
}
test('patient-card passport and separate/same addresses are read only for matching identity',async()=>{
 let {result}=await readPatient();assert.equal(result.passportNumber,'TEST-PASSPORT');assert.equal(result.registeredAddress,'ACTUAL');
 ({result}=await readPatient({equal:false}));assert.equal(result.registeredAddress,'REGISTERED');
 ({result}=await readPatient({wrong:true}));assert.equal(result.passportNumber,undefined);assert(result.patientDataWarning);
});
test('blood retrieval uses exact history and closes temporary form; numeric Rh zero survives',async()=>{
 const {result,closed}=await readPatient({blood:true});assert.equal(result.bloodGroupAbo,'A(II)');assert.equal(result.bloodGroupRh,'0');assert.equal(closed,1);
});
test('history diagnosis is available for medical forms',async()=>{
 const {result}=await readPatient();assert.equal(result.diagnosis,'Синтетический диагноз');assert.equal(result.finalDiagnosis,'Проверенный заключительный диагноз');
});

test('military treatment period comes from actual history dates, never planned discharge',async()=>{
 let {result}=await readPatient();assert.equal(result.startDate,'2026-09-01');assert.equal(result.endDate,'2026-09-25');
 ({result}=await readPatient({discharge:'не выписан'}));assert.equal(result.startDate,'2026-09-01');assert.equal(result.endDate,'');
 ({result}=await readPatient({discharge:'31.02.2026'}));assert.equal(result.endDate,'');
});

test('editor consumes transient payload, fills fields and renders hostile text as text',()=>{
 const html=fs.readFileSync(path.join(root,'medical-forms.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://extension.test/medical-forms.html?template=commission&payload=fillbars-medical-test',runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.localStorage.setItem('fillbars-medical-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{...synthetic,fullName:'<img src=x onerror=alert(1)>',passportNumber:'TEST-ONLY'}}));
 for(const f of ['office-export.js','medical-templates.js','skt-template.js','medical-forms.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 assert.equal(w.document.getElementById('passport').value,'TEST-ONLY');
 assert.equal(w.localStorage.getItem('fillbars-medical-test'),null);
 assert.equal(w.document.querySelectorAll('#preview img').length,0);
 const name=w.document.getElementById('fullName');name.value='Тестов';name.dispatchEvent(new w.Event('input'));
 assert(w.document.getElementById('preview').textContent.includes('Тестов'));dom.window.close();
});

test('military editor preloads treatment period and keeps both dates editable',()=>{
 const html=fs.readFileSync(path.join(root,'medical-forms.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://extension.test/medical-forms.html?template=military&payload=fillbars-medical-military-test',runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.localStorage.setItem('fillbars-medical-military-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{...synthetic,startDate:'2026-09-01',endDate:'2026-09-25'}}));
 for(const f of ['office-export.js','medical-templates.js','skt-template.js','medical-forms.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 assert.equal(w.document.getElementById('startDate').value,'01.09.2026');
 assert.equal(w.document.getElementById('endDate').value,'25.09.2026');
 assert(w.document.getElementById('preview').textContent.includes('01.09.2026'));
 assert(w.document.getElementById('preview').textContent.includes('25.09.2026'));
 w.document.getElementById('endDate').value='26.09.2026';
 w.document.getElementById('endDate').dispatchEvent(new w.Event('input'));
 assert(w.document.getElementById('preview').textContent.includes('26.09.2026'));
 dom.window.close();
});

test('CT referral editor preloads identity and keeps study decision editable',()=>{
 const html=fs.readFileSync(path.join(root,'medical-forms.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://extension.test/medical-forms.html?template=skt&payload=fillbars-medical-skt-test',runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.localStorage.setItem('fillbars-medical-skt-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{...synthetic,historyNumber:'123/456'}}));
 for(const f of ['office-export.js','medical-templates.js','skt-template.js','medical-forms.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 assert.equal(w.document.getElementById('fullName').value,synthetic.fullName);
 assert.equal(w.document.getElementById('historyNumber').value,'123/456');
 assert.equal(w.document.getElementById('studyType').value,'');
 const study=w.document.getElementById('studyType');study.value='СКТ органов грудной клетки';study.dispatchEvent(new w.Event('input'));
 assert(w.document.getElementById('preview').textContent.includes('СКТ органов грудной клетки'));
 dom.window.close();
});

test('oncology sections use dropdowns and put selected checkmarks into Word',async()=>{
 const html=fs.readFileSync(path.join(root,'medical-forms.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://extension.test/medical-forms.html?template=oncology&payload=fillbars-medical-oncology-test',runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.Blob=Blob;
 w.localStorage.setItem('fillbars-medical-oncology-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{...synthetic}}));
 for(const f of ['office-export.js','medical-templates.js','skt-template.js','medical-forms.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 assert.equal(w.document.querySelectorAll('.choice-section').length,6);
 assert.equal(w.document.querySelectorAll('.choice-section select').length,6);
 assert.equal(w.document.querySelectorAll('#fields input[type="checkbox"]').length,0);
 assert.equal(w.document.querySelector('label[for="oncology-stage"]').textContent,'16. Стадия опухолевого процесса');
 const choose=(id,key)=>{const select=w.document.getElementById(id);select.value=key;select.dispatchEvent(new w.Event('change'));};
 choose('oncology-sex','check16x0');choose('oncology-sex','check16x1');
 choose('oncology-metastases','check37x0');choose('oncology-metastases','check38x0');
 assert.equal(w.document.querySelectorAll('#oncology-metastases + small + .selected-choices .choice-chip').length,2);
 assert(w.document.getElementById('preview').textContent.includes('☑'));
 let captured;
 w.URL.createObjectURL=blob=>{captured=blob;return 'blob:test';};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){};
 w.document.getElementById('download').click();
 const parts=unzipStored(await captured.arrayBuffer());
 const document=new JSDOM(parts['word/document.xml'].toString(),{contentType:'application/xml'}).window.document;
 const words=document.documentElement.textContent;
 assert.match(words,/□.{0,10}мужской/);
 assert.match(words,/☑.{0,10}женский/);
 assert.match(words,/☑.{0,10}отдаленные лимфатич/);
 assert.match(words,/☑.{0,10}кости/);
 dom.window.close();
});

test('endoscopy consents use current article 20 and injected values are bold in Word',()=>{
 for(const kind of ['colonoscopyConsent','bronchoscopyConsent','gastroscopyConsent']){
  const xml=unzipStored(forms.createFile(templates[kind],{...synthetic,age:'46',historyNumber:'TEST-123'}))['word/document.xml'].toString();
  assert(xml.includes('323-ФЗ'));assert(xml.includes('статьёй 20'));assert(!xml.includes('5487-1'));
  assert.match(xml,/<w:rPr>[^<]*(?:<w:[^>]+>)*<w:b\s*\/?>(?:<\/w:b>)?/);
  assert(xml.includes('Тестов Тест Тестович'));
 }
 const oncology=unzipStored(forms.createFile(templates.oncology,synthetic))['word/document.xml'].toString();
 assert.match(oncology,/<w:b\s*\/>[\s\S]{0,80}Тестов/);
});

test('operation examples are editable drafts without source staff or case numbers',()=>{
 const catalog=globalThis.__FillBARSOperationCatalog__;
 assert(catalog.length>=10);
 for(const item of catalog){
  assert(item.name.length>20 && item.text.length>100);
  assert(!/Операция\s*№|Оператор\s*:|Ассистент\s*:|\d{2}\.\d{2}\.\d{2,4}/i.test(item.name+' '+item.text));
 }
 const dom=new JSDOM(fs.readFileSync(path.join(root,'medical-forms.html'),'utf8'),{url:'https://extension.test/medical-forms.html?template=operationProtocol&payload=fillbars-medical-protocol-test',runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.localStorage.setItem('fillbars-medical-protocol-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{...synthetic,historyNumber:'TEST-123'}}));
 for(const f of ['office-export.js','medical-templates.js','skt-template.js','consent-templates.js','extra-templates.js','operation-catalog.js','medical-forms.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 const select=w.document.getElementById('operationDraft');assert(select.options.length>=11);
 select.value='0';select.dispatchEvent(new w.Event('change'));
 assert.equal(w.document.getElementById('operationName').value,catalog[0].name);
 assert.equal(w.document.getElementById('operationDescription').value,catalog[0].text);
 assert.equal(w.document.getElementById('instrumentCount').value,'Посчитаны, счёт сходится.');
 assert.equal(w.document.getElementById('swabCount').value,'Посчитаны, счёт сходится.');
 assert.match(w.document.getElementById('notice').textContent,/с фактическим подсчётом/);
 const additions=JSON.parse(fs.readFileSync(path.join(root,'scripts/operation-drafts.json'),'utf8'));
 assert.equal(additions.length,6);
 for(const item of additions){
  const index=catalog.findIndex(entry=>entry.name===item.name);
  assert(index>=0,'Missing operation: '+item.name);
  select.value=String(index);select.dispatchEvent(new w.Event('change'));
  assert.equal(w.document.getElementById('operationName').value,item.name);
  assert.equal(w.document.getElementById('operationDescription').value,item.text);
  assert(w.document.querySelector('#preview').textContent.includes(item.name));
  const xml=unzipStored(forms.createFile(templates.operationProtocol,{...synthetic,operationName:item.name,operationDescription:item.text}))['word/document.xml'].toString();
  assert(xml.includes(item.name));
  for(const paragraph of item.text.split('\n'))assert(xml.includes(paragraph));
  assert(item.text.includes('[указать')||item.text.includes('[описать'));
 }
 dom.window.close();
});
test('operation material count remains editable in the Word export',()=>{
 const xml=unzipStored(forms.createFile(templates.operationProtocol,{...synthetic,instrumentCount:'Инструменты проверены',swabCount:'Салфетки проверены'}))['word/document.xml'].toString();
 assert(xml.includes('Инструменты проверены'));
 assert(xml.includes('Салфетки проверены'));
 assert(!xml.includes('{{instrumentCount}}') && !xml.includes('{{swabCount}}'));
});
test('operation description keeps editor line breaks in the editable Word file',()=>{
 const xml=unzipStored(forms.createFile(templates.operationProtocol,{...synthetic,operationDescription:'Первый этап.\nВторой этап & контроль.'}))['word/document.xml'].toString();
 assert.match(xml,/Первый этап\.<\/w:t><w:br\/><w:t xml:space="preserve">Второй этап &amp; контроль\./);
 assert(!xml.includes('{{operationDescription}}'));
});


test('057/u item 7 occurs once between items 6 and 8 in editor, preview and exported Word',()=>{
 const t=templates.referral;
 assert(t.fields.indexOf('workPlace')<t.fields.indexOf('icdCode')&&t.fields.indexOf('icdCode')<t.fields.indexOf('referralReason'));
 const preview=new JSDOM(t.preview);
 const texts=[...preview.window.document.querySelectorAll('p')].map(p=>p.textContent.trim());
 assert.equal(texts.filter(text=>text.startsWith('7.')).length,1);
 assert(texts.findIndex(text=>text.startsWith('6.'))<texts.findIndex(text=>text.startsWith('7.')));
 assert(texts.findIndex(text=>text.startsWith('7.'))<texts.findIndex(text=>text.startsWith('8.')));
 preview.window.close();
 const xml=unzipStored(forms.createFile(t,{...synthetic,icdCode:'N23',workPlace:'Тестовая работа',referralReason:'Тестовое обоснование'}))['word/document.xml'].toString();
 const word=new JSDOM(xml,{contentType:'application/xml'});
 const paragraphs=[...word.window.document.getElementsByTagName('w:p')].map(p=>p.textContent.trim());
 assert.equal(paragraphs.filter(text=>text.startsWith('7.')).length,1);
 const positions=['6.','7.','8.'].map(prefix=>paragraphs.findIndex(text=>text.startsWith(prefix)));
 assert(positions[0]>=0&&positions[0]<positions[1]&&positions[1]<positions[2]);
 assert(paragraphs[positions[1]].includes('N23'));word.window.close();
});
