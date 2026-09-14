'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const compat = require('../browser-compat');

function popup() {
    return new JSDOM(fs.readFileSync(path.join(__dirname, '../popup.html'), 'utf8')).window.document;
}

function chromeWith({ quota, acknowledged = false } = {}) {
    const values = acknowledged ? { [compat.ACKNOWLEDGED_KEY]: true } : {};
    return {
        values,
        storage: {
            session: quota === undefined ? {} : { QUOTA_BYTES: quota },
            local: {
                get: async key => ({ [key]: values[key] }),
                set: async update => Object.assign(values, update)
            }
        }
    };
}

test('Chrome с сессионной квотой 1 МБ показывает предупреждение один раз', async () => {
    const chromeApi = chromeWith({ quota: 1024 * 1024 });
    const first = popup();
    assert.equal(await compat.init({ chromeApi, navigatorApi: { userAgent: 'Chrome/109.0' }, documentApi: first }), true);
    assert.equal(first.getElementById('browserCompatWarning').hidden, false);
    first.getElementById('dismissBrowserCompatWarning').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(first.getElementById('browserCompatWarning').hidden, true);
    assert.equal(chromeApi.values[compat.ACKNOWLEDGED_KEY], true);

    const reopened = popup();
    assert.equal(await compat.init({ chromeApi, navigatorApi: { userAgent: 'Chrome/109.0' }, documentApi: reopened }), false);
    assert.equal(reopened.getElementById('browserCompatWarning').hidden, true);
});

test('фактическая увеличенная квота не показывает предупреждение даже при старой строке UA', async () => {
    const documentApi = popup();
    const chromeApi = chromeWith({ quota: 10 * 1024 * 1024 });
    assert.equal(await compat.init({ chromeApi, navigatorApi: { userAgent: 'Chrome/109.0' }, documentApi }), false);
    assert.equal(documentApi.getElementById('browserCompatWarning').hidden, true);
});

test('при недоступной квоте версия Chrome 109–111 используется как запасная проверка', () => {
    const chromeApi = chromeWith();
    assert.equal(compat.needsWarning(chromeApi, { userAgent: 'Chrome/111.0.0.0' }), true);
    assert.equal(compat.needsWarning(chromeApi, { userAgent: 'Chrome/112.0.0.0' }), false);
});
