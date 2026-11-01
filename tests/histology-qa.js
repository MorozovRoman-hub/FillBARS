'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>localStorage.setItem('fillbars-medical-histology-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{fullName:'Тестов Тест Тестович',medicalOrganization:'Тестовая больница',organizationAddress:'Тестовый адрес',registeredAddress:'Тестовый адрес',department:'Хирургическое отделение',birthDate:'1980-03-02',diagnosis:'Тестовый диагноз',icdCode:'TEST',doctorName:'Тестов Т.Т.'}})));
  const url=pathToFileURL(path.resolve(__dirname,'../medical-forms.html'));url.searchParams.set('template','histology');url.searchParams.set('payload','fillbars-medical-histology-test');
  await page.goto(url.href);
  assert.equal(await page.locator('#fullName').inputValue(),'Тестов Тест Тестович');
  for(const id of ['formalin','biopsyMethod','histologyConclusion'])assert.equal(await page.locator('#'+id).inputValue(),'');
  for(const [key,value] of Object.entries({histologySex:'муж-1',biopsyMethod:'операционный материал – 6',formalin:'да'}))await page.locator('#'+key).selectOption(value);
  for(const [key,value] of Object.entries({materialDate:'01.11.2026',materialTime:'10:30',histologyPurpose:'Уточнение характера изменений.',vial1Number:'1',vial1Location:'Жёлчный пузырь',vial1Description:'Операционный материал',vial1Count:'1'}))await page.locator('#'+key).fill(value);
  await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.body?.textContent.includes('Жёлчный пузырь'));
  const html=await page.locator('iframe').getAttribute('srcdoc');assert(!html.includes('{{'));
  const text=await page.locator('iframe').evaluate(frame=>frame.contentDocument.body.textContent);
  assert(text.includes('014/у')&&text.includes('014-1/у'));assert(!text.includes('Шевчук'));assert(!text.includes('2025'));
  await page.locator('iframe').evaluate(frame=>{frame.contentWindow.print=()=>{window.__histologyPrinted=true;};});
  await page.locator('#print').click();assert(await page.evaluate(()=>window.__histologyPrinted));
  const out=path.resolve(__dirname,'artifacts/histology-540');fs.mkdirSync(out,{recursive:true});
  // Capture the real download button's Blob without relying on file:// download policy.
  await page.evaluate(()=>{
   const original=URL.createObjectURL;
   URL.createObjectURL=blob=>{window.__histologyBytes=blob.arrayBuffer().then(buffer=>Array.from(new Uint8Array(buffer)));return original(blob);};
   HTMLAnchorElement.prototype.click=function(){window.__histologyDownloadName=this.download;};
  });
  await page.locator('#download').click();
  const bytes=await page.evaluate(()=>window.__histologyBytes);assert(bytes.length>1000);
  assert((await page.evaluate(()=>window.__histologyDownloadName)).endsWith('.docx'));
  fs.writeFileSync(path.join(out,'browser-histology.docx'),Buffer.from(bytes));
  await page.screenshot({path:path.join(out,'editor.png')});
  const printPage=await browser.newPage({viewport:{width:1000,height:1400}});await printPage.setContent(html);
  const rowHeights=await printPage.locator('table tr').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
  assert.equal(rowHeights.length,6);assert(rowHeights.slice(1).every(height=>height>=15),'Empty vial rows remain visible');
  await printPage.pdf({path:path.join(out,'browser-histology.pdf'),preferCSSPageSize:true,printBackground:true});
  await printPage.screenshot({path:path.join(out,'browser-preview.png'),fullPage:true});
  assert(await printPage.locator('[data-fillbars-field="fullName"]').count()===2);
  console.log('Histology: patient fields, manual clinical choices, 5 material rows, 2 source forms, preview, iframe print and DOCX download: OK');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
