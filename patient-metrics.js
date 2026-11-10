(() => {
    'use strict';
    if (globalThis.FillBARSPatientMetrics) return;

    const d3Grid = '.healing_emp [cmptype="Grid"][name="gridHealingDoctor"]';
    const legacyGrid = '.pat_in_dep_healing_emp [cmptype="Grid"][name="GRID_HH"]';
    const grids = `${d3Grid}, ${legacyGrid}`;
    const badgeSelector = '[data-fillbars-patient-metrics]';
    const decorations = `${badgeSelector}, [data-fillbars-cec]`;
    const repeaterId = /(?:^|\s)(?:rep|repeater)keyvalue(\d+)(?=\s|$)/;
    const cache = new Map();
    const forms = new Map();
    const signatures = new WeakMap();
    const kidney = globalThis.FillBARSKidney;
    const lab = globalThis.FillBARSLabMarkers;
    const parsers = globalThis.FillBARSKidneyBars;
    const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
    let activeRequest;
    let enabled = false;

    const clean = value => String(value ?? '').trim();
    const id = value => /^\d{1,20}$/.test(clean(value)) && (typeof value !== 'number' || Number.isSafeInteger(value)) ? clean(value) : '';
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible';

    function patient(row, grid) {
        const d3 = grid.matches(d3Grid);
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
        for (const grid of document.querySelectorAll(grids)) {
            if (!visible(grid)) continue;
            if (grid.matches(legacyGrid) && grid.closest('.pat_in_dep_healing_emp')
                .querySelector('input[type="radio"][name="N_TYPE"]:checked')?.value !== '0') continue;
            for (const row of grid.querySelectorAll('tr[cmptype="GridRow"]')) {
                const entry = patient(row, grid);
                if (entry) result.push(entry);
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

    function latest(rows, parser, name) {
        for (const row of rows) {
            const reading = parser([row]);
            if (!reading[name]) continue;
            // Match only the native abnormal span for the selected analyte and value.
            const abnormal = [...(row.RES || '').matchAll(/<span\s+style="color:\s*red;?"\s*>([^<]*)<\/span>/gi)].some(([, text]) => {
                const marked = parser([{ ...row, RES: text }]);
                return marked[name] === reading[name] && marked[`${name}Unit`] === reading[`${name}Unit`];
            });
            return { value: reading[name], unit: reading[`${name}Unit`], date: reading[`${name}Date`], abnormal };
        }
        return {};
    }

    const bloodMarkers = [
        { key: 'amylase', label: 'Амилаза', names: /^(?:(?:альфа|α)[\s-]*)?амилаза(?:\s+(?:общая|\(общая\)|альфа))?$/iu },
        { key: 'bilirubin', label: 'Билирубин общ.', names: /^(?:общий\s+билирубин|билирубин(?:\s+(?:общий|общ\.|\(общий\)))?)$/iu },
        { key: 'wbc', label: 'Лейкоциты', names: /^(?:лейкоциты(?:\s*\(WBC\)|,\s*WBC)?|WBC(?:\s*\(лейкоциты\))?)$/iu }
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
                ['DISEASECASE', 'HH_DEP', 'RES', 'BIO', 'SERVICE_NAME', 'SVISIT_DATE', 'SREG_DATE'], {
                    DISEASECASE: entry.caseId, HH_DEP_ID: entry.departmentId
                }, {
                    _c: '100', _s: '1', _pageNum: '0',
                    '_srt[VISIT_DATE]': '-1', '_srt[REG_DATE]': '-2', '_srt[ID]': '-3'
                }, signal);
            const sameEpisode = labs.filter(row => id(row.DISEASECASE) === entry.caseId && id(row.HH_DEP) === entry.departmentId);
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
                data.labsAvailable ? `Нужны ${gfr.errors.join(', ')}` : labUnavailable, 'CKD-EPI 2021'],
            ['Hb', hb, 'г/л', hemoglobin.date, hemoglobin.abnormal || hbTone === 'hb-low' ? 'red' : hbTone ? 'amber' : '',
                data.labsAvailable ? 'Гемоглобин не найден' : labUnavailable, 'Гемоглобин'],
            ['Глюкоза', sugar, 'ммоль/л', glucose.date, glucose.abnormal || (sugarTone && sugarTone !== 'glucose-borderline') ? 'red' : sugarTone ? 'amber' : '',
                data.labsAvailable ? 'Глюкоза крови не найдена' : labUnavailable],
            ['ИМТ', bmi.value, 'кг/м²', '', /^(?:bmi-underweight-[23]|bmi-obesity-[123])$/.test(bmiTone) ? 'red'
                : /^(?:bmi-underweight-1|bmi-overweight)$/.test(bmiTone) ? 'amber' : '',
                data.constitutionAvailable ? bmi.message : 'Рост и вес недоступны', bmi.category?.label || bmi.message],
            ...bloodMarkers.map(({ label }, index) => {
                const reading = extraLabs[index];
                return [label, Number(reading.value), reading.unit, reading.date, reading.abnormal ? 'red' : '',
                    data.labsAvailable ? 'Результат анализа крови не найден' : labUnavailable];
            })
        ];
    }

    function paint(entry, data) {
        const current = entry.row.querySelector(badgeSelector);
        if (!data) {
            current?.remove();
            return;
        }
        const items = metrics(entry, data);
        const signature = JSON.stringify([entry.key, items]);
        if (current && signatures.get(current) === signature) return;
        const badge = document.createElement('span');
        badge.dataset.fillbarsPatientMetrics = '';
        signatures.set(badge, signature);
        badge.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;font:11px/1.35 Arial,sans-serif';
        for (const [label, value, unit, date, tone, missing, detail] of items) {
            const available = Number.isFinite(value);
            const item = document.createElement('span');
            item.textContent = `${label} ${available ? formatter.format(value) : '—'}`;
            item.title = available ? [detail, unit, date && `от ${date}`].filter(Boolean).join(' · ') : missing;
            item.style.cssText = 'padding:1px 4px;border-radius:3px;white-space:nowrap;'
                + (tone === 'red' ? 'background:#fee2e2;color:#991b1b;font-weight:700'
                    : tone === 'amber' ? 'background:#fef3c7;color:#78350f;font-weight:700'
                        : 'background:#edf2f7;color:#344256');
            badge.append(item);
        }
        if (current) current.replaceWith(badge);
        else entry.link.after(badge);
    }

    function scan() {
        const patients = currentPatients();
        const rows = new Set(patients.map(entry => entry.row));
        const keys = new Set(patients.map(entry => entry.key));
        for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
        for (const badge of document.querySelectorAll(badgeSelector)) {
            if (!rows.has(badge.closest('tr'))) badge.remove();
        }
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
            const inGrid = !!target.closest(grids);
            if (record.type === 'childList') {
                return [...record.addedNodes, ...record.removedNodes].some(node =>
                    !node.matches?.(decorations) && (inGrid || node.matches?.(grids) || node.querySelector?.(grids)));
            }
            if (record.type === 'attributes') {
                if (target.matches('tr[cmptype="GridRow"]')) {
                    return inGrid && (record.attributeName !== 'class'
                        || repeaterId.exec(record.oldValue)?.[1] !== repeaterId.exec(target.className)?.[1]);
                }
                if (record.attributeName === 'keyvalue' && target.matches('[name="PAT_LINK"]')) return inGrid;
                return target.matches(grids) || !!target.querySelector(grids);
            }
            return inGrid;
        })) scan();
    });
    document.addEventListener('visibilitychange', () => { if (enabled && !document.hidden) scan(); });
    document.addEventListener('change', event => {
        if (enabled && event.target.matches?.('input[name="N_TYPE"]')) scan();
    });

    globalThis.FillBARSPatientMetrics = { update(value) {
        enabled = value;
        if (enabled) {
            observer.observe(document.documentElement, {
                subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
                attributeFilter: ['hidden', 'style', 'class', 'isclone', 'repeatershow', 'keyvalue', 'repkeyvalue', 'repeaterkeyvalue']
            });
            scan();
        } else {
            observer.disconnect();
            if (activeRequest) {
                activeRequest.discarded = true;
                activeRequest.controller.abort();
            }
            cache.clear();
            forms.clear();
            document.querySelectorAll(badgeSelector).forEach(badge => badge.remove());
        }
    } };
})();
