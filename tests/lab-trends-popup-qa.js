'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try{
        const page=await browser.newPage({viewport:{width:430,height:750}});
        // Prevent the normal popup bootstrap from querying a live BARS tab.
        await page.route('**/popup.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
        await page.route('**/diary-launch.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
        await page.goto(pathToFileURL(path.resolve(__dirname,'../popup.html')).href);
        assert.equal(await page.locator('.lab-trends').evaluate(el=>el.open),false);
        const collapsed=await page.locator('.kidney-panel').boundingBox();
        assert(collapsed.height<195,'Collapsed laboratory panel stays compact');
        await page.locator('.lab-trends summary').click();
        await page.evaluate(()=>{
            const sample=(values,unit)=>values.map((value,i)=>({value:String(value),unit,date:`${25+i}.10.2026`,service:'Демонстрационный анализ'}));
            FillBARSLabTrends.render(document.querySelector('#labTrends'),{
                hemoglobin:sample([110,115,119,121],'г/л'),
                creatinine:sample([100,95,92,88],'мкмоль/л'),
                glucose:sample([6.4,6.0,5.8,5.6],'ммоль/л')
            },4);
        });
        assert.equal(await page.locator('#labTrends svg').count(),3);
        assert.equal(await page.locator('#labTrends tbody tr').count(),12);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=430),'No horizontal overflow');
        for(const box of await page.locator('#labTrends svg, #labTrends table').evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right};})))assert(box.x>=0&&box.right<=430);
        const artifacts=path.resolve(__dirname,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
        await page.screenshot({path:path.join(artifacts,'lab-trends-528.png'),fullPage:true});
        console.log('Lab trends popup: 3 charts, 12 rows, no overflow, collapsed height',collapsed.height);
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
