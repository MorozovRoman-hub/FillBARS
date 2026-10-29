/* Manual visual QA: run with CODEX_NODE_MODULES pointing to bundled runtime modules. */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.CODEX_NODE_MODULES, 'playwright'));

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox']
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
        const url = pathToFileURL(path.resolve(__dirname, '../medical-forms.html'));
        url.searchParams.set('template', 'operationConsent');
        await page.goto(url.href, { waitUntil: 'load' });
        await page.locator('#fullName').fill('Тестов Тест Тестович');
        await page.locator('#birthYear').fill('1980');
        await page.locator('#registeredAddress').fill('Тестовый адрес, дом 1');
        await page.locator('#department').fill('ХО2 Амурск');
        await page.locator('#operationName').fill('Тестовая операция');
        await page.locator('.source-print-page img').first().evaluate(image => image.decode());
        const count = await page.locator('.source-print-page').count();
        if (count !== 2) throw new Error('Expected exactly two original pages, got ' + count);
        await page.evaluate(() => { window.print = () => { window.__printWasCalled = true; }; });
        await page.locator('#fullName').fill('ОченьДлиннаяФамилияИмяОтчество'.repeat(10));
        await page.locator('#print').click();
        await page.waitForFunction(() => window.__printWasCalled || document.getElementById('notice').textContent.includes('не помещается'));
        if (await page.evaluate(() => window.__printWasCalled)) throw new Error('Clipped name was sent to print');
        if (!(await page.locator('#notice').textContent()).includes('не помещается')) throw new Error('Missing overflow warning');
        await page.locator('#fullName').fill('Тестов Тест Тестович');
        await page.locator('#registeredAddress').fill('Очень длинный тестовый адрес '.repeat(25));
        await page.locator('#print').click();
        await page.waitForFunction(() => document.getElementById('notice').textContent.includes('не помещается'));
        if (await page.evaluate(() => window.__printWasCalled)) throw new Error('Clipped address was sent to print');
        await page.locator('#registeredAddress').fill('Тестовый адрес, дом 1');
        const output = path.resolve(__dirname, 'artifacts/consent-sources/operation-browser-print.pdf');
        await page.pdf({ path: output, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
        console.log(output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
