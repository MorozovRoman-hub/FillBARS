/* Local A4 audit of every medical form; outputs are ignored QA artifacts. */
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
require('../medical-templates');
require('../skt-template');
require('../consent-templates');
require('../extra-templates');
require('../followup-templates');
require('../medical-print-layouts');

const output = path.resolve(__dirname,'artifacts/medical-all-print-519');
fs.mkdirSync(output,{recursive:true});
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const values = {fullName:'Тестов Тест Тестович',surname:'Тестов',firstName:'Тест',patronymic:'Тестович',birthDate:'02.03.1980',birthYear:'1980',age:'46',historyNumber:'TEST-123',department:'Тестовое отделение',medicalOrganization:'Тестовая больница',registeredAddress:'Тестовый адрес, дом 1',doctorName:'Тестов Т. Т.',diagnosis:'Тестовый диагноз',operationName:'Тестовая операция',operationDescription:'Описание операции проверяется врачом.',instrumentCount:'Посчитаны, счёт сходится.',swabCount:'Посчитаны, счёт сходится.',documentDate:'24.10.2026'};
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try{
        const page=await browser.newPage({viewport:{width:1400,height:1000}});
        for(const kind of Object.keys(globalThis.__FillBARSMedicalTemplates__)){
            const layout=globalThis.__FillBARSMedicalPrintLayouts__?.[kind];
            if(layout){
                await page.setContent(layout.html.replace(/\{\{(\w+)\}\}/g,(_m,field)=>escape(values[field]||'')),{waitUntil:'load'});
            }else{
                const url=pathToFileURL(path.resolve(__dirname,'../medical-forms.html'));
                url.searchParams.set('template',kind);
                await page.goto(url.href,{waitUntil:'load'});
                for(const [field,value] of Object.entries(values)){
                    const input=page.locator('#fields [id="'+field+'"]');
                    if(await input.count() && await input.evaluate(el=>!['checkbox','select-one'].includes(el.type)))await input.fill(value);
                }
            }
            const target=path.join(output,kind+'.pdf');
            await page.pdf({path:target,preferCSSPageSize:true,printBackground:true});
            console.log(kind,target);
        }
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
