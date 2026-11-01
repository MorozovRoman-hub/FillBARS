'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
 try{
  const out=path.resolve(__dirname,'artifacts/commission-541');fs.mkdirSync(out,{recursive:true});
  for(const kind of ['palliative','cec']){
   const page=await browser.newPage({viewport:{width:1600,height:1000}});
   await page.addInitScript(()=>localStorage.setItem('fillbars-medical-commission-test',JSON.stringify({generatedAt:new Date().toISOString(),patient:{fullName:'Тестов Тест Тестович',birthDate:'1980-03-02',medicalOrganization:'Тестовая больница',registeredAddress:'Тестовый адрес',diagnosis:'Тестовый диагноз',icdCode:'TEST',doctorName:'Тестов Т.Т.'}})));
   const url=pathToFileURL(path.resolve(__dirname,'../medical-forms.html'));url.searchParams.set('template',kind);url.searchParams.set('payload','fillbars-medical-commission-test');
   await page.goto(url.href);
   const decision=kind==='cec'?'cecDecision':'commissionDecision';
   assert.equal(await page.locator('#'+decision).inputValue(),kind==='cec'?'':'Признать пациента нуждающимся в оказании паллиативной медицинской помощи.');
   const fields={complaints:'Тестовые жалобы.',objectiveStatus:'Тестовые данные осмотра.',commissionMember1:'Тестов Т.Т.'};
   if(kind==='cec')fields[decision]='Решение для проверки макета.\nДополнительная строка.';
   if(kind==='cec')Object.assign(fields,{cecObjectiveStatus:'Тестовый осмотр комиссии.',cecDiagnosis:'Тестовый диагноз комиссии.',cecPurpose:'Тестовая цель направления.'});
   else fields.commissionRecommendations='Тестовые рекомендации.';
   for(const [field,value] of Object.entries(fields))await page.locator('#'+field).fill(value);
   await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.body.textContent.includes('Тестовые данные осмотра.'));
   const html=await page.locator('iframe').getAttribute('srcdoc');assert(!html.includes('{{'));
   if(kind==='cec'){
    assert(await page.locator('iframe').evaluate(frame=>frame.getBoundingClientRect().width<900));
    assert.equal(await page.frameLocator('iframe').locator('.cec-sheet').count(),1);assert.equal(await page.frameLocator('iframe').locator('.cec-section').count(),2);
   }
   await page.locator('iframe').evaluate(frame=>{frame.contentWindow.print=()=>{window.__commissionPrinted=true;};});await page.locator('#print').click();assert(await page.evaluate(()=>window.__commissionPrinted));
   await page.evaluate(()=>{const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.__commissionBytes=blob.arrayBuffer().then(b=>Array.from(new Uint8Array(b)));return original(blob);};HTMLAnchorElement.prototype.click=function(){window.__commissionDownloadName=this.download;};});
   await page.locator('#download').click();const bytes=await page.evaluate(()=>window.__commissionBytes);assert(bytes.length>1000);fs.writeFileSync(path.join(out,'browser-'+kind+'.docx'),Buffer.from(bytes));
   const printPage=await browser.newPage({viewport:{width:1400,height:1200}});await printPage.setContent(html);
   if(kind==='cec'){
    for(const sheet of await printPage.locator('.cec-sheet').all()){
     const copies=await sheet.locator('.cec-section').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,overflow:e.scrollWidth>e.clientWidth+1};}));
     assert.equal(copies.length,2);assert(Math.abs(copies[0].x-copies[1].x)<1);assert(copies[0].bottom<copies[1].y);
     assert((await sheet.locator('.cec-section').first().textContent()).replace(/\s+/g,' ').includes('ПРЕДСТАВЛЕНИЕ НА'));
     assert((await sheet.locator('.cec-section').last().textContent()).replace(/\s+/g,' ').includes('ЗАКЛЮЧЕНИЕ КЭК'));assert(copies.every(copy=>!copy.overflow));
    }
   }
   await printPage.pdf({path:path.join(out,'browser-'+kind+'.pdf'),preferCSSPageSize:true,printBackground:true});
   await printPage.screenshot({path:path.join(out,'browser-'+kind+'.png'),fullPage:true});
   console.log(kind+': editable fields, expected initial decision, preview, print and Word bytes: OK');
   await page.close();await printPage.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
