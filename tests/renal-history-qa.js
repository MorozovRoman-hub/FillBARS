'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try{
        const page=await browser.newPage({viewport:{width:1440,height:1000}});
        await page.addInitScript(()=>{
            let state;
            window.cardPreviewRequest=async message=>{
                const C=window.FillBARSCardCore;
                state ||= {patient:{key:'demo',fullName:'Учебный Пациент Тестович',birth:'01.01.1980',history:'ДЕМО'},draft:{rows:[C.createRow()],defaults:C.DEFAULTS,hourStep:4,profileId:''},run:null};
                if(message.action==='load')return {ok:true,state,library:C.emptyLibrary(),historyLibrary:C.starterHistoryLibrary(),settings:{}};
                if(message.action==='draft')state.draft=message.draft;
                if(message.action==='saveHistoryLibrary')return {ok:true,historyLibrary:message.historyLibrary};
                return {ok:true,state};
            };
        });
        await page.goto(pathToFileURL(path.resolve(__dirname,'../diaries.html')).href+'?tab=1');
        await page.locator('#manageHistory').click();
        await page.locator('#historySelect').selectOption('renal-colic-history-v1');
        await page.locator('#historySide').selectOption('right');
        const first=page.locator('#historyEntries textarea').first();
        assert((await first.inputValue()).includes('правой почки'));
        assert.equal(await page.locator('#historyEntries .history-entry').count(),6);
        await page.locator('[data-history-vital="temperature"]').first().fill('37,2');
        await page.locator('[data-history-vital="pressure"]').first().fill('130/80');
        await page.locator('[data-history-vital="pulse"]').first().fill('92');
        await page.locator('[data-history-vital="respiration"]').first().fill('20');
        const output=path.resolve(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
        await first.fill((await first.inputValue())+'\nМоя правка для следующих историй.');
        assert.equal(await page.locator('#historySaveStatus').textContent(),'Есть несохранённые изменения');
        await page.locator('#saveHistory').click();
        await page.waitForFunction(()=>document.querySelector('#historySaveStatus').textContent==='Все изменения сохранены');
        await page.locator('#closeHistory').click();await page.locator('#manageHistory').click();
        assert.equal(await page.locator('#historySelect').inputValue(),'renal-colic-history-v1');
        assert((await first.inputValue()).includes('Моя правка для следующих историй.'));
        assert.equal(await page.locator('[data-history-vital="temperature"]').first().inputValue(),'37,2');
        assert.equal(await page.locator('[data-history-vital="pulse"]').first().inputValue(),'92');
        await page.locator('#historyDialog').evaluate(dialog=>{dialog.scrollTop=dialog.scrollHeight;});
        const save=await page.locator('#saveHistory').boundingBox(),dialog=await page.locator('#historyDialog').boundingBox();
        assert(save.y>=dialog.y&&save.y+save.height<=dialog.y+dialog.height,'Save stays visible while scrolling');
        await page.screenshot({path:path.join(output,'history-editing-531.png'),fullPage:true});
        await page.screenshot({path:path.join(output,'renal-history-template-530.png'),fullPage:true});
        await page.locator('#applyHistory').click();
        await page.waitForFunction(()=>!document.querySelector('#historyDialog').open);
        assert.equal(await page.locator('#rowCount').textContent(),'6');
        assert.equal(await page.locator('#temperature').inputValue(),'37,2');
        assert.equal(await page.locator('#pulse').inputValue(),'92');
        assert.equal(await page.locator('#respiration').inputValue(),'20');
        await page.locator('#draftSide').selectOption('left');
        assert((await page.locator('#diary').inputValue()).includes('левой почки'));
        assert((await page.locator('#diary').inputValue()).includes('Моя правка для следующих историй.'));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=1440));
        await page.screenshot({path:path.join(output,'renal-history-drafts-530.png'),fullPage:true});
        console.log('Renal history: six diaries, side selector in template and drafts, no horizontal overflow');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
