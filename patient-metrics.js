(() => {
    'use strict';
    if (globalThis.FillBARSPatientMetrics) return;

    const d3Grids = '.healing_emp [cmptype="Grid"]:is([name="gridHealingDoctor"], [name="gridDutyDoctor"], [name="gridPatsInObservation"])';
    const legacyGrid = '.pat_in_dep_healing_emp [cmptype="Grid"][name="GRID_HH"]';
    const grids = `${d3Grids}, ${legacyGrid}`;
    const historySelector = '.hosp_history_new';
    const surfaces = `${grids}, ${historySelector}`;
    const badgeSelector = '[data-fillbars-patient-metrics]';
    const repeatSelector = '[data-fillbars-lab-repeat]';
    const decorations = `${badgeSelector}, ${repeatSelector}, [data-fillbars-cec], [data-fillbars-metrics-tooltip]`;
    const repeaterId = /(?:^|\s)(?:rep|repeater)keyvalue(\d+)(?=\s|$)/;
    const cache = new Map();
    const forms = new Map();
    const signatures = new WeakMap();
    const owners = new WeakMap();
    const kidney = globalThis.FillBARSKidney;
    const lab = globalThis.FillBARSLabMarkers;
    const parsers = globalThis.FillBARSKidneyBars;
    const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
    let activeRequest;
    let enabled = false;
    let listEnabled = false;
    let historyEnabled = false;
    let repeatEnabled = false;
    let repeatDays = 7;
    let refreshTimer;
    let tooltip;
    let tooltipAnchor;

    function hideTooltip() {
        tooltipAnchor?.removeAttribute('aria-describedby');
        tooltip?.remove();
        tooltip = tooltipAnchor = undefined;
    }

    function highlightTrend(item, text) {
        item.removeAttribute('title');
        item.setAttribute('aria-label', text);
        item.tabIndex = 0;
        const show = () => {
            hideTooltip();
            tooltipAnchor = item;
            tooltip = document.createElement('span');
            tooltip.dataset.fillbarsMetricsTooltip = '';
            tooltip.id = 'fillbars-metrics-tooltip';
            tooltip.setAttribute('role', 'tooltip');
            tooltip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;white-space:pre-line;'
                + 'max-width:calc(100vw - 16px);box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;'
                + 'border-radius:5px;background:#fff;color:#344256;font:12px/1.5 Arial,sans-serif;box-shadow:0 2px 8px #0003';
            const lines = text.split('\n');
            tooltip.append(document.createTextNode(lines.slice(0, -1).join('\n') + '\n'));
            const change = document.createElement('strong');
            change.textContent = lines.at(-1) + ' г/л';
            change.style.color = '#b91c1c';
            tooltip.append(change);
            document.body.append(tooltip);
            item.setAttribute('aria-describedby', tooltip.id);
            const rect = item.getBoundingClientRect();
            const box = tooltip.getBoundingClientRect();
            tooltip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`;
            tooltip.style.top = `${Math.max(8, rect.bottom + box.height + 8 <= innerHeight ? rect.bottom + 6 : rect.top - box.height - 6)}px`;
        };
        item.addEventListener('mouseenter', show);
        item.addEventListener('focus', show);
        item.addEventListener('mouseleave', hideTooltip);
        item.addEventListener('blur', hideTooltip);
    }

    document.addEventListener('scroll', hideTooltip, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
    globalThis.addEventListener('resize', hideTooltip);

    const clean = value => String(value ?? '').trim();
    const id = value => /^\d{1,20}$/.test(clean(value)) && (typeof value !== 'number' || Number.isSafeInteger(value)) ? clean(value) : '';
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible';

    function patient(row, grid) {
        const d3 = grid.matches(d3Grids);
        if (!visible(row) || (d3 && row.getAttribute('isclone') !== '1')) return null;
        const data = row.clone?.data;
        const rowId = id(row.getAttribute('keyvalue') || row.getAttribute('repkeyvalue')
            || row.getAttribute('repeaterkeyvalue') || repeaterId.exec(row.className)?.[1]);
        if (!rowId || rowId !== id(data?.ID)) return null;
        const link = row.querySelector('[name="PAT_LINK"]');
        if (!link?.textContent.trim() || row.closest('[cmptype="Grid"]') !== grid) return null;
        const caseId = id(data.DISEASECASE);
        const departmentId = id(data.HH_DEP);
        const agent = id(data.PATIENT_AGENT);
        const card = id(data.PATIENT);
        const linkId = id(link.getAttribute('keyvalue'));
        if (!caseId || !departmentId || !agent || !card || (linkId && linkId !== card)) return null;

        const years = clean(data.PATIENT_AGE ?? data.PAT_YEARS);
        const birth = clean(data.PATIENT_BIRTHDATE ?? data.PAT_BDATE);
        const age = /^\d{1,3}$/.test(years) ? Number(years) : kidney.ageAt(birth);
        const sex = kidney.normalizeSex(data.PATIENT_NSEX ?? data.PATIENT_SEX ?? data.NSEX ?? data.PAT_SEX);
        return { row, link, age, sex, caseId, departmentId, agent, card, key: [rowId, caseId, departmentId, agent, card].join(':') };
    }

    function currentPatients() {
        const result = [];
        for (const grid of listEnabled || repeatEnabled ? document.querySelectorAll(grids) : []) {
            if (!visible(grid)) continue;
            if (grid.matches(legacyGrid)) {
                const mode = grid.closest('.pat_in_dep_healing_emp').querySelector('input[type="radio"][name="N_TYPE"]:checked')?.value;
                if (!['0', '1', '2'].includes(mode)) continue;
            }
            for (const row of grid.querySelectorAll('tr[cmptype="GridRow"]')) {
                const entry = patient(row, grid);
                if (entry) result.push(entry);
            }
        }
        if (historyEnabled) {
            for (const history of document.querySelectorAll(historySelector)) {
                if (!visible(history)) continue;
                const page = parsers.pageOf(history, 'ArmPatientsInDep/hosp_history_new');
                if (!page) continue;
                try {
                    const [historyId, caseId, departmentId, agent, card] =
                        ['HH_ID', 'DISEASECASE', 'HH_DEP_ID', 'AGENT', 'PERSMEDCARD'].map(name => id(page.getVar(name)));
                    const link = history.querySelector('[name="SIGNAL_INFO"]');
                    if (!link || ![historyId, caseId, departmentId, agent, card].every(Boolean)) continue;
                    const birth = clean(page.getCaption?.('PAT_BDATE')).match(/\d{1,2}\.\d{1,2}\.\d{4}/)?.[0];
                    result.push({ row: history, link, caseId, departmentId, agent, card,
                        age: kidney.ageAt(birth), sex: kidney.normalizeSex(page.getVar('NSEX')),
                        key: [historyId, caseId, departmentId, agent, card].join(':') });
                } catch {
                    // BARS may destroy or initialize the form during a scan.
                }
            }
        }
        return result;
    }

    function nativeUrl(endpoint, form) {
        // The native forms use the document base. D3 also exposes its own getform.php.
        const url = new URL(endpoint, document.baseURI);
        if (url.origin !== location.origin) throw new Error('Неподдерживаемый адрес БАРС');
        url.searchParams.set('Form', form);
        const native = globalThis.D3Api;
        for (const [key, value] of Object.entries({
            theme: globalThis.SYS_current_theme, cache: native?.SYS_CACHE_UID,
            cache_enabled: native?.cache_enabled, session_cache: native?.session_cache
        })) if (value != null) url.searchParams.set(key, value);
        url.searchParams.set('modal', '1');
        return url;
    }

    async function nativePost(url, params, signal) {
        const response = await fetch(url, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
            headers: { Method: `POST ${url.pathname.split('/').at(-1)}${url.search} HTTP/1.1`,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: new URLSearchParams(params)
        });
        if (!response.ok) throw new Error('Запрос БАРС завершился с ошибкой');
        return response;
    }

    async function formDataset(form, name, variables, signal) {
        const key = `${form}:${name}`;
        const url = nativeUrl('getform.php', form);
        const runtimeKey = url.href;
        const cached = forms.get(key);
        if (cached?.runtimeKey === runtimeKey) return cached;
        const response = await nativePost(url, {}, signal);
        // Read the active deployment's bindings and form cache without mounting its UI.
        const template = document.createElement('template');
        template.innerHTML = await response.text();
        const descriptors = [...template.content.querySelectorAll('[cmptype="sysinfo"] dataset')]
            .filter(element => element.getAttribute('name') === name);
        if (descriptors.length !== 1) throw new Error('Набор данных отсутствует в форме БАРС');
        const descriptor = descriptors[0];
        const bindings = [...descriptor.querySelectorAll('var[get][src]')];
        const names = Object.fromEntries(Object.keys(variables).map(source => {
            const matches = bindings.filter(binding => binding.getAttribute('src').toLowerCase() === source.toLowerCase());
            const target = matches.length === 1 ? matches[0].getAttribute('get') : '';
            if (!/^[a-z0-9_]+$/i.test(target)) throw new Error('БАРС не подтвердил привязку параметров');
            return [source, target];
        }));
        if (new Set(Object.values(names)).size !== Object.keys(names).length) throw new Error('БАРС вернул неоднозначные привязки');
        // Only cache the form definition, never identifiers from the first patient.
        const metadata = { runtimeKey, formCache: response.headers.get('FormCache'), mode: descriptor.getAttribute('mode'),
            bindings: names };
        forms.set(key, metadata);
        return metadata;
    }

    async function dataset(form, name, fields, variables, extras, signal) {
        const metadata = await formDataset(form, name, variables, signal);
        const url = nativeUrl('getdata.php', form);
        url.searchParams.set('baseForm', form);
        if (metadata.formCache) url.searchParams.set('FormCache', metadata.formCache);
        const params = Object.fromEntries(Object.entries(variables).map(([source, value]) => [metadata.bindings[source], value]));
        if (metadata.mode) params.mode = metadata.mode;
        const response = await nativePost(url, { DataSet: name, ...params, ...extras }, signal);
        const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
        const root = xml.documentElement;
        if (root.tagName !== 'DataSet' || root.getAttribute('name') !== name || root.querySelector('Error, ERROR_REQUEST')) {
            throw new Error('БАРС вернул неизвестный ответ');
        }
        return [...root.children].filter(child => child.tagName === 'row').map(row =>
            Object.fromEntries([...row.children].filter(cell => fields.includes(cell.tagName))
                .map(cell => [cell.tagName, cell.textContent])));
    }

    function resultTime(value) {
        const match = clean(value).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!match) return NaN;
        const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
        const date = new Date(+year, +month - 1, +day, +hour, +minute, +second);
        return date.getFullYear() === +year && date.getMonth() === +month - 1 && date.getDate() === +day
            && date.getHours() === +hour && date.getMinutes() === +minute && date.getSeconds() === +second ? +date : NaN;
    }

    function latest(rows, parser, name) {
        let current;
        for (const row of rows) {
            const reading = parser([row]);
            if (!reading[name]) continue;
            // Match only the native abnormal span for the selected analyte and value.
            const abnormal = [...(row.RES || '').matchAll(/<span\s+style="color:\s*red;?"\s*>([^<]*)<\/span>/gi)].some(([, text]) => {
                const marked = parser([{ ...row, RES: text }]);
                return marked[name] === reading[name] && marked[`${name}Unit`] === reading[`${name}Unit`];
            });
            const result = { value: reading[name], unit: reading[`${name}Unit`], date: reading[`${name}Date`], abnormal,
                sourceId: id(row.ID) };
            if (!current) current = result;
            else if (resultTime(result.date) < resultTime(current.date)) {
                current.previous = result;
                break;
            }
        }
        return current || {};
    }

    function repeatDates(rows) {
        const groups = { cbc: [], chemistry: [] };
        for (const row of rows) {
            if (!clean(row.RES) || /моч[аиуеё]|ликвор|кал(?:а|е|ом)?(?:$|\s)|плевральн/iu.test(`${row.BIO || ''} ${row.SERVICE_NAME || ''}`)) continue;
            const name = clean(row.SERVICE_NAME);
            const date = clean(row.SVISIT_DATE || row.SREG_DATE);
            const cbc = /(?:общий|клинический).*анализ.*кров|анализ.*кров.*(?:общий|клинический)|(?:^|\W)(?:ОАК|CBC)(?:$|\W)/iu.test(name)
                || !!parsers.hemoglobinFromRows([row]).hemoglobin || !!bloodMarkerParser(bloodMarkers[2])([row]).wbc;
            const chemistry = /биохим.*(?:кров|анализ|исслед)|(?:анализ|исслед).*биохим|(?:^|\W)БАК(?:$|\W)/iu.test(name)
                || !!parsers.creatinineFromRows([row]).creatinine || !!parsers.glucoseFromRows([row]).glucose
                || bloodMarkers.filter(marker => marker.key !== 'wbc').some(marker => !!bloodMarkerParser(marker)([row])[marker.key]);
            if (cbc) groups.cbc.push(date);
            if (chemistry) groups.chemistry.push(date);
        }
        return Object.fromEntries(Object.entries(groups).map(([key, dates]) => {
            // An undated result cannot establish that the latest panel is overdue.
            const valid = dates.length && dates.every(date => Number.isFinite(resultTime(date)) && resultTime(date) <= Date.now());
            return [key, valid ? dates.reduce((a, b) => resultTime(a) >= resultTime(b) ? a : b) : ''];
        }));
    }

    function paintRepeat(entry, data) {
        let reminder = entry.row.querySelector(repeatSelector);
        const today = new Date();
        const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        const overdue = Object.entries(data?.repeatDates || {}).flatMap(([key, value]) => {
            if (!value) return [];
            const date = new Date(resultTime(value));
            const days = Math.floor((todayDay - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000);
            return days >= repeatDays ? [`${key === 'cbc' ? 'Клинический анализ крови' : 'Биохимический анализ крови'}: от ${value} · прошло ${days} дн.`] : [];
        });
        if (!repeatEnabled || !data?.labsAvailable || !overdue.length) {
            reminder?.remove();
            return;
        }
        const host = entry.row.querySelector('td[column_name="COL_SIGNAL_INFO"], td[column_name="SIGNAL_INFO"], td[cont="SIGNAL_INFO"]')
            || (entry.row.matches(historySelector) ? entry.link.parentElement : null);
        if (!host) {
            reminder?.remove();
            return;
        }
        if (!reminder) {
            reminder = document.createElement('span');
            reminder.dataset.fillbarsLabRepeat = '';
            reminder.textContent = 'Повторить анализы!';
            reminder.style.cssText = 'display:block;margin-top:4px;color:#b91c1c;font:bold 12px/1.35 Arial,sans-serif';
            owners.set(reminder, entry.row);
        }
        const title = `${overdue.join('\n')}\nКонтроль через ${repeatDays} дн.`;
        if (reminder.title !== title) reminder.title = title;
        if (reminder.parentElement !== host) host.append(reminder);
    }

    function trend(reading, convert = (value, unit) =>
        clean(unit).toLowerCase().replace(/\s/g, '') === clean(reading.unit).toLowerCase().replace(/\s/g, '')
            ? Number(value) : NaN) {
        const previous = reading.previous;
        if (!previous) return '';
        const before = convert(previous.value, previous.unit);
        const now = convert(reading.value, reading.unit);
        if (!Number.isFinite(before) || !Number.isFinite(now)) return '';
        const change = Number((now - before).toFixed(2));
        return `Ранее: ${formatter.format(before)} от ${previous.date}\n`
            + (change === 0 ? 'Без изменений' : `${change > 0 ? '↑' : '↓'} Изменение: ${change > 0 ? '+' : '−'}${formatter.format(Math.abs(change))}`);
    }

    const bloodMarkers = [
        { key: 'amylase', label: 'Амилаза', names: /^(?:(?:альфа|α)[\s-]*)?амилаза(?:\s+(?:общая|\(общая\)|альфа))?$/iu },
        { key: 'bilirubin', label: 'Билирубин общ.', names: /^(?:общий\s+билирубин|билирубин(?:\s+(?:общий|общ\.|\(общий\)))?)$/iu },
        { key: 'wbc', label: 'Лейкоциты', names: /^(?:лейкоциты(?:\s*\(WBC\)|,\s*WBC)?|WBC(?:\s*\(лейкоциты\))?)$/iu },
        { key: 'totalProtein', label: 'об.бел', names: /^(?:общий\s+белок|белок\s+(?:общий|общ\.|\(общий\)))$/iu }
    ];

    function bloodMarkerParser({ key, names }) {
        const blood = /кров[ьи]|сыворотк|плазм|(?:^|[^\p{L}])(?:ОАК|CBC)(?:$|[^\p{L}])/iu;
        const nonBlood = /моч[аиуеё]|ликвор|кал(?:а|е|ом)?(?:$|\s)|спинномозгов|синовиальн|плевральн/iu;
        return ([row]) => {
            const source = `${row.BIO || ''} ${row.SERVICE_NAME || ''}`;
            if (nonBlood.test(source)) return {};
            for (const line of parsers.resultLines(row)) {
                const match = line.trim().match(/^(.+?)\s*[:—]\s*(\d+(?:[,.]\d+)?)(?:\s+(\S.*)|([^\d\s,.].*))$/u);
                if (!match) continue;
                const [, title, value, spacedUnit, joinedUnit] = match;
                const label = title.replace(/\s+(?:в\s+)?(?:крови|сыворотке(?:\s+крови)?|плазме(?:\s+крови)?)$/iu, '');
                const unit = clean(spacedUnit || joinedUnit);
                if (!names.test(label) || !(blood.test(source) || blood.test(title)) || !/\p{L}/u.test(unit) || unit.length > 25) continue;
                return { [key]: value.replace(',', '.'), [`${key}Unit`]: unit,
                    [`${key}Date`]: clean(row.SVISIT_DATE || row.SREG_DATE) };
            }
            return {};
        };
    }

    async function read(entry, signal) {
        let labs, constitution, demographics;
        try {
            labs = await dataset('ArmPatientsInDep/Wrappers/analyses', 'DS_ANALYSES',
                ['ID', 'DISEASECASE', 'HH_DEP', 'RES', 'BIO', 'SERVICE_NAME', 'SVISIT_DATE', 'SREG_DATE'], {
                    // Empty department is BARS' native "Все отделения" mode within this disease case.
                    DISEASECASE: entry.caseId, HH_DEP_ID: ''
                }, {
                    _c: '100', _s: '1', _pageNum: '0',
                    '_srt[VISIT_DATE]': '-1', '_srt[REG_DATE]': '-2', '_srt[ID]': '-3'
                }, signal);
            const sameEpisode = labs.filter(row => id(row.DISEASECASE) === entry.caseId);
            labs = sameEpisode.length || !labs.length ? sameEpisode : undefined;
        } catch {
            // Show independently available anthropometry if the lab dataset fails.
        }
        if (!signal.aborted) {
            try {
                constitution = await dataset('ArmPatientsInDep/patients_information', 'DS_CONSITUTION_SPS',
                    ['ANTHROP_NAME', 'A_VALUE', 'MEAS'], { AGENT: entry.agent }, {}, signal);
            } catch {
                // Keep valid lab readings even when anthropometry is unavailable.
            }
        }
        const creatinine = latest(labs || [], parsers.creatinineFromRows, 'creatinine');
        const weight = parsers.weightFromRows(constitution || []).weight;
        const height = parsers.heightFromRows(constitution || []).height;
        if (!signal.aborted && ((creatinine.value && !entry.sex) ||
                ((creatinine.value || (weight && height)) && !Number.isFinite(entry.age)))) {
            try {
                const rows = await dataset('Reports/UniversalDataSets/persmedcard', 'pmc',
                    ['AGE', 'SEX', 'BIRTHDATE'], { PATIENT_ID: entry.card }, {}, signal);
                if (rows.length === 1) demographics = rows[0];
            } catch {
                // Leave estimates incomplete if the exact card cannot be read.
            }
        }
        const age = clean(demographics?.AGE);
        return {
            expires: Date.now() + (labs && constitution ? 300_000 : 60_000),
            labsAvailable: !!labs,
            repeatDates: repeatDates(labs || []),
            constitutionAvailable: !!constitution,
            creatinine,
            hemoglobin: latest(labs || [], parsers.hemoglobinFromRows, 'hemoglobin'),
            glucose: latest(labs || [], parsers.glucoseFromRows, 'glucose'),
            extraLabs: bloodMarkers.map(marker => latest(labs || [], bloodMarkerParser(marker), marker.key)),
            weight, height,
            sex: kidney.normalizeSex(demographics?.SEX),
            age: /^\d{1,3}$/.test(age) ? Number(age) : kidney.ageAt(clean(demographics?.BIRTHDATE))
        };
    }

    function metrics(entry, data) {
        const { creatinine, hemoglobin, glucose, weight, height, extraLabs } = data;
        const age = Number.isFinite(entry.age) ? entry.age : data.age;
        const gfr = kidney.calculate({ sex: entry.sex || data.sex, age, creatinine: creatinine.value, unit: creatinine.unit });
        const hb = lab.hemoglobinGL(hemoglobin.value, hemoglobin.unit);
        const sugar = lab.glucoseMmolL(glucose.value, glucose.unit);
        const bmi = kidney.bodyMassIndex({ weight, height, age });
        const hbTone = lab.hemoglobinTone(hb);
        const sugarTone = lab.glucoseTone(sugar);
        const bmiTone = bmi.category?.tone;
        const labUnavailable = 'Лабораторные результаты недоступны';
        return [
            ['СКФ', gfr.egfr, 'мл/мин/1,73 м²', creatinine.date,
                ['G3b', 'G4', 'G5'].includes(gfr.category?.code) ? 'red' : ['G2', 'G3a'].includes(gfr.category?.code) ? 'amber' : '',
                data.labsAvailable ? `Нужны ${gfr.errors.join(', ')}` : labUnavailable, 'CKD-EPI 2021',
                trend(creatinine, (value, unit) => kidney.calculate({ sex: entry.sex || data.sex, age, creatinine: value, unit }).egfr ?? NaN)],
            ['Hb', hb, 'г/л', hemoglobin.date, hemoglobin.abnormal || hbTone === 'hb-low' ? 'red' : hbTone ? 'amber' : '',
                data.labsAvailable ? 'Гемоглобин не найден' : labUnavailable, 'Гемоглобин', trend(hemoglobin, lab.hemoglobinGL),
                !!hemoglobin.previous && Math.abs(hb - lab.hemoglobinGL(hemoglobin.previous.value, hemoglobin.previous.unit)) > 15],
            ['Глюкоза', sugar, 'ммоль/л', glucose.date, glucose.abnormal || (sugarTone && sugarTone !== 'glucose-borderline') ? 'red' : sugarTone ? 'amber' : '',
                data.labsAvailable ? 'Глюкоза крови не найдена' : labUnavailable, '', trend(glucose, lab.glucoseMmolL)],
            ['ИМТ', bmi.value, 'кг/м²', '', /^(?:bmi-underweight-[23]|bmi-obesity-[123])$/.test(bmiTone) ? 'red'
                : /^(?:bmi-underweight-1|bmi-overweight)$/.test(bmiTone) ? 'amber' : '',
                data.constitutionAvailable ? bmi.message : 'Рост и вес недоступны', bmi.category?.label || bmi.message],
            ...bloodMarkers.map(({ label, key }, index) => {
                const reading = extraLabs[index];
                return [label, Number(reading.value), reading.unit, reading.date, reading.abnormal ? 'red' : '',
                    data.labsAvailable ? 'Результат анализа крови не найден' : labUnavailable,
                    key === 'totalProtein' ? 'Общий белок' : '', trend(reading)];
            })
        ];
    }

    function paint(entry, data) {
        paintRepeat(entry, data);
        const current = entry.row.querySelector(badgeSelector);
        if (!data || !(entry.row.matches(historySelector) ? historyEnabled : listEnabled)) {
            if (current?.contains(tooltipAnchor)) hideTooltip();
            current?.remove();
            return;
        }
        const items = metrics(entry, data);
        const sources = [data.creatinine, data.hemoglobin, data.glucose, null, ...data.extraLabs];
        const signature = JSON.stringify([entry.key, items, sources.map(source => source?.sourceId)]);
        if (current && signatures.get(current) === signature) return;
        const badge = document.createElement('span');
        badge.dataset.fillbarsPatientMetrics = '';
        signatures.set(badge, signature);
        owners.set(badge, entry.row);
        badge.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;font:11px/1.35 Arial,sans-serif';
        for (const [index, [label, value, unit, date, tone, missing, detail, change, highlight]] of items.entries()) {
            const available = Number.isFinite(value);
            const item = document.createElement('span');
            item.textContent = `${label} ${available ? formatter.format(value) : '—'}`;
            item.title = available ? [
                [detail || label, unit, date ? `от ${date}` : 'Дата результата не указана'].filter(Boolean).join(' · '),
                change
            ].filter(Boolean).join('\n') : missing;
            if (available && change && highlight) highlightTrend(item, item.title);
            item.style.cssText = 'padding:1px 4px;border-radius:3px;white-space:nowrap;'
                + (tone === 'red' ? 'background:#fee2e2;color:#991b1b;font-weight:700'
                    : tone === 'amber' ? 'background:#fef3c7;color:#78350f;font-weight:700'
                        : 'background:#edf2f7;color:#344256');
            const sourceId = sources[index]?.sourceId;
            if (available && sourceId && typeof globalThis.openWindow === 'function') {
                item.setAttribute('role', 'button');
                item.tabIndex = 0;
                item.style.cursor = 'pointer';
                item.style.textDecoration = 'underline dotted';
                if (item.title) item.title += '\nНажмите, чтобы открыть результат анализа';
                const openResult = event => {
                    event.preventDefault();
                    event.stopPropagation();
                    hideTooltip();
                    if (!enabled || !currentPatients().some(current => current.row === entry.row && current.key === entry.key)) return;
                    // Open the native read-only report with this exact direction-service ID.
                    // Keep parameters in the new form; do not modify the active patient's form variables.
                    globalThis.openWindow({ name: 'Reports/showReport', _rep_code: 'lis_results_mass',
                        rep_paramDS_IDS: sourceId, rep_paramDIR_SERV_ID: sourceId,
                        vars: { SETTINGS: false }, caption: `${detail || label} — результат анализа` }, true, 1000, 700);
                };
                item.addEventListener('click', openResult);
                // Grid selection on mousedown can rebuild the row before click reaches the badge.
                item.addEventListener('mousedown', event => event.stopPropagation());
                item.addEventListener('dblclick', event => event.stopPropagation());
                item.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') openResult(event);
                });
            }
            badge.append(item);
        }
        if (current) {
            if (current.contains(tooltipAnchor)) hideTooltip();
            current.replaceWith(badge);
        }
        else entry.link.after(badge);
    }

    function scan() {
        if (tooltipAnchor && !tooltipAnchor.isConnected) hideTooltip();
        const patients = currentPatients();
        const rows = new Set(patients.map(entry => entry.row));
        const keys = new Set(patients.map(entry => entry.key));
        for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
        for (const badge of document.querySelectorAll(`${badgeSelector}, ${repeatSelector}`)) {
            if (!rows.has(owners.get(badge))) badge.remove();
        }
        if (tooltipAnchor && !tooltipAnchor.isConnected) hideTooltip();
        for (const entry of patients) paint(entry, cache.get(entry.key));
        if (activeRequest) {
            if (!keys.has(activeRequest.key)) {
                activeRequest.discarded = true;
                activeRequest.controller.abort();
            }
            return;
        }
        if (document.hidden) return;
        const entry = patients.find(item => (cache.get(item.key)?.expires || 0) <= Date.now());
        if (!entry) return;
        const controller = new AbortController();
        const request = { controller, key: entry.key, discarded: false };
        activeRequest = request;
        const timeout = setTimeout(() => controller.abort(), 12_000);
        void read(entry, controller.signal).then(data => {
            if (enabled && !request.discarded && currentPatients().some(patient => patient.key === entry.key)) cache.set(entry.key, data);
        }).finally(() => {
            clearTimeout(timeout);
            activeRequest = undefined;
            if (enabled) scan();
        });
    }

    const observer = new MutationObserver(records => {
        if (!enabled) return;
        if (records.some(record => {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (!target || target.closest(decorations)) return false;
            const inGrid = !!target.closest(surfaces);
            if (record.type === 'childList') {
                return [...record.addedNodes, ...record.removedNodes].some(node =>
                    !node.matches?.(decorations) && (inGrid || node.matches?.(surfaces) || node.querySelector?.(surfaces)));
            }
            if (record.type === 'attributes') {
                if (target.matches('tr[cmptype="GridRow"]')) {
                    return inGrid && (record.attributeName !== 'class'
                        || repeaterId.exec(record.oldValue)?.[1] !== repeaterId.exec(target.className)?.[1]);
                }
                if (record.attributeName === 'keyvalue' && target.matches('[name="PAT_LINK"]')) return inGrid;
                return target.matches(surfaces) || !!target.querySelector(surfaces);
            }
            return inGrid;
        })) scan();
    });
    document.addEventListener('visibilitychange', () => { if (enabled && !document.hidden) scan(); });
    document.addEventListener('change', event => {
        if (enabled && event.target.matches?.('input[name="N_TYPE"]')) scan();
    });

    globalThis.FillBARSPatientMetrics = { update(value, history = false, repeat = {}) {
        listEnabled = value;
        historyEnabled = history;
        repeatEnabled = repeat.enabled === true;
        repeatDays = Number.isInteger(repeat.days) && repeat.days >= 1 && repeat.days <= 365 ? repeat.days : 7;
        enabled = listEnabled || historyEnabled || repeatEnabled;
        if (enabled) {
            refreshTimer ||= setInterval(scan, 60_000);
            observer.observe(document.documentElement, {
                subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
                attributeFilter: ['hidden', 'style', 'class', 'isclone', 'repeatershow', 'keyvalue', 'repkeyvalue', 'repeaterkeyvalue']
            });
            scan();
        } else {
            clearInterval(refreshTimer);
            refreshTimer = undefined;
            hideTooltip();
            observer.disconnect();
            if (activeRequest) {
                activeRequest.discarded = true;
                activeRequest.controller.abort();
            }
            cache.clear();
            forms.clear();
            document.querySelectorAll(`${badgeSelector}, ${repeatSelector}`).forEach(badge => badge.remove());
        }
    } };
})();
