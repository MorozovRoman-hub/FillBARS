const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try{
        const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:460,height:750}});
        const page=await context.newPage();
        await page.goto(pathToFileURL(path.resolve(__dirname,'../popup.html')).href);
        const profile=await page.locator('#profileSelect').boundingBox();
        const templates=await page.locator('#medicalTemplate').boundingBox();
        if(!profile||!templates||Math.abs(profile.y-templates.y)>1||profile.x>=templates.x||templates.x+templates.width>430)throw new Error('Profile and document selectors must share one row');
        const panel=page.locator('.kidney-panel');
        if(!await panel.isVisible()||await page.locator('#medicalTemplate option').count()<20)throw new Error('Kidney row or document list is missing');
        const box=await panel.boundingBox();
        if(box.x<0||box.x+box.width>460)throw new Error('Kidney row exceeds popup width');
        if(box.height>195)throw new Error('Kidney row is not collapsed by default');
        if(!await page.locator('.kidney-details #kidneySource').count())throw new Error('Kidney source details are not in the dropdown');
        if(!await page.locator('#hemoglobinResult').isVisible()||!await page.locator('#glucoseResult').isVisible()||!await page.locator('.kidney-details #kidneyHemoglobin').count()||!await page.locator('.kidney-details #kidneyGlucose').count())throw new Error('Hemoglobin or glucose value or verification input is missing');
        const kidney=await page.locator('.kidney-results').boundingBox();
        const hemoglobin=await page.locator('#hemoglobinResult').boundingBox();
        const glucose=await page.locator('#glucoseResult').boundingBox();
        const bmi=await page.locator('#bmiResult').boundingBox();
        const egfr=await page.locator('#egfrResult').boundingBox();
        const crcl=await page.locator('#crclResult').boundingBox();
        if(!kidney||!hemoglobin||!bmi||!glucose||!egfr||!crcl||Math.abs(kidney.y-hemoglobin.y)>1||Math.abs(kidney.y-glucose.y)>1||kidney.x>=hemoglobin.x||hemoglobin.x>=bmi.x||bmi.x>=glucose.x||Math.abs(hemoglobin.y-bmi.y)>1||glucose.x+glucose.width>430||Math.abs(egfr.y-crcl.y)>1||egfr.x>=crcl.x)throw new Error('Both kidney calculations, hemoglobin, BMI and glucose must share one row');
        await page.screenshot({path:path.resolve(__dirname,'artifacts/popup-535.png'),fullPage:true});
        console.log('Kidney popup layout: OK',Math.round(box.width),Math.round(box.height));
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
