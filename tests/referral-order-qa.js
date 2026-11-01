'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try{
        const page=await browser.newPage({viewport:{width:1440,height:1000}});
        const url=pathToFileURL(path.resolve(__dirname,'../medical-forms.html'));url.searchParams.set('template','referral');
        await page.goto(url.href);
        for(const [key,value] of Object.entries({fullName:'Тестов Тест Тестович',workPlace:'Тестовое место работы',icdCode:'N23',referralReason:'Тестовое обоснование направления'}))await page.locator('#fields #'+key).fill(value);
        const editor=await page.locator('#fields input,#fields textarea').evaluateAll(els=>els.map(el=>el.id));
        assert(editor.indexOf('workPlace')<editor.indexOf('icdCode')&&editor.indexOf('icdCode')<editor.indexOf('referralReason'));
        const checkPreview=async()=>{
            const items=await page.locator('#preview p').evaluateAll(els=>els.filter(el=>/^[678]\./.test(el.textContent.trim())).map(el=>({text:el.textContent.trim(),y:el.getBoundingClientRect().y})));
            assert.equal(items.length,3);assert(items[0].text.startsWith('6.'));assert(items[1].text.startsWith('7.'));assert(items[2].text.startsWith('8.'));
            assert(items[0].y<items[1].y&&items[1].y<items[2].y);
            assert(items[1].text.includes('N23'));
        };
        await checkPreview();
        await page.locator('#icdCode').scrollIntoViewIfNeeded();
        const output=path.resolve(__dirname,'artifacts/referral-539');fs.mkdirSync(output,{recursive:true});
        await page.screenshot({path:path.join(output,'editor.png'),fullPage:true});
        await page.emulateMedia({media:'print'});await checkPreview();
        await page.locator('#preview').screenshot({path:path.join(output,'print-preview.png')});
        await page.pdf({path:path.join(output,'referral.pdf'),preferCSSPageSize:true,printBackground:true});
        console.log('057/u: editor, preview and print order 6–7–8; one item 7 with editable ICD value: OK');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
