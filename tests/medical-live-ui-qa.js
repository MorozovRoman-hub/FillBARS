/* Browser smoke test for the extension's actual editor and embedded print layout. */
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

(async () => {
    const browser = await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    try {
        const page = await browser.newPage({viewport:{width:1600,height:1000}});
        const base = pathToFileURL(path.resolve(__dirname, '../medical-forms.html'));
        for (const kind of ['operationConsent','operationProtocol','workInjury315','workInjury316','epidemicInvestigation','centralCatheter']) {
            const url = new URL(base);url.searchParams.set('template',kind);
            await page.goto(url.href,{waitUntil:'load'});
            const title = await page.locator('h1').textContent();
            if (title === 'Бланки') throw new Error(`${kind}: template was not loaded`);
            const frames = await page.locator('iframe.source-preview-frame').count();
            if (kind === 'centralCatheter') {
                if (await page.locator('.source-print-page').count() !== 2) throw new Error('Central catheter needs both source pages');
            } else {
                if (frames !== 1) throw new Error(`${kind}: source preview missing`);
                await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.body?.textContent?.length > 50);
                await page.evaluate(() => { const frame=document.querySelector('iframe');frame.contentWindow.print=()=>{window.__formPrintCalled=true;}; });
                await page.locator('#print').click();
                if (!(await page.evaluate(() => window.__formPrintCalled))) throw new Error(`${kind}: print did not use preview layout`);
                await page.evaluate(() => {delete window.__formPrintCalled;});
            }
            if (kind === 'operationProtocol') {
                const height = await page.locator('#operationDescription').evaluate(input => input.getBoundingClientRect().height);
                if (height < 400) throw new Error('Operation description editor is too small: '+height);
            }
            if (kind === 'centralCatheter') {
                await page.locator('#fullName').fill('Тестов Тест Тестович');
                await page.locator('#historyNumber').fill('TEST-123');
                await page.locator('.source-print-page').first().screenshot({path:path.resolve(__dirname,'artifacts/new-form-refs-518/browser/centralCatheter-preview-1.png')});
                await page.locator('.source-print-page').last().screenshot({path:path.resolve(__dirname,'artifacts/new-form-refs-518/browser/centralCatheter-preview-2.png')});
            }
            console.log(kind, title, frames);
        }
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
