'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { setImmediate: tick } = require('node:timers/promises');
const { JSDOM } = require('jsdom');

function setup(t, responder, gridName = 'gridHealingDoctor') {
    const { window } = new JSDOM(`<div class="healing_emp">
        <div cmptype="Grid" name="${gridName}"><table><tbody>
            <tr class="repkeyvalue11" cmptype="GridRow" isclone="1"><td column_name="COL_SIGNAL_INFO">Важная информация</td><td><a name="PAT_LINK" keyvalue="41">Тест</a></td></tr>
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
    return { window, row, update, requests, badge: () => row.querySelector('[data-fillbars-patient-metrics]') };
}

function labRow({ caseId = '31', dep = '21', hb = '112' } = {}) {
    return `<row><DISEASECASE>${caseId}</DISEASECASE><HH_DEP>${dep}</HH_DEP><SVISIT_DATE>10.11.2026</SVISIT_DATE>
        <RES><![CDATA[<span style="color:red;">Гемоглобин: ${hb} г/л</span>;
        Креатинин: 160 мкмоль/л; Глюкоза: 6,5 ммоль/л]]></RES></row>`;
}

const constitution = `<row><ANTHROP_NAME>Масса тела</ANTHROP_NAME><A_VALUE>90</A_VALUE><MEAS>кг</MEAS></row>
    <row><ANTHROP_NAME>Рост</ANTHROP_NAME><A_VALUE>170</A_VALUE><MEAS>см</MEAS></row>`;

function freezeReminderDate(window) {
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [2026, 10, 18, 12])); }
        static now() { return new NativeDate(2026, 10, 18, 12).getTime(); }
    };
}

function panelRow(name, date, extra = '') {
    return `<row><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><BIO>Кровь</BIO><SERVICE_NAME>${name}</SERVICE_NAME>
        <SVISIT_DATE>${date}</SVISIT_DATE><RES>Результат исследования</RES>${extra}</row>`;
}

test('total protein preserves source navigation, dated trends and biochemical repeat checks across departments', async t => {
    const protein = (date, value, dep, source, name) => `<row><ID>${source}</ID><DISEASECASE>31</DISEASECASE><HH_DEP>${dep}</HH_DEP>
        <BIO>Сыворотка крови</BIO><SVISIT_DATE>${date}</SVISIT_DATE><RES>${name}: ${value} г/л</RES></row>`;
    const { window, row, update, badge } = setup(t, params => ({
        DS_ANALYSES: protein('10.11.2026', '54,2', '20', '7007', 'Белок (общий)')
            + protein('08.11.2026', '70', '19', '7006', 'Белок общий в сыворотке крови'),
        DS_CONSITUTION_SPS: '', pmc: ''
    })[params.DataSet]);
    freezeReminderDate(window);
    const opened = [];
    window.openWindow = (...args) => opened.push(args);
    update(true, false, { enabled: true, days: 7 });
    await tick();
    const proteinBadge = badge().children[7];
    assert.equal(proteinBadge.textContent, 'об.бел 54,2');
    assert.match(proteinBadge.title, /Ранее: 70 от 08\.11\.2026\n↓ Изменение: −15,8/);
    proteinBadge.click();
    assert.equal(opened[0][0].rep_paramDS_IDS, '7007');
    assert.match(row.querySelector('[data-fillbars-lab-repeat]').title, /Биохимический анализ крови: от 10\.11\.2026/);
});

for (const gridName of ['gridHealingDoctor', 'gridDutyDoctor', 'gridPatsInObservation']) {
    test(`${gridName} preserves readings, trends and repeat reminders from earlier departments in the same admission`, async t => {
        const { window, row, update, badge, requests } = setup(t, params => ({
            DS_ANALYSES: labRow({ caseId: '999', dep: '22', hb: '999' }).replace('10.11.2026', '18.11.2026')
                + labRow({ dep: '21', hb: '112' })
                + labRow({ dep: '20', hb: '130' }).replace('10.11.2026', '08.11.2026'),
            DS_CONSITUTION_SPS: '', pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
        })[params.DataSet], gridName);
        freezeReminderDate(window);
        row.clone.data.HH_DEP = '22';
        update(true, false, { enabled: true, days: 7 });
        await tick();
        const request = requests.find(request => request.params.DataSet === 'DS_ANALYSES');
        assert.equal(request.params.DIS_g0, '31');
        assert.equal(request.params.HH_DEP_ID_g1, '');
        assert.equal(badge().children[1].textContent, 'Hb 112');
        assert.match(badge().children[1].getAttribute('aria-label'), /Ранее: 130 от 08\.11\.2026\n↓ Изменение: −18/);
        const reminder = row.querySelector('[data-fillbars-lab-repeat]');
        assert.match(reminder.title, /Клинический анализ крови: от 10\.11\.2026/);
        assert.match(reminder.title, /Биохимический анализ крови: от 10\.11\.2026/);
        assert.doesNotMatch(reminder.title, /18\.11\.2026/);
    });
}

for (const [date, due] of [['12.11.2026 00:01', false], ['11.11.2026 23:59', true], ['10.11.2026', true]]) {
    test(`repeat reminder uses calendar days and triggers at 7 days: ${date}`, async t => {
        const { window, row, update, badge } = setup(t, params => ({
            DS_ANALYSES: panelRow('Общий (клинический) анализ крови развернутый', date)
                + panelRow('Биохимический анализ крови', '17.11.2026'),
            DS_CONSITUTION_SPS: '', pmc: ''
        })[params.DataSet]);
        freezeReminderDate(window);
        const cell = row.querySelector('[column_name="COL_SIGNAL_INFO"]');
        update(false, false, { enabled: true, days: 7 });
        await tick();
        assert.equal(badge(), null, 'reminders work independently of metric badges');
        const reminder = row.querySelector('[data-fillbars-lab-repeat]');
        assert.equal(!!reminder, due);
        if (due) {
            assert.equal(reminder.parentElement, cell);
            assert.match(cell.textContent, /^Важная информацияПовторить анализы!/);
            assert.equal(reminder.textContent, 'Повторить анализы!');
            assert.match(reminder.title, /Клинический анализ крови:/);
            assert.doesNotMatch(reminder.title, /Биохимический анализ крови:/);
            update(false, false, { enabled: true, days: 30 });
            assert.equal(row.querySelector('[data-fillbars-lab-repeat]'), null);
            update(false, false, { enabled: true, days: 7 });
            assert.ok(row.querySelector('[data-fillbars-lab-repeat]'));
            update(false);
            assert.equal(row.querySelector('[data-fillbars-lab-repeat]'), null);
            assert.equal(cell.textContent, 'Важная информация');
        }
    });
}

test('repeat reminder selects the newest panel independently and ignores foreign episodes and urine', async t => {
    const { window, row, update } = setup(t, params => ({
        DS_ANALYSES: panelRow('ОАК', '01.11.2026') + panelRow('ОАК', '18.11.2026')
            + panelRow('Биохимический анализ крови', '10.11.2026')
            + panelRow('Биохимический анализ крови', '18.11.2026').replace('<DISEASECASE>31', '<DISEASECASE>99')
            + panelRow('Биохимический анализ крови', '18.11.2026').replace('<BIO>Кровь', '<BIO>Моча'),
        DS_CONSITUTION_SPS: '', pmc: ''
    })[params.DataSet]);
    freezeReminderDate(window);
    update(true, false, { enabled: true, days: 7 });
    await tick();
    const reminder = row.querySelector('[data-fillbars-lab-repeat]');
    assert.match(reminder.title, /Биохимический анализ крови: от 10\.11\.2026 · прошло 8 дн/);
    assert.doesNotMatch(reminder.title, /Клинический анализ крови:/);
    update(true, false, { enabled: false });
    assert.equal(row.querySelector('[data-fillbars-lab-repeat]'), null);
    assert.ok(row.querySelector('[data-fillbars-patient-metrics]'));
});

for (const date of ['', '31.02.2026', '19.11.2026']) {
    test(`repeat reminder avoids false overdue alerts when a panel date is unconfirmed: ${date || 'missing'}`, async t => {
        const { window, row, update } = setup(t, params => ({
            DS_ANALYSES: panelRow('Биохимический анализ крови', date) + panelRow('Биохимический анализ крови', '01.11.2026'),
            DS_CONSITUTION_SPS: '', pmc: ''
        })[params.DataSet]);
        freezeReminderDate(window);
        update(false, false, { enabled: true });
        await tick();
        assert.equal(row.querySelector('[data-fillbars-lab-repeat]'), null);
    });
}

test('click and keyboard open the exact source report, while BMI and missing source IDs remain non-interactive', async t => {
    const labs = labRow().replace('<row>', '<row><ID>7001</ID>')
        + `<row><ID>7002</ID><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><BIO>Кровь</BIO>
            <RES>Амилаза: 128 Ед/л; Билирубин общий: 20 мкмоль/л; Лейкоциты: 9 10^9/л</RES></row>`;
    const { window, update, row, badge } = setup(t, params => ({
        DS_ANALYSES: labs, DS_CONSITUTION_SPS: constitution, pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
    })[params.DataSet]);
    const opened = [];
    window.openWindow = (...args) => opened.push(args);
    update(true);
    await tick();
    let bubbled = 0;
    row.addEventListener('click', () => bubbled++);
    row.addEventListener('mousedown', () => assert.fail('grid must not rebuild the row before the badge click'));
    const buttons = [...badge().children];
    assert.equal(buttons[3].getAttribute('role'), null);
    for (const index of [0, 1, 2, 4, 5, 6]) {
        const button = buttons[index];
        assert.equal(button.getAttribute('role'), 'button');
        button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
        button.click();
        const [form, modal] = opened.at(-1);
        assert.equal(form.name, 'Reports/showReport');
        assert.equal(form._rep_code, 'lis_results_mass');
        assert.equal(form.rep_paramDS_IDS, index < 3 ? '7001' : '7002');
        assert.equal(form.rep_paramDIR_SERV_ID, form.rep_paramDS_IDS);
        assert.equal(modal, true);
    }
    assert.equal(bubbled, 0);
    buttons[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(opened.length, 7);
    row.clone.data.DISEASECASE = '999';
    buttons[1].click();
    assert.equal(opened.length, 7, 'stale badge cannot open a report after row recycling');
});

test('a displayed reading without a valid source ID cannot open a report', async t => {
    const { window, update, badge } = setup(t, params => ({
        DS_ANALYSES: labRow(), DS_CONSITUTION_SPS: '', pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
    })[params.DataSet]);
    window.openWindow = () => assert.fail('missing source must not open a report');
    update(true);
    await tick();
    assert.equal(badge().children[1].getAttribute('role'), null);
    badge().children[1].click();
});

for (const previous of ['96', '128', '97', '127', '112']) {
    test(`hemoglobin hover highlights only an absolute change greater than 15 g/L: 112 versus ${previous}`, async t => {
        const { window, update, badge } = setup(t, params => ({
            DS_ANALYSES: labRow() + labRow({ hb: String(Number(previous) / 10) })
                .replace('10.11.2026', '08.11.2026').replace(' г/л', ' г/дл'),
            DS_CONSITUTION_SPS: '', pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
        })[params.DataSet]);
        update(true);
        await tick();
        const hb = badge().children[1];
        assert.equal(hb.textContent, 'Hb 112');
        hb.dispatchEvent(new window.MouseEvent('mouseenter'));
        const tip = window.document.querySelector('[role="tooltip"]');
        if (Math.abs(112 - Number(previous)) > 15) {
            assert.ok(tip);
            assert.equal(hb.title, '');
            assert.match(tip.textContent, /10\.11\.2026/);
            assert.match(tip.textContent, /08\.11\.2026/);
            assert.equal(tip.querySelector('strong').style.color, 'rgb(185, 28, 28)');
            assert.match(tip.querySelector('strong').textContent, /[↑↓] Изменение: [−+]16 г\/л/);
            hb.dispatchEvent(new window.MouseEvent('mouseleave'));
            assert.equal(window.document.querySelector('[role="tooltip"]'), null);
            hb.focus();
            assert.ok(window.document.querySelector('[role="tooltip"]'));
            window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
            assert.equal(window.document.querySelector('[role="tooltip"]'), null);
            hb.dispatchEvent(new window.MouseEvent('mouseenter'));
            update(false);
            assert.equal(window.document.querySelector('[role="tooltip"]'), null);
        } else {
            assert.equal(tip, null);
            assert.ok(hb.title);
        }
    });
}

test('hover shows dated trends in display units without changing compact labels or making extra requests', async t => {
    const earlier = labRow({ hb: '12' }).replace('10.11.2026', '08.11.2026')
        .replace('12 г/л', '12 г/дл').replace('160 мкмоль/л', '120 мкмоль/л');
    const extra = (date, value, unit = 'Ед/л') => `<row><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><BIO>Кровь</BIO>
        <SVISIT_DATE>${date}</SVISIT_DATE><RES>Амилаза: ${value} ${unit}</RES></row>`;
    const { update, badge, requests } = setup(t, params => ({
        DS_ANALYSES: labRow() + labRow({ hb: '999' }) + earlier
            + extra('10.11.2026', '128') + extra('09.11.2026', '100'),
        DS_CONSITUTION_SPS: constitution, pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
    })[params.DataSet]);
    update(true);
    await tick();
    const [gfr, hb, glucose, bmi, amylase] = badge().children;
    assert.equal(hb.textContent, 'Hb 112');
    assert.match(hb.title, /от 10\.11\.2026\nРанее: 120 от 08\.11\.2026\n↓ Изменение: −8/);
    assert.match(gfr.title, /Ранее: .*08\.11\.2026\n↓ Изменение:/);
    assert.match(glucose.title, /Без изменений/);
    assert.doesNotMatch(bmi.title, /Ранее:/);
    assert.match(amylase.title, /Ранее: 100 от 09\.11\.2026\n↑ Изменение: \+28/);
    assert.equal(requests.length, 6);
});

test('hover does not invent trends for missing dates, invalid dates, incompatible units or another admission', async t => {
    const rows = (date, value, unit = 'Ед/л', caseId = '31') => `<row><DISEASECASE>${caseId}</DISEASECASE><HH_DEP>21</HH_DEP>
        <BIO>Кровь</BIO><SVISIT_DATE>${date}</SVISIT_DATE><RES>Амилаза: ${value} ${unit}; Лейкоциты: ${value} 10^9/л</RES></row>`;
    const { update, badge } = setup(t, params => ({
        DS_ANALYSES: labRow() + rows('10.11.2026', '128') + rows('09.11.2026', '5', 'мкат/л')
            + rows('08.11.2026', '99', 'Ед/л', '999'),
        DS_CONSITUTION_SPS: '', pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
    })[params.DataSet]);
    update(true);
    await tick();
    assert.doesNotMatch(badge().children[4].title, /Ранее:|Изменение:/);
    assert.doesNotMatch(badge().children[1].title, /Ранее:|Изменение:/);
});

for (const date of ['', '31.02.2026']) {
    test(`hover suppresses comparisons with an unconfirmed current date: ${date || 'missing'}`, async t => {
        const { update, badge } = setup(t, params => ({
            DS_ANALYSES: labRow().replace('10.11.2026', date) + labRow({ hb: '130' }).replace('10.11.2026', '08.11.2026'),
            DS_CONSITUTION_SPS: '', pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
        })[params.DataSet]);
        update(true);
        await tick();
        assert.doesNotMatch(badge().children[1].title, /Ранее:|Изменение:/);
        if (!date) assert.match(badge().children[1].title, /Дата результата не указана/);
    });
}

for (const gridName of ['gridHealingDoctor', 'gridDutyDoctor', 'gridPatsInObservation']) {
    test(`${gridName} renders blood markers without extra requests, preserving BARS abnormal flags and units`, async t => {
        const extraLabs = `<row><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><BIO>Моча</BIO>
            <RES><![CDATA[Лейкоциты: 90 10^9/л; Амилаза: 900 Ед/л; Общий белок: 900 г/л]]></RES></row>
            <row><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><BIO>Сыворотка крови</BIO><SVISIT_DATE>10.11.2026</SVISIT_DATE>
            <RES><![CDATA[Амилаза панкреатическая: 300 Ед/л; <span style="color:red;">Альфа-амилаза: 128 Ед/л</span>;
            Билирубин прямой: 5 мкмоль/л; Билирубин (общий): 17,2 мкмоль/л;
            С-реактивный белок: 99 мг/л; Альбумин: 40 г/л; <span style="color:red;">Общий белок: 54,2 г/л</span>]]></RES></row>
            <row><DISEASECASE>31</DISEASECASE><HH_DEP>21</HH_DEP><SERVICE_NAME>ОАК</SERVICE_NAME>
            <RES><![CDATA[Лейкоциты: 99; WBC (лейкоциты): 12,6 10^9/л]]></RES></row>`;
        const { update, requests, badge } = setup(t, params => ({
            DS_ANALYSES: labRow() + extraLabs, DS_CONSITUTION_SPS: constitution, pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
        })[params.DataSet], gridName);
        update(false);
        assert.equal(requests.length, 0);
        update(true);
        await tick();
        const original = badge();
        assert.ok(original);
        const [gfr, hb, glucose, bmi, amylase, bilirubin, leukocytes, protein] = original.children;
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
        assert.equal(original.children.length, 8);
        assert.equal(protein.textContent, 'об.бел 54,2');
        assert.equal(protein.style.color, 'rgb(153, 27, 27)');
        assert.match(protein.title, /г\/л.*10\.11\.2026/);
        assert.deepEqual(requests.filter(({ params }) => params.DataSet).map(({ path, params }) =>
            [path, params.DataSet, params.DIS_g0, params.HH_DEP_ID_g1, params.AGENT, params.pat]), [
            ['/mis/getdata.php', 'DS_ANALYSES', '31', '', undefined, undefined],
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
}

test('history flag loads signal metrics independently and replaces them when the episode changes', async t => {
    const { window, update, badge, requests } = setup(t, params => ({
        DS_ANALYSES: labRow(), DS_CONSITUTION_SPS: constitution,
        pmc: '<row><SEX>Мужской</SEX><AGE>62</AGE></row>'
    })[params.DataSet]);
    const history = window.document.createElement('div');
    history.className = 'hosp_history_new';
    history.innerHTML = '<table><tr><td><span name="SIGNAL_INFO">Аллергия</span><a name="SIGNAL_INFO_LINK">Подробнее</a></td></tr></table>';
    const variables = { HH_ID: '11', DISEASECASE: '31', HH_DEP_ID: '21', AGENT: '51', PERSMEDCARD: '41', NSEX: '1' };
    const shell = window.document.createElement('div');
    shell.D3Form = { page: { getVar: key => variables[key], getCaption: () => '01.01.1964' } };
    shell.append(history);
    window.document.body.append(shell);
    update(false, true);
    await tick();
    const signalBadge = () => history.querySelector('[data-fillbars-patient-metrics]');
    assert.equal(badge(), null);
    assert.equal(signalBadge().children[1].textContent, 'Hb 112');
    assert.equal(history.querySelector('[name="SIGNAL_INFO"]').textContent, 'Аллергия');
    const original = signalBadge();
    update(false, true);
    assert.equal(signalBadge(), original);
    assert.equal(requests.filter(request => request.params.DataSet === 'DS_ANALYSES').length, 1);
    variables.HH_DEP_ID = '22';
    history.querySelector('[name="SIGNAL_INFO"]').textContent = 'Новая карта';
    await tick();
    assert.equal(signalBadge().children[1].textContent, 'Hb 112');
    assert.equal(requests.findLast(request => request.params.DataSet === 'DS_ANALYSES').params.HH_DEP_ID_g1, '');
    update(false, false);
    assert.equal(signalBadge(), null);
    assert.equal(history.querySelector('[name="SIGNAL_INFO"]').textContent, 'Новая карта');
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
        return labRow({ caseId: '999', dep: '21', hb: '65' }); // Another disease case must remain excluded.
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
