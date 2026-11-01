'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
require('../office-export');require('../medical-templates');require('../histology-template');require('../medical-print-layouts');require('../histology-print-layout');
const forms=require('../medical-forms'),template=globalThis.__FillBARSMedicalTemplates__.histology;

test('histology keeps two source forms, five vial rows, manual lab decisions and no stale institution or year',()=>{
 const xml=Buffer.from(template.entries.find(e=>e.name==='word/document.xml').data,'base64').toString();
 const doc=new JSDOM(xml,{contentType:'application/xml'}),d=doc.window.document;
 assert(d.documentElement.textContent.includes('014/у'));assert(d.documentElement.textContent.includes('014-1/у'));
 assert(!d.documentElement.textContent.includes('2025'));assert(!d.documentElement.textContent.includes('Шевчук'));
 assert.equal(d.getElementsByTagName('w:tr').length,6);
 const protocol=[...d.getElementsByTagName('w:p')].find(p=>p.textContent.includes('014-1/у'));
 assert.equal(protocol.getElementsByTagName('w:pageBreakBefore').length,1);
 for(const row of [1,2,3,4,5])for(const field of ['Number','Location','Description','Count'])assert(template.fields.includes('vial'+row+field));
 const layout=globalThis.__FillBARSMedicalPrintLayouts__.histology;
 assert.equal(layout.pages,2);
 assert.deepEqual([...new Set([...layout.html.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]))].sort(),[...template.fields].sort());
 assert(template.options.biopsyMethod.length===7);assert(!template.fields.includes('signature'));doc.window.close();
});

test('histology editor preloads shared identity and keeps specialist fields blank and editable',()=>{
 const root=path.resolve(__dirname,'..');const dom=new JSDOM(fs.readFileSync(path.join(root,'medical-forms.html'),'utf8'),{url:'https://extension.test/medical-forms.html?template=histology&payload=fillbars-medical-histology-test',runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.localStorage.setItem('fillbars-medical-histology-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{fullName:'Тестов Тест Тестович',department:'Тестовое отделение',birthDate:'1980-03-02',diagnosis:'Тестовый диагноз',icdCode:'TEST'}}));
 for(const file of ['office-export.js','medical-templates.js','medical-print-layouts.js','histology-template.js','histology-print-layout.js','medical-forms.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 assert.equal(w.document.getElementById('fullName').value,'Тестов Тест Тестович');
 assert.equal(w.document.getElementById('birthDate').value,'02.03.1980');
 for(const id of ['biopsyMethod','formalin','materialDate','pathologist','histologyConclusion','histologyDate'])assert.equal(w.document.getElementById(id).value,'');
 assert.equal(w.document.getElementById('macroDescription').tagName,'TEXTAREA');
 const input=w.document.getElementById('vial1Location');input.value='Тестовый орган < & >';input.dispatchEvent(new w.Event('input'));
 const frame=w.document.querySelector('iframe');assert(frame.srcdoc.includes('Тестовый орган &lt; &amp; &gt;'));
 assert(!frame.srcdoc.includes('{{'));assert(frame.srcdoc.includes('Тестов Тест Тестович'));
 dom.window.close();
});
