'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../cec-reminders.js'), 'utf8');
const popup = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');


function row(id, admission, discharge = '', attributes = '') {
    return `<tr cmptype="GridRow" keyvalue="${id}" ${attributes}>
        <td column_name="PATIENT_FIO_COL"><a name="PAT_LINK" href="#${id}">Пациент ${id}</a></td>
        <td column_name="DATE_IN_TRUNCED">${admission}</td>
        <td column_name="HH_DEP_DATE_OUT">${discharge}</td>
    </tr>`;
}

function fixture(t, rows, d3 = false, state = { saved: {}, now: [2026, 10, 10, 12] }) {
    const { window } = new JSDOM(d3 ? `<div class="d3form formbackground healing_emp">
        <div cmptype="Grid" name="gridHealingDoctor"><table><tbody>${rows}</tbody></table></div>
        <div cmptype="Grid" name="gridDutyDoctor"><table><tbody>${rows}</tbody></table></div>
    </div>` : `<div class="pat_in_dep_healing_emp" theme="new">
        <div class="form-container">
            <div><input name="N_TYPE" type="radio" value="0" checked><input name="N_TYPE" type="radio" value="1"></div>
            <div class="content-wrapper"><div cmptype="Grid" name="GRID_HH"><table><tbody>${rows}</tbody></table></div></div>
        </div>
    </div>`, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://bars.example/' });
    const observers = [];
    const Observer = window.MutationObserver;
    window.MutationObserver = class extends Observer {
        constructor(callback) {
            super(callback);
            observers.push(this);
        }
    };
    t.after(() => {
        observers.forEach(observer => observer.disconnect());
        window.close();
    });
    window.HTMLElement.prototype.getClientRects = function () {
        return this.closest('[hidden]') ? [] : [{}];
    };
    const RealDate = window.Date;
    window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : state.now)); }
    };
    window.chrome = { storage: {
        local: {
            get: async keys => {
                state.reads = (state.reads || 0) + 1;
                return Object.fromEntries(keys.map(key => [key, state.saved[key]]));
            },
            set: async values => Object.assign(state.saved, values),
            remove: async key => { delete state.saved[key]; }
        },
        onChanged: { addListener() {} }
    } };
    window.eval(source);
    return window;
}

async function repaint(window) {
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    await new Promise(resolve => setImmediate(resolve));
}

test('counts calendar days across a month boundary and skips discharged and hidden patients', async t => {
    const window = fixture(t, [
        row(1, '29.10.2026'), row(2, '28.10.2026'), row(3, '27.10.2026'), row(4, '26.10.2026 18:00'),
        row(5, '01.10.2026', '06.11.2026'), row(6, '01.10.2026', '', 'hidden'), row(7, '31.09.2026'),
        row(8, '11.11.2026'), row(9, ''), row(10, '30.10.2026')
    ].join(''));
    const { document } = window;
    await repaint(window);
    const badges = [...document.querySelectorAll('span[data-fillbars-cec]')];
    assert.deepEqual(badges.map(badge => badge.dataset.fillbarsCec), ['13', '14', '15', '15']);
    assert.match(badges[2].textContent, /15-й день/);
    assert.match(badges[3].textContent, /16-й день/);
    assert.deepEqual(JSON.parse(JSON.stringify(await window.FillBARSCECReminders.scan())), [
        { checked: 5, unknown: 3, soon: 1, next: 1, later: 2 }
    ]);
    assert.match(document.querySelector('summary').textContent, /текущая страница/);
    assert.match(document.querySelector('[data-fillbars-cec="panel"] li').textContent, /Пациент 4/);
});

test('stores the commission date and exemption per admission and restores reminders when a mark is removed', async t => {
    const state = { saved: {}, now: [2026, 10, 10, 12] };
    const rows = row(1, '26.10.2026', '', 'isclone="1"').replace(' keyvalue="1"', ' class="clone repkeyvalue351"')
        + row(2, '26.10.2026', '', 'isclone="1"');
    const window = fixture(t, rows, true, state);
    await repaint(window);
    const { document } = window;
    function patientButton(patient, text) {
        const item = [...document.querySelectorAll('li')].find(li => li.firstChild.textContent.startsWith(`Пациент ${patient} ·`));
        return [...item.querySelectorAll('button')].find(button => button.textContent === text);
    }
    patientButton(1, 'КЭК проведена').click();
    const input = document.querySelector('li input[type="date"]');
    input.value = '2026-11-08';
    patientButton(1, 'Сохранить дату').click();
    patientButton(2, 'КЭК не нужна').click();
    await window.FillBARSCECReminders.scan();
    assert.deepEqual(Object.values(state.saved).sort(), ['2026-11-08', 'not-needed']);
    assert.equal(document.querySelectorAll('span[data-fillbars-cec]').length, 0);

    const reopened = fixture(t, rows, true, state);
    for (const [dayOfMonth, alert] of [[21, '13'], [22, '14'], [23, '15']]) {
        state.now = [2026, 10, dayOfMonth, 12];
        await reopened.FillBARSCECReminders.scan();
        const badges = [...reopened.document.querySelectorAll('span[data-fillbars-cec]')];
        assert.deepEqual(badges.map(badge => badge.dataset.fillbarsCec), [alert]);
        assert.match(badges[0].textContent, new RegExp(`${alert} дн. после КЭК`));
    }
    reopened.document.querySelector('[name="gridHealingDoctor"] tbody').innerHTML = row(2, '20.11.2026', '', 'isclone="1"');
    await reopened.FillBARSCECReminders.scan();
    assert.match(reopened.document.querySelector('li').textContent, /4-й день госпитализации/);

    await window.FillBARSCECReminders.scan();
    patientButton(2, 'Снять отметку').click();
    await window.FillBARSCECReminders.scan();
    assert.equal(document.querySelectorAll('span[data-fillbars-cec]').length, 2);
});

test('refreshes with BARS pagination, clears stale marks in other modes and preserves a single panel', async t => {
    const window = fixture(t, row(1, '28.10.2026'));
    const { document } = window;
    await repaint(window);
    const panel = document.querySelector('details');
    panel.open = true;
    document.querySelector('tbody').innerHTML = row(2, '26.10.2026');
    await Promise.resolve();
    await repaint(window);
    assert.equal(document.querySelector('details'), panel);
    assert.match(panel.querySelector('li').textContent, /Пациент 2/);

    const selectMode = value => {
        const radio = document.querySelector(`input[value="${value}"]`);
        radio.checked = true;
        radio.dispatchEvent(new window.Event('change', { bubbles: true }));
    };
    selectMode(1);
    await repaint(window);
    assert.equal(document.querySelectorAll('[data-fillbars-cec]').length, 0);
    selectMode(0);
    await repaint(window);
    window.eval(source);
    window.FillBARSCECReminders.scan();
    assert.equal(document.querySelectorAll('details').length, 1);
    assert.equal(document.querySelectorAll('span[data-fillbars-cec]').length, 1);
});

test('ignores the header clock and preserves the date editor when BARS replaces equivalent rows', async t => {
    const state = { saved: {}, now: [2026, 10, 10, 12] };
    const rows = row(1, '28.10.2026', '', 'isclone="1"');
    const window = fixture(t, rows, true, state);
    await repaint(window);
    const { document } = window;
    const clock = document.createElement('div');
    document.body.prepend(clock);
    clock.textContent = '12:00:01';
    const reads = state.reads;
    await repaint(window);
    assert.equal(state.reads, reads);

    const panel = document.querySelector('details');
    panel.open = true;
    [...panel.querySelectorAll('button')].find(button => button.textContent === 'КЭК проведена').click();
    const input = panel.querySelector('input[type="date"]');
    input.value = '2026-11-08';
    const grid = document.querySelector('[name="gridHealingDoctor"]');
    grid.querySelector('tbody').innerHTML = rows;
    await repaint(window);
    assert.ok(state.reads > reads);
    assert.equal(panel.querySelector('input[type="date"]'), input);
    assert.equal(input.value, '2026-11-08');
    [...panel.querySelectorAll('button')].find(button => button.textContent === 'Сохранить дату').click();
    await repaint(window);
    assert.deepEqual(Object.values(state.saved), ['2026-11-08']);
});

test('detects the D3 attending doctor list and checks loaded rows without legacy keys or radio buttons', async t => {
    const rows = row(1, '28.10.2026', '', 'isclone="1"').replace(' keyvalue="1"', '')
        + row(2, '01.10.2026')
        + row(3, '01.10.2026', '06.11.2026', 'isclone="1"');
    const window = fixture(t, rows, true);
    await repaint(window);
    const { document } = window;
    assert.match(document.querySelector('summary').textContent, /14-й: 1/);
    assert.deepEqual([...document.querySelectorAll('summary > span')].map(counter => [
        counter.textContent, counter.classList.contains('fillbars-cec-count-alert')
    ]), [['0', false], ['1', true], ['0', false]]);
    const badges = [...document.querySelectorAll('span[data-fillbars-cec]')];
    assert.equal(badges.length, 1);
    assert.equal(badges[0].closest('[cmptype="Grid"]').getAttribute('name'), 'gridHealingDoctor');
    assert.equal(badges[0].dataset.fillbarsCec, '14');
    document.querySelector('[name="gridHealingDoctor"]').hidden = true;
    await Promise.resolve();
    await repaint(window);
    assert.equal(document.querySelectorAll('[data-fillbars-cec]').length, 0);
});

test('a fresh script reuses the existing summary and removes duplicate panels', async t => {
    const rows = row(1, '28.10.2026', '', 'isclone="1"').replace('<td column_name="PATIENT_FIO_COL">',
        '<td><a name="HH_LINK" href="#history1">ИБ 1</a></td><td column_name="PATIENT_FIO_COL">')
        + row(2, '29.10.2026', '', 'isclone="1" class="active"');
    const window = fixture(t, rows, true);
    await repaint(window);
    const { document } = window;
    const original = document.querySelector('details');
    const duplicate = original.cloneNode(true);
    duplicate.open = true;
    original.before(duplicate);
    delete window.FillBARSCECReminders;
    window.eval(source);
    await repaint(window);
    assert.deepEqual([...document.querySelectorAll('details')], [original]);
    assert.equal(original.open, true);
    const grid = document.querySelector('[name="gridHealingDoctor"]');
    const history = grid.querySelector('[name="HH_LINK"]');
    const target = history.closest('tr');
    let clicked = false;
    let scrolled = false;
    history.addEventListener('click', () => { clicked = true; });
    history.scrollIntoView = () => { scrolled = true; };
    original.querySelector('button').click();
    assert.equal(clicked, false);
    assert.equal(scrolled, true);
    assert.equal(original.open, false);
    assert.equal(grid.querySelector('.fillbars-cec-history-target'), history);
});

test('the print button uses the clicked patient rather than the active BARS row', async t => {
    const rows = row(1, '28.10.2026', '', 'isclone="1"').replace('<td column_name="DATE_IN_TRUNCED">',
        '<td column_name="BIRTDAT">04.07.1960</td><td column_name="DATE_IN_TRUNCED">')
        + row(2, '29.10.2026', '', 'isclone="1" class="active"');
    const window = fixture(t, rows, true);
    const messages = [];
    window.chrome.runtime = { sendMessage: async message => {
        messages.push(JSON.parse(JSON.stringify(message)));
        return { opened: true };
    } };
    await repaint(window);
    const button = [...window.document.querySelectorAll('li:first-child button')]
        .find(candidate => candidate.textContent === 'Распечатать представление на КЭК');
    button.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(messages, [{ type: 'fillbars-cec-print', patient: { fullName: 'Пациент 1', birthDate: '1960-07-04' } }]);
    assert.equal(button.disabled, false);
});

test('manual check requests no site permission and enabling auto-check registers only the confirmed BARS host', async t => {
    const { window } = new JSDOM(`<button id="cecCheck"></button><section id="cecPanel" hidden>
        <p id="cecStatus"></p><button id="cecEnable" hidden></button></section>
        <div class="healing_emp"><div name="gridHealingDoctor" cmptype="Grid"></div></div>`, { runScripts: 'outside-only' });
    t.after(() => window.close());
    window.TextEncoder = TextEncoder;
    const requests = [];
    const registrations = [];
    window.chrome = {
        tabs: { query: async () => [{ id: 7, url: 'https://mis.example/bars/#current' }] },
        scripting: {
            executeScript: async ({ files, target, func }) => {
                if (files) return [];
                if (target.allFrames) return [{ frameId: 0, result: false }, { frameId: 5, result: window.eval(`(${func})()`) }];
                assert.deepEqual(Array.from(target.frameIds), [5]);
                return [{ result: [{ checked: 1, unknown: 0, soon: 1, next: 0, later: 0 }] }];
            },
            insertCSS: async () => {},
            getRegisteredContentScripts: async () => [],
            registerContentScripts: async rules => registrations.push(...rules)
        },
        permissions: {
            contains: async () => false,
            request: async request => {
                requests.push(request);
                return true;
            }
        }
    };
    window.eval(popup.slice(popup.indexOf('function initCECReminderControls()'), popup.indexOf('async function readKidneyDataFromActiveBars')));
    window.initCECReminderControls();
    const { document } = window;
    document.getElementById('cecCheck').click();
    await new Promise(resolve => setImmediate(resolve));
    const enable = document.getElementById('cecEnable');
    assert.equal(enable.hidden, false);
    assert.equal(requests.length, 0);
    enable.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(requests[0].origins), ['https://mis.example/*']);
    assert.deepEqual(Array.from(registrations[0].matches), ['https://mis.example/*']);
    assert.equal(registrations[0].persistAcrossSessions, true);
    assert.equal(enable.hidden, true);
});
