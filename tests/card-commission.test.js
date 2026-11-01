'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
require('../office-export');require('../medical-templates');require('../commission-templates');require('../medical-print-layouts');require('../commission-print-layouts');
const templates=globalThis.__FillBARSMedicalTemplates__;
function xmlDoc(template){return new JSDOM(Buffer.from(template.entries.find(e=>e.name==='word/document.xml').data,'base64').toString(),{contentType:'application/xml'});}

test('palliative template retains one anonymous case with editable standard decision and no external Word template',()=>{
 const t=templates.palliative,dom=xmlDoc(t),text=dom.window.document.documentElement.textContent;
 assert.equal(text.split('(для оказания паллиативной помощи взрослым)').length-1,1);
 assert(text.includes('Ф.И.О.: {{fullName}}'));assert(text.includes('Решение ВК: {{commissionDecision}}'));
 assert(!/\d{3}-\d{3}-\d{3}\s?\d{2}/.test(text));assert(!/\b\d{16}\b/.test(text));
 assert(!text.includes('нуждается в паллиативной помощи'));assert(!text.includes('родственники отказываются'));
 assert.equal(t.fieldDefaults.commissionDecision,'Признать пациента нуждающимся в оказании паллиативной медицинской помощи.');
 for(const entry of t.entries.filter(e=>e.name.endsWith('.rels')))assert(!Buffer.from(entry.data,'base64').toString().includes('TargetMode="External"'));
 dom.window.close();
});

test('CEC has one portrait sheet with representation above a single conclusion',()=>{
 const t=templates.cec,dom=xmlDoc(t),d=dom.window.document,text=d.documentElement.textContent;
 assert.equal(text.split('ЗАКЛЮЧЕНИЕ КЭК').length-1,1);assert.equal(text.split('ПРЕДСТАВЛЕНИЕ НА КЭК').length-1,1);
 assert(text.indexOf('ПРЕДСТАВЛЕНИЕ НА КЭК')<text.indexOf('ЗАКЛЮЧЕНИЕ КЭК'));
 assert.equal(d.getElementsByTagName('w:pgSz')[0].getAttribute('w:orient'),'portrait');
 assert.equal(d.getElementsByTagName('w:cols')[0].getAttribute('w:num'),'1');
 assert.equal(text.split('{{cecDecision}}').length-1,1);assert.equal(text.split('{{fullName}}').length-1,2);
 assert.equal([...d.getElementsByTagName('w:br')].filter(br=>['page','column'].includes(br.getAttribute('w:type'))).length,0);
 assert(!text.includes('-признан временно нетрудоспособным'));assert(!text.includes('-изменен диагноз'));
 const layout=globalThis.__FillBARSMedicalPrintLayouts__.cec;assert(!layout.landscape);assert.equal(layout.pages,1);
 const preview=new JSDOM(layout.html);assert.equal(preview.window.document.querySelectorAll('.cec-sheet').length,1);assert.equal(preview.window.document.querySelectorAll('.cec-section').length,2);
 assert.deepEqual([...new Set([...layout.html.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]))].sort(),[...t.fields].sort());
 preview.window.close();dom.window.close();
});

test('commission editors preload demographics and require manual findings, decisions and signatures',()=>{
 const root=path.resolve(__dirname,'..');
 for(const kind of ['palliative','cec']){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'medical-forms.html'),'utf8'),{url:'https://extension.test/medical-forms.html?template='+kind+'&payload=fillbars-medical-commission-test',runScripts:'outside-only'});
  const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
  w.localStorage.setItem('fillbars-medical-commission-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{fullName:'Тестов Тест Тестович',birthDate:'1980-03-02',diagnosis:'Тестовый диагноз',commissionDecision:'Непроверенное решение',cecDecision:'Непроверенное решение',objectiveStatus:'Непроверенный осмотр'}}));
  for(const file of ['office-export.js','medical-templates.js','medical-print-layouts.js','commission-templates.js','commission-print-layouts.js','medical-forms.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
  assert.equal(w.document.getElementById('fullName').value,'Тестов Тест Тестович');assert.equal(w.document.getElementById('birthDate').value,'02.03.1980');
  for(const field of templates[kind].manualFields)assert.equal(w.document.getElementById(field).value,'',kind+'/'+field);
  if(kind==='palliative')assert.equal(w.document.getElementById('commissionDecision').value,templates.palliative.fieldDefaults.commissionDecision);
  const input=w.document.getElementById(kind==='cec'?'cecDecision':'commissionDecision');input.value='Проверенный текст < & >\nВторая строка';input.dispatchEvent(new w.Event('input'));
  const frame=w.document.querySelector('iframe');assert(frame.srcdoc.includes('Проверенный текст &lt; &amp; &gt;'));assert(!frame.srcdoc.includes('{{'));
  if(kind==='palliative'){
   input.value='';input.dispatchEvent(new w.Event('input'));
   assert(!frame.srcdoc.includes(templates.palliative.fieldDefaults.commissionDecision));
  }
  if(kind==='cec')assert.equal(frame.style.width,'');
  dom.window.close();
 }
});
