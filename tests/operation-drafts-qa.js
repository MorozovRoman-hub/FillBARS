'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try{
        const page=await browser.newPage({viewport:{width:1400,height:1000}});
        const url=pathToFileURL(path.resolve(__dirname,'../medical-forms.html'));url.searchParams.set('template','operationProtocol');
        await page.goto(url.href);
        const additions=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../scripts/operation-drafts.json'),'utf8'));
        for(const item of additions){
            const value=await page.locator('#operationDraft option').evaluateAll((options,name)=>options.find(option=>option.textContent===name)?.value,item.name);
            assert(value!==undefined,'Missing option: '+item.name);
            await page.locator('#operationDraft').selectOption(value);
            assert.equal(await page.locator('#operationName').inputValue(),item.name);
            assert.equal(await page.locator('#operationDescription').inputValue(),item.text);
            await page.waitForFunction(name=>document.querySelector('.source-preview-frame')?.contentDocument?.body?.textContent.includes(name),item.name);
            const text=await page.frameLocator('.source-preview-frame').locator('body').textContent();
            for(const paragraph of item.text.split('\n'))assert(text.includes(paragraph));
        }
        const output=path.resolve(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
        await page.locator('#operationDraft').selectOption({label:additions[0].name});
        await page.waitForFunction(name=>document.querySelector('.source-preview-frame')?.contentDocument?.body?.textContent.includes(name),additions[0].name);
        await page.screenshot({path:path.join(output,'operation-drafts-529.png'),fullPage:true});
        console.log('Six operation drafts: editor and source print preview OK');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
