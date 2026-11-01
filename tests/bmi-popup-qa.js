'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try{
        const page=await browser.newPage({viewport:{width:430,height:850}});
        await page.route('**/popup.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
        await page.route('**/diary-launch.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
        await page.goto(pathToFileURL(path.resolve(__dirname,'../popup.html')).href);
        // Exercise the real render, refresh and input handlers with synthetic patient data.
        const source=fs.readFileSync(path.resolve(__dirname,'../popup.js'),'utf8');
        const functions=source.slice(source.indexOf('function renderKidneyResult(){'),source.indexOf('async function openMedicalTemplate('));
        const start=source.lastIndexOf("    for(const id of ['kidneySex','kidneyAge','kidneyWeight','kidneyHeight'");
        assert(start>0);
        const handlers=source.slice(start,source.indexOf('    refreshKidneyData().catch',start));
        await page.addScriptTag({content:functions+'\n'+handlers});
        await page.evaluate(async()=>{
            window.readKidneyDataFromActiveBars=async()=>({sex:'male',birthDate:'01.01.1980',weight:'120',height:'200',creatinine:'88.4',creatinineUnit:'мкмоль/л',hemoglobin:'129',hemoglobinUnit:'г/л',glucose:'5',glucoseUnit:'ммоль/л'});
            await refreshKidneyData();
        });
        assert.equal(await page.locator('#kidneyHeight').inputValue(),'200');
        assert.equal(await page.locator('#bmiResult strong').textContent(),'30.0');
        assert(await page.locator('#bmiResult').evaluate(el=>el.classList.contains('bmi-obesity-1')));
        await page.locator('.kidney-details summary').click();
        for(const [weight,label,tone] of [[60,'Дефицит массы III степени','bmi-underweight-3'],[64,'Дефицит массы II степени','bmi-underweight-2'],[68,'Дефицит массы I степени','bmi-underweight-1'],[140,'Ожирение II степени','bmi-obesity-2'],[160,'Ожирение III степени','bmi-obesity-3'],[80,'Норма','bmi-normal'],[110,'Избыток массы','bmi-overweight']]){
            await page.locator('#kidneyWeight').fill(String(weight));
            assert.equal(await page.locator('#bmiResult .bmi-category').textContent(),label);
            assert(await page.locator('#bmiResult').evaluate((el,tone)=>el.classList.contains(tone),tone));
        }
        await page.locator('#kidneyHeight').fill('');
        assert.equal(await page.locator('#bmiResult strong').textContent(),'—');
        assert.equal(await page.locator('#bmiResult').getAttribute('class'),'lab-result');
        await page.locator('#kidneyHeight').fill('200');
        await page.locator('#kidneyAge').fill('17');
        assert.equal(await page.locator('#bmiResult').getAttribute('class'),'lab-result');
        await page.locator('#kidneyAge').fill('46');
        await page.locator('#kidneyWeight').fill('160');
        await page.locator('.kidney-details summary').click();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=430));
        const boxes=await page.locator('#hemoglobinResult,#bmiResult,#glucoseResult').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,overflow:el.scrollWidth>el.clientWidth};}));
        assert(boxes.every(box=>box.y===boxes[0].y&&box.right<=430&&!box.overflow));
        assert(boxes[0].x<boxes[1].x&&boxes[1].x<boxes[2].x);
        await page.screenshot({path:path.resolve(__dirname,'artifacts/bmi-popup-535.png'),fullPage:true});
        await page.evaluate(async()=>{window.readKidneyDataFromActiveBars=async()=>({sex:'female',birthDate:'01.01.1980'});await refreshKidneyData();});
        assert.equal(await page.locator('#kidneyHeight').inputValue(),'');
        assert.equal(await page.locator('#bmiResult strong').textContent(),'—');
        assert.equal(await page.locator('#bmiResult').getAttribute('class'),'lab-result');
        console.log('BMI popup: auto height, live edits, category colors, missing data, patient refresh, adjacent cards and no overflow: OK');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
