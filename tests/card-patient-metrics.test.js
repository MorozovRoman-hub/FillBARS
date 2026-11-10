'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { setImmediate: tick } = require('node:timers/promises');
const { JSDOM } = require('jsdom');

function setup(t, responder) {
    const { window } = new JSDOM(`<div class="healing_emp">
        <div cmptype="Grid" name="gridHealingDoctor"><table><tbody>
            <tr class="repkeyvalue11" cmptype="GridRow" isclone="1"><td><a name="PAT_LINK" keyvalue="41">Тест</a></td></tr>
        </tbody></table></div></div>`, { url: 'https://bars.example/mis/index.php', pretendToBeVisual: true, runScripts: 'outside-only' });
    const row = window.document.querySelector('tr');
    row.clone = { data: { ID: '11', HH_DEP: '21', DISEASECASE: '31', PATIENT: '41', PATIENT_AGENT: '51' } };
    window.HTMLElement.prototype.getClientRects = () => [{}];
    window.D3Api = { SYS_CACHE_UID: 'runtime-cache', cache_enabled: true, session_cache: 'runtime-session' };
    window.SYS_current_theme = 'new';
    const requests = [];
    const definitions = {
        analyses: ['DS_ANALYSES', 'Range', { DISEASECASE: 'DIS_g0', HH_DEP_ID: 'HH_DEP_ID_g1' }],
        patients_information: ['DS_CONSITUTION_SPS', '', { AGENT: 'AGENT' }],
        persmedcard: ['pmc', '', { PATIENT_ID: 'pat' }]
    };
    window.fetch = async (url, request) => {
        const params = Object.fromEntries(request.body);
        requests.push({ path: url.pathname, params, query: Object.fromEntries(url.searchParams), headers: request.headers });
        if (url.pathname.endsWith('/getform.php')) {
            const [dataset, mode, bindings] = definitions[url.searchParams.get('Form').split('/').at(-1)];
            const tags = Object.entries(bindings).map(([src, get]) => `<Var src="${src}" get="${get}" srctype="var"></Var>`).join('');
            return { ok: true, headers: { get: () => 'native-form-cache' }, text: async () =>
                `<div cmptype="sysinfo"><DataSet name="${dataset}" mode="${mode}">${tags}</DataSet></div>` };
        }
        const rows = await responder(params, request.signal);
        return { ok: true, text: async () => `<DataSet name="${params.DataSet}">${rows}</DataSet>` };
    };
    for (const file of ['kidney-function.js', 'lab-markers.js', 'kidney-bars-adapter.js', 'patient-metrics.js']) {
        window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
    }
    const { update } = window.FillBARSPatientMetrics;
    t.after(() => { update(false); window.close(); });
    return { row, update, requests, badge: () => row.querySelector('[data-fillbars-patient-metrics]') };
}

function labRow({ caseId = '31', dep = '21', hb = '112' } = {}) {
    return `<row><DISEASECASE>${caseId}</DISEASECASE><HH_DEP>${dep}</HH_DEP><SVISIT_DATE>10.11.2026</SVISIT_DATE>
        <RES><![CDATA[<span style="color:red;">Гемоглобин: ${hb} г/л</span>;
        Креатинин: 160 мкмоль/л; Глюкоза: 6,5 ммоль/л]]></RES></row>`;
}

const constitution = `<row><ANTHROP_NAME>Масса тела</ANTHROP_NAME><A_VALUE>90</A_VALUE><MEAS>кг</MEAS></row>
    <row><ANTHROP_NAME>Рост</ANTHROP_NAME><A_VALUE>170</A_VALUE><MEAS>см</MEAS></row>`;

test('renders blood markers without extra requests, preserving BARS abnormal flags and units', async t => {
    const extraLabs = `<row><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><BIO>Моча</BIO>
        <RES><![CDATA[Лейкоциты: 90 10^9/л; Амилаза: 900 Ед/л]]></RES></row>
        <row><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><BIO>Сыворотка крови</BIO><SVISIT_DATE>10.11.2026</SVISIT_DATE>
        <RES><![CDATA[Амилаза панкреатическая: 300 Ед/л; <span style="color:red;">Альфа-амилаза: 128 Ед/л</span>;
        Билирубин прямой: 5 мкмоль/л; Билирубин (общий): 17,2 мкмоль/л]]></RES></row>
        <row><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><SERVICE_NAME>ОАК</SERVICE_NAME>
        <RES><![CDATA[Лейкоциты: 99; WBC (лейкоциты): 12,6 10^9/л]]></RES></row>`;
    const { update, requests, badge } = setup(t, params => ({
        DS_ANALYSES: labRow() + extraLabs, DS_CONSITUTION_SPS: constitution, pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
    })[params.DataSet]);
    update(false);
    assert.equal(requests.length, 0);
    update(true);
    await tick();
    const original = badge();
    assert.ok(original);
    const [gfr, hb, glucose, bmi, amylase, bilirubin, leukocytes] = original.children;
    assert.match(gfr.textContent, /^СКФ \d/);
    assert.equal(hb.textContent, 'Hb 112');
    assert.equal(hb.style.color, 'rgb(153, 27, 27)');
    assert.match(hb.title, /10\.11\.2026/);
    assert.equal(glucose.textContent, 'Глюкоза 6,5');
    assert.equal(bmi.textContent, 'ИМТ 31,14');
    assert.equal(amylase.textContent, 'Амилаза 128');
    assert.equal(amylase.style.color, 'rgb(153, 27, 27)');
    assert.match(amylase.title, /Ед\/л.*10\.11\.2026/);
    assert.equal(bilirubin.textContent, 'Билирубин общ. 17,2');
    assert.equal(leukocytes.textContent, 'Лейкоциты 12,6');
    assert.match(leukocytes.title, /10\^9\/л/);
    assert.deepEqual(requests.filter(({ params }) => params.DataSet).map(({ path, params }) =>
        [path, params.DataSet, params.DIS_g0, params.HH_DEP_ID_g1, params.AGENT, params.pat]), [
        ['/mis/getdata.php', 'DS_ANALYSES', '31', '21', undefined, undefined],
        ['/mis/getdata.php', 'DS_CONSITUTION_SPS', undefined, undefined, '51', undefined],
        ['/mis/getdata.php', 'pmc', undefined, undefined, undefined, '41']
    ]);
    update(true);
    assert.equal(badge(), original);
    assert.equal(requests.length, 6);
    assert.equal(requests[1].query.FormCache, 'native-form-cache');
    assert.equal(requests[1].params.mode, 'Range');
    assert.equal(requests[0].query.session_cache, 'runtime-session');
    assert.equal(requests[0].query.cache, 'runtime-cache');
    assert.match(requests[1].headers.Method, /^POST getdata\.php\?.* HTTP\/1\.1$/);
    update(false);
    assert.equal(badge(), null);
});

test('discards an in-flight result after BARS recycles a row and ignores foreign admission data', async t => {
    let finish;
    let oldSignal;
    const { update, row, badge, requests } = setup(t, (params, signal) => {
        if (params.DataSet !== 'DS_ANALYSES') return '';
        if (params.DIS_g0 === '31') {
            oldSignal = signal;
            return new Promise(resolve => { finish = resolve; });
        }
        return labRow({ caseId: '32', dep: '21', hb: '65' }); // Different department than requested.
    });
    update(true);
    await tick();
    row.className = 'repkeyvalue12';
    row.querySelector('a').setAttribute('keyvalue', '42');
    row.clone.data = { ID: '12', HH_DEP: '22', DISEASECASE: '32', PATIENT: '42', PATIENT_AGENT: '52' };
    await tick();
    assert.equal(oldSignal.aborted, true);
    finish(labRow());
    await tick();
    assert.equal(requests.at(-1).params.AGENT, '52');
    assert.equal(badge().children[1].textContent, 'Hb —');
    assert.equal(badge().children[1].title, 'Лабораторные результаты недоступны');
});
