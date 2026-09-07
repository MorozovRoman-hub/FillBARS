(function (root) {
    'use strict';
    const VERSION = 3;
    const TEXT_LIMIT = 4000;
    const MAX_ROWS = 48;
    const DEFAULTS = Object.freeze({ temperature: '36,6', pressure: '120/80', pulse: '80', respiration: '16' });
    const DEFAULT_SPREAD = Object.freeze({ temperature: .3, systolic: 20, diastolic: 20, pulse: 10, respiration: 2 });
    const SPREAD_LIMITS = Object.freeze({ temperature: .3, systolic: 20, diastolic: 20, pulse: 20, respiration: 2 });
    const textFields = ['diary', 'examination', 'treatment'];
    const vitalFields = Object.keys(DEFAULTS);
    const uid = () => root.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    const clone = value => JSON.parse(JSON.stringify(value));
    const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    function dateParts(date = new Date()) {
        const pad = n => String(n).padStart(2, '0');
        return { date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()), time: pad(date.getHours()) + ':' + pad(date.getMinutes()) };
    }
    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
        const [y, m, d] = value.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return y >= 2000 && y <= 2100 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    }
    const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
    const barsDate = date => validDate(date) ? date.split('-').reverse().join('.') : '';
    function number(value) {
        const source = String(value ?? '').trim().replace(',', '.');
        return /^\d+(?:\.\d+)?$/.test(source) ? Number(source) : NaN;
    }
    function pressure(value) {
        const parts = String(value ?? '').match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/);
        return parts ? [Number(parts[1]), Number(parts[2])] : null;
    }
    function validateVitals(vitals) {
        const errors = [];
        const temperature = number(vitals.temperature);
        const bp = pressure(vitals.pressure);
        if (!Number.isFinite(temperature) || temperature < 25 || temperature > 45) errors.push({ field: 'temperature', message: 'Температура: введите число от 25 до 45 °C.' });
        if (!bp || bp[0] < 30 || bp[0] > 300 || bp[1] < 10 || bp[1] > 250 || bp[0] <= bp[1]) errors.push({ field: 'pressure', message: 'АД: формат 120/80; систолическое должно быть выше диастолического.' });
        for (const [field, label, min, max] of [['pulse', 'ЧСС', 1, 300], ['respiration', 'ЧД', 1, 80]]) {
            const value = number(vitals[field]);
            if (!Number.isInteger(value) || value < min || value > max) errors.push({ field, message: label + ': введите целое число от ' + min + ' до ' + max + '.' });
        }
        return errors;
    }
    function validateRow(row, { forSending = false } = {}) {
        // Clinical entries are free text. Numeric checks apply only to demo sampling.
        const errors = [];
        if (!validDate(row.date)) errors.push({ field: 'date', message: 'Укажите существующую дату.' });
        if (!validTime(row.time)) errors.push({ field: 'time', message: 'Укажите время в формате ЧЧ:ММ.' });
        for (const field of textFields) {
            if (typeof row[field] !== 'string' || row[field].length > TEXT_LIMIT) errors.push({ field, message: 'Текст должен содержать не более 4000 символов.' });
            if (/\{\{род:/i.test(row[field] || '')) errors.push({ field, message: 'В тексте осталась вставка рода. Выберите род текста и примените шаблон заново.' });
        }
        if (!norm(row.diary)) errors.push({ field: 'diary', message: 'Введите текст дневника.' });
        if (forSending && row.demo) errors.push({ field: 'demo', message: 'Демонстрационные измерения нельзя отправить в БАРС. Создайте рабочую запись с измеренными значениями.' });
        if (forSending && !row.reviewed) errors.push({ field: 'reviewed', message: 'Проверьте запись и подтвердите данные осмотра.' });
        return errors;
    }
    function validateQueue(rows, options) {
        if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return [{ index: 0, field: 'rows', message: 'В очереди должно быть от 1 до ' + MAX_ROWS + ' записей.' }];
        const seen = new Set();
        const errors = [];
        rows.forEach((row, index) => {
            errors.push(...validateRow(row, options).map(error => ({ ...error, index })));
            const key = row.date + ' ' + row.time;
            if (seen.has(key)) errors.push({ index, field: 'time', message: 'Две записи на одну дату и время. Измените время одной из них.' });
            seen.add(key);
        });
        return errors;
    }
    function inferGender(fullName) {
        const parts = norm(fullName).toLowerCase().split(' ');
        if (parts.length < 3) return '';
        const patronymic = parts.at(-1);
        if (/(?:овна|евна|ёвна|ична|инична)$/.test(patronymic)) return 'female';
        if (/(?:ович|евич|ёвич|ич)$/.test(patronymic)) return 'male';
        return '';
    }
    function plainVariant(profile, variant) {
        const result = clone(variant);
        const pairs = new Map((profile?.genderPairs || []).map(pair => [pair.id, pair]));
        for (const field of textFields) {
            result[field] = String(variant[field] || '').replace(/\{\{род:([1-9]\d{0,3})\}\}/g, (_, id) => {
                const pair = pairs.get(id);
                if (!pair?.male) throw new Error('В старом шаблоне нет пары слов для обозначения ' + id + '.');
                return pair.male;
            });
            if (/\{\{род:/i.test(result[field])) throw new Error('Замените повреждённое обозначение рода в старом шаблоне обычным словом.');
            if (result[field].length > TEXT_LIMIT) throw new Error('После обновления старого шаблона текст превышает 4000 символов.');
        }
        return result;
    }
    const formKey = value => norm(value).toLowerCase();
    function matchCase(source, target) {
        if (source === source.toUpperCase()) return target.toUpperCase();
        if (source === source.toLowerCase()) return target.toLowerCase();
        if (source[0] === source[0].toUpperCase() && source.slice(1) === source.slice(1).toLowerCase()) return target[0].toUpperCase() + target.slice(1);
        return target;
    }
    function renderVariant(profile, variant, gender) {
        // Read old marker-based templates as ordinary text. New templates contain words only.
        const result = plainVariant(profile, variant);
        const rules = new Map();
        for (const pair of profile?.genderPairs || []) {
            if (!pair?.male?.trim() || !pair?.female?.trim()) throw new Error('Заполните обе формы каждой пары слов.');
            for (const source of [pair.male, pair.female]) {
                const key = formKey(source);
                if (!rules.has(key)) rules.set(key, { male: new Map(), female: new Map() });
                for (const sex of ['male', 'female']) rules.get(key)[sex].set(formKey(pair[sex]), pair[sex]);
            }
        }
        if (!rules.size) return result;
        const escapeRegex = value => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
        const alternatives = [...rules.keys()].sort((a, b) => b.length - a.length)
            .map(key => key.split(/\s+/).map(escapeRegex).join('\\s+'));
        // One pass prevents replacements from triggering another pair. Unicode boundaries
        // keep Cyrillic words intact, and longer phrases take precedence over single words.
        const pattern = new RegExp('(?<![\\p{L}\\p{M}\\p{N}_])(?:' + alternatives.join('|') + ')(?![\\p{L}\\p{M}\\p{N}_])', 'giu');
        for (const field of textFields) {
            result[field] = result[field].replace(pattern, source => {
                const rule = rules.get(formKey(source));
                if (!['male', 'female'].includes(gender)) {
                    if (rule.male.size === 1 && rule.female.size === 1 && rule.male.keys().next().value === rule.female.keys().next().value) return source;
                    throw new Error('Выберите мужской или женский род текста в шапке дневников.');
                }
                const targets = rule[gender];
                if (targets.size > 1) throw new Error('Для «' + source + '» задано несколько разных замен. Уточните пары целыми фразами, например «состояние больного / состояние больной».');
                const target = targets.values().next().value;
                return formKey(source) === formKey(target) ? source : matchCase(source, target);
            });
            if (result[field].length > TEXT_LIMIT) throw new Error('После подстановки рода текст превышает 4000 символов.');
        }
        return result;
    }
    function chooseVariant(profile, previousText = '', random = Math.random, gender = '') {
        const unique = new Map();
        for (const raw of profile?.variants || []) {
            const variant = renderVariant(profile, raw, gender);
            const key = norm(variant.diary).toLowerCase();
            if (!unique.has(key)) unique.set(key, variant);
        }
        const variants = [...unique.values()];
        const previous = norm(previousText).toLowerCase();
        const eligible = variants.length > 1 ? variants.filter(v => norm(v.diary).toLowerCase() !== previous) : variants;
        return eligible.length ? clone(eligible[Math.min(eligible.length - 1, Math.floor(Math.max(0, random()) * eligible.length))]) : null;
    }
    function createRow({ defaults, previous = null, profile = null, date, time, demo = false, random, gender = '' } = {}) {
        const stamp = dateParts();
        const variant = chooseVariant(profile, previous?.diary, random, gender);
        if (profile && !variant) throw new Error('Добавьте вариант в выбранный шаблон.');
        const texts = variant || previous || {};
        return {
            id: uid(), date: date || previous?.date || stamp.date, time: time || previous?.time || stamp.time,
            vitals: { ...DEFAULTS, ...(defaults || previous?.vitals) }, diary: texts.diary || '', examination: texts.examination || '',
            treatment: texts.treatment || '', profileId: profile?.id || '', variantId: variant?.id || '',
            reviewed: false, demo: demo || !!previous?.demo, status: 'draft'
        };
    }
    function cleanSettings(raw = {}) {
        const defaults = { ...DEFAULTS, ...raw.defaults };
        for (const field of vitalFields) {
            if (typeof defaults[field] !== 'string' || defaults[field].length > 67) throw new Error('Исходные показатели: не более 67 символов в поле.');
        }
        const hourStep = Number(raw.hourStep ?? 4);
        if (!Number.isInteger(hourStep) || hourStep < 1 || hourStep > 24) throw new Error('Шаг расписания: целое число от 1 до 24 часов.');
        const spread = { ...DEFAULT_SPREAD, ...raw.spread };
        for (const key of Object.keys(SPREAD_LIMITS)) {
            spread[key] = number(spread[key]);
            if (!Number.isFinite(spread[key]) || spread[key] < 0 || spread[key] > SPREAD_LIMITS[key] || (key !== 'temperature' && !Number.isInteger(spread[key]))) throw new Error('Проверьте границы учебного разброса.');
        }
        return { defaults: Object.fromEntries(vitalFields.map(key => [key, defaults[key]])), hourStep, spread: Object.fromEntries(Object.keys(SPREAD_LIMITS).map(key => [key, spread[key]])) };
    }
    function normalSample(random = Math.random) {
        const u = Math.max(Number.EPSILON, random());
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    }
    function sampleDemo(base, spread, random = Math.random) {
        const bp = pressure(base.pressure);
        if (validateVitals(base).length) throw new Error('Сначала исправьте исходные показатели.');
        const limits = SPREAD_LIMITS;
        for (const key of Object.keys(limits)) {
            if (!Number.isFinite(Number(spread[key])) || Number(spread[key]) < 0 || Number(spread[key]) > limits[key]) throw new Error('Недопустимый интервал разброса.');
        }
        const draw = (mean, range, digits = 0) => {
            const delta = Math.max(-range, Math.min(range, normalSample(random) * range / 3));
            return Number((mean + delta).toFixed(digits));
        };
        for (let attempt = 0; attempt < 50; attempt++) {
            const values = {
                temperature: String(draw(number(base.temperature), Number(spread.temperature), 1)).replace('.', ','),
                pressure: draw(bp[0], Number(spread.systolic)) + '/' + draw(bp[1], Number(spread.diastolic)),
                pulse: String(draw(number(base.pulse), Number(spread.pulse))),
                respiration: String(draw(number(base.respiration), Number(spread.respiration)))
            };
            if (!validateVitals(values).length) return values;
        }
        return clone(base);
    }
    function cleanLibrary(data) {
        if (!data || data.type !== 'fillbars-card-templates' || ![1, 2, VERSION].includes(data.version) || !Array.isArray(data.profiles) || data.profiles.length > 200) throw new Error('Нужен файл шаблонов FillBARS Card версии 1, 2 или 3 (до 200 заболеваний).');
        const ids = new Set();
        return { type: data.type, version: VERSION, profiles: data.profiles.map(raw => {
            if (!raw || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 120 || !Array.isArray(raw.variants) || raw.variants.length > 200) throw new Error('Проверьте названия заболеваний и список вариантов.');
            const id = typeof raw.id === 'string' && raw.id.length < 100 && !ids.has(raw.id) ? raw.id : uid();
            ids.add(id);
            const variantIds = new Set();
            const pairIds = new Set();
            if (raw.genderPairs !== undefined && (!Array.isArray(raw.genderPairs) || raw.genderPairs.length > 50)) throw new Error('В шаблоне допустимо до 50 пар слов.');
            const genderPairs = (raw.genderPairs || []).map(pair => {
                if (!pair || typeof pair.id !== 'string' || !/^[1-9]\d{0,3}$/.test(pair.id) || pairIds.has(pair.id)) throw new Error('Неверные или повторяющиеся номера пар слов.');
                if (['male', 'female'].some(key => typeof pair[key] !== 'string' || !pair[key].trim() || pair[key].length > 120 || /\{\{род:/i.test(pair[key]))) throw new Error('Заполните мужскую и женскую форму каждой пары (до 120 символов).');
                pairIds.add(pair.id);
                return { id: pair.id, male: pair.male.trim(), female: pair.female.trim() };
            });
            return { id, name: raw.name.trim(), genderPairs, variants: raw.variants.map(v => {
                if (!v || textFields.some(f => typeof v[f] !== 'string' || v[f].length > TEXT_LIMIT)) throw new Error('Каждый вариант должен содержать три текста до 4000 символов.');
                const plain = plainVariant({ genderPairs }, v);
                const variantId = typeof v.id === 'string' && v.id.length < 100 && !variantIds.has(v.id) ? v.id : uid();
                variantIds.add(variantId);
                return { id: variantId, title: typeof v.title === 'string' ? v.title.slice(0, 120) : 'Вариант', diary: plain.diary, examination: plain.examination, treatment: plain.treatment };
            }) };
        }) };
    }
    function emptyLibrary() { return { type: 'fillbars-card-templates', version: VERSION, profiles: [] }; }
    function fields(row) {
        return { VISIT_DATE: barsDate(row.date), VISIT_TIME: row.time, TEMPERATURE: String(row.vitals?.temperature ?? ''), AD: String(row.vitals?.pressure ?? ''), THSS: String(row.vitals?.pulse ?? ''), THD: String(row.vitals?.respiration ?? ''), S_DNEVNIK: row.diary, STAC_PLAN: row.examination, RECOMEND_CONS: row.treatment };
    }
    const api = { VERSION, TEXT_LIMIT, MAX_ROWS, DEFAULTS, DEFAULT_SPREAD, textFields, vitalFields, uid, clone, norm, dateParts, validDate, validTime, barsDate, pressure, number, validateVitals, validateRow, validateQueue, inferGender, renderVariant, chooseVariant, createRow, sampleDemo, cleanSettings, cleanLibrary, emptyLibrary, fields };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.FillBARSCardCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
