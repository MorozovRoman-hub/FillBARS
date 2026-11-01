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
                if(!state){
                    const row={...C.createRow({date:'2026-10-29',time:'10:00'}),diary:'Боли слева. Живот мягкий.',examination:'Контроль обследований.',treatment:'Назначения врача.'};
                    state={patient:{key:'demo',fullName:'Учебный Пациент Тестович',birth:'01.01.1980',history:'ДЕМО'},draft:{rows:[row],defaults:{...C.DEFAULTS},hourStep:4,profileId:''},run:null};
                    if(location.search.includes('readback')){
                        row.status='saved';state.run={id:'demo-run',status:'uncertain',phase:'saving',rows:[row],index:0,updatedAt:1,results:[{rowId:row.id,recordId:'demo-record',verification:'mismatch',differences:[{field:'S_DNEVNIK',actual:'Боли справа. Живот мягкий.',truncated:false},{field:'AD',actual:'130/90',truncated:false}]}],trace:[],message:'Дневник сохранён, обнаружены расхождения.'};
                    }
                }
                if(message.action==='load')return {ok:true,state,library:C.emptyLibrary(),historyLibrary:C.starterHistoryLibrary(),settings:{}};
                if(message.action==='draft')state.draft=message.draft;
                return {ok:true,state};
            };
        });
        const url=pathToFileURL(path.resolve(__dirname,'../diaries.html')).href;
        await page.goto(url+'?tab=1');
        await page.locator('#addTime').click();
        await page.locator('#diary').fill('Боли справа. Живот мягкий.');await page.locator('#pulse').fill('88');
        assert(await page.locator('#comparisonPanel').isVisible());
        assert((await page.locator('#comparisonFields del').first().textContent()).includes('слева'));
        assert.equal(await page.locator('#pressure').evaluate(el=>el.classList.contains('field-inherited')),true);
        assert.equal(await page.locator('#pulse').evaluate(el=>el.classList.contains('field-changed')),true);
        const output=path.resolve(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
        await page.screenshot({path:path.join(output,'diary-changes-532.png'),fullPage:true});
        await page.goto(url+'?tab=1&readback=1');
        await page.waitForFunction(()=>!document.querySelector('#verificationPanel').hidden);
        const result=await page.locator('#verificationResults').textContent();
        assert(result.includes('Боли слева.')&&result.includes('Боли справа.')&&result.includes('120/80')&&result.includes('130/90'));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=1440));
        await page.screenshot({path:path.join(output,'diary-readback-532.png'),fullPage:true});
        console.log('Diary review: inherited/changed phrases and vitals, expected/actual persisted fields, no horizontal overflow');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
