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
        // Entries are free text. Numeric checks apply only to simulated vital sampling.
        const errors = [];
        if (!validDate(row.date)) errors.push({ field: 'date', message: 'Укажите существующую дату.' });
        if (!validTime(row.time)) errors.push({ field: 'time', message: 'Укажите время в формате ЧЧ:ММ.' });
        for (const field of textFields) {
            if (typeof row[field] !== 'string' || row[field].length > TEXT_LIMIT) errors.push({ field, message: 'Текст должен содержать не более 4000 символов.' });
            if (/\{\{род:/i.test(row[field] || '')) errors.push({ field, message: 'В тексте осталась вставка рода. Выберите род текста и примените шаблон заново.' });
        }
        if (!norm(row.diary)) errors.push({ field: 'diary', message: 'Введите текст дневника.' });
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
    function createRow({ defaults, previous = null, profile = null, date, time, autoPick = false, spread = DEFAULT_SPREAD, random, gender = '' } = {}) {
        const stamp = dateParts();
        const variant = chooseVariant(profile, previous?.diary, random, gender);
        if (profile && !variant) throw new Error('Добавьте вариант в выбранный шаблон.');
        const texts = variant || previous || {};
        return {
            id: uid(), date: date || previous?.date || stamp.date, time: time || previous?.time || stamp.time,
            vitals: autoPick ? sampleVitals({ ...DEFAULTS, ...(previous?.vitals || defaults) }, spread, random) : { ...DEFAULTS, ...(previous?.vitals || defaults) }, diary: texts.diary || '', examination: texts.examination || '',
            treatment: texts.treatment || '', profileId: profile?.id || '', variantId: variant?.id || '',
            reviewed: false, status: 'draft'
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
            if (!Number.isFinite(spread[key]) || spread[key] < 0 || spread[key] > SPREAD_LIMITS[key] || (key !== 'temperature' && !Number.isInteger(spread[key]))) throw new Error('Проверьте границы разброса показателей.');
        }
        const autoPick = raw.autoPick === true;
        if (autoPick && validateVitals(defaults).length) throw new Error('Для автоматического подбора задайте числовые исходные показатели.');
        return { defaults: Object.fromEntries(vitalFields.map(key => [key, defaults[key]])), hourStep, autoPick, verifyAfterSave: raw.verifyAfterSave === true, spread: Object.fromEntries(Object.keys(SPREAD_LIMITS).map(key => [key, spread[key]])) };
    }
    function normalSample(random = Math.random) {
        const u = Math.max(Number.EPSILON, random());
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    }
    function sampleVitals(base, spread, random = Math.random) {
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
    function renalColicHistoryTemplate() {
        const entry = (title, days, diary) => ({ id: uid(), title, offsetMinutes: days * 1440, diary, examination: '', treatment: '' });
        const common = 'Состояние пациента удовлетворительное.\nЖалобы: нет.\nКожные покровы обычной окраски.\nДыхание в лёгких везикулярное, хрипов нет.\nТоны сердца ритмичные, приглушённые.\nЖивот при пальпации мягкий, безболезненный. Перитонеальных симптомов нет. ';
        const conclusion = '\nФизиологические отправления в норме. Динамика положительная.';
        const recovered = common + 'Симптом поколачивания отрицательный с двух сторон.' + conclusion;
        return { id: 'renal-colic-history-v1', name: 'Почечная колика', side: 'left', entries: [
            entry('Дневник — боли в пояснице', 0, 'Состояние пациента удовлетворительное.\nЖалобы: умеренные тянущие боли в пояснице слева.\nКожные покровы обычной окраски.\nДыхание в лёгких везикулярное, хрипов нет.\nТоны сердца ритмичные, приглушённые.\nЖивот при пальпации мягкий, болезненный в проекции левой почки. Перитонеальных симптомов нет. Симптом поколачивания слабо положительный слева.' + conclusion + '\n\nОбоснование клинического диагноза: диагноз установлен на основании жалоб на боли в пояснице слева, анамнеза (острое начало заболевания), объективного статуса, динамического наблюдения и рентгенологических данных.\nДиагноз: мочекаменная болезнь. Камень левой почки. Почечная колика слева.'),
            entry('Дневник — жалоб нет', 1, common + 'Симптом поколачивания слабо положительный слева.' + conclusion),
            entry('Обход заведующего', 2, recovered),
            entry('Контрольный дневник', 5, recovered),
            entry('Повторный контроль', 7, recovered),
            entry('Дневник в динамике', 9, recovered)
        ] };
    }
    const sidePairs = [['слева', 'справа'], ['левее', 'правее']];
    for (const ending of ['ый', 'ая', 'ое', 'ые', 'ого', 'ой', 'ому', 'ую', 'ым', 'ом', 'ых', 'ыми']) sidePairs.push(['лев' + ending, 'прав' + ending]);
    for (const ending of ['ий', 'яя', 'ее', 'ие', 'его', 'ей', 'ему', 'юю', 'им', 'ем', 'их', 'ими']) sidePairs.push(['левосторонн' + ending, 'правосторонн' + ending]);
    const sideWords = new Map(sidePairs.flatMap(([left, right]) => [[left, right], [right, left]]));
    const sidePattern = new RegExp('(?<![\\p{L}\\p{M}\\p{N}_])(?:' + [...sideWords.keys()].sort((a,b) => b.length - a.length).join('|') + ')(?![\\p{L}\\p{M}\\p{N}_])', 'giu');
    function switchSideTexts(record) {
        const result = clone(record);
        // Swap both sides in one pass, preserving contralateral descriptions and case.
        for (const field of [...textFields, 'title']) {
            if (typeof result[field] !== 'string') continue;
            result[field] = result[field].replace(sidePattern, source => matchCase(source, sideWords.get(source.toLowerCase())));
            if (result[field].length > (field === 'title' ? 120 : TEXT_LIMIT)) throw new Error('После смены стороны текст превышает допустимую длину. Сократите текст.');
        }
        return result;
    }
    function changeHistorySide(template, side) {
        if (!['left', 'right'].includes(template?.side) || !['left', 'right'].includes(side)) throw new Error('Выберите сторону: слева или справа.');
        return { ...clone(template), side, entries: template.entries.map(entry => side === template.side ? clone(entry) : switchSideTexts(entry)) };
    }
    function starterHistoryLibrary() {
        const entry = (title, offsetMinutes, diary, examination = '', treatment = '') => ({ id: uid(), title, offsetMinutes, diary, examination, treatment });
        // Clinical wording is from the supplied four-diary sample. Patient identity,
        // observation dates and measured vitals must never become reusable defaults.
        const examinationText = 'Состояние пациента удовлетворительное . Жалобы: нет Кожные покровы обычной окраски. тургор кожи обычный. Дыхание в лёгких: везикулярное, хрипов нет. Тоны сердца громкие, ритмичные, ясные. Живот при пальпации: мягкий, безболезненный. Симптомов раздражения брюшины нет. Стул без крови. Мочеиспускание свободное.\nДанных за рецидив кровотечения нет.';
        return { type: 'fillbars-card-history-templates', version: 1, builtinRevision: 1, templates: [{
            id: uid(), name: 'ЖКК на колоноскопию', entries: [
                entry('Первичный осмотр', 0, examinationText + ' Готовиться на колоноскопию.', '-колоноскопия'),
                entry('После колоноскопии', 985, examinationText + ' На колоноскопии хронический внутренний геморрой 2 ст.', '-', 'гемостатическая терапия'),
                entry('Контрольный осмотр', 2425, examinationText, '-'),
                entry('Повторный контроль', 3865, examinationText, '-')
            ]
        }, renalColicHistoryTemplate()] };
    }
    function upgradeStarterHistoryLibrary(raw) {
        const library = cleanHistoryLibrary(raw);
        // Only replace the untouched starter from 5.2.14/5.2.15. A clinician's
        // edits, including a change to just one field, always take precedence.
        const legacy = [
            ['Первичный осмотр', 0, 'Осмотр перед колоноскопией. Жалобы: [уточнить]. Общее состояние и данные осмотра: [уточнить]. Стул и признаки повторного кровотечения: [уточнить].', 'Колоноскопия по показаниям; уточнить подготовку и результаты обследования.', 'Лечение и рекомендации: [уточнить по назначению врача].'],
            ['После колоноскопии', 985, 'Осмотр после колоноскопии. Жалобы и общее состояние: [уточнить]. Результат колоноскопии: [внести из протокола]. Стул и признаки кровотечения: [уточнить].', 'Оценить результат колоноскопии и динамику состояния.', 'Коррекция лечения: [уточнить].'],
            ['Контрольный осмотр', 2425, 'Контрольный осмотр. Жалобы, общее состояние, живот, стул и признаки кровотечения: [уточнить по фактическому осмотру].', 'Дальнейшее обследование: [уточнить].', 'Продолжение лечения: [уточнить].'],
            ['Повторный контроль', 3865, 'Повторный контрольный осмотр. Динамика состояния, жалобы, данные осмотра и стул: [уточнить по фактическому осмотру].', 'Дальнейшее обследование: [уточнить].', 'Рекомендации: [уточнить].']
        ];
        const replacement = starterHistoryLibrary().templates[0];
        for (const template of library.templates) {
            if (template.name !== replacement.name || template.entries.length !== legacy.length) continue;
            const untouched = template.entries.every((item, index) => [item.title, item.offsetMinutes, ...textFields.map(field => item[field])].every((value, fieldIndex) => value === legacy[index][fieldIndex]));
            if (untouched) template.entries = replacement.entries.map((item, index) => ({ ...item, vitals: { ...template.entries[index].vitals }, id: template.entries[index].id }));
        }
        if (library.builtinRevision < 1 && library.templates.length < 50) {
            if (!library.templates.some(template => template.id === 'renal-colic-history-v1' || template.name === 'Почечная колика')) library.templates.push(renalColicHistoryTemplate());
            library.builtinRevision = 1;
        }
        return library;
    }
    function cleanHistoryLibrary(raw) {
        if (!raw || raw.type !== 'fillbars-card-history-templates' || raw.version !== 1 || !Array.isArray(raw.templates) || raw.templates.length > 50) throw new Error('Неверная библиотека шаблонов истории.');
        const ids = new Set();
        return { type: raw.type, version: 1, builtinRevision: raw.builtinRevision === 1 ? 1 : 0, templates: raw.templates.map(template => {
            if (!template || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 120 || !Array.isArray(template.entries) || !template.entries.length || template.entries.length > MAX_ROWS) throw new Error('Укажите название и от 1 до 48 дневников шаблона истории.');
            const id = typeof template.id === 'string' && template.id.length < 100 && !ids.has(template.id) ? template.id : uid(); ids.add(id);
            const entryIds = new Set();
            if (template.side !== undefined && !['left', 'right'].includes(template.side)) throw new Error('Неверная сторона шаблона истории.');
            return { id, name: template.name.trim(), ...(template.side ? { side: template.side } : {}), entries: template.entries.map((entry, index) => {
                if (!entry || typeof entry.title !== 'string' || entry.title.length > 120 || !Number.isInteger(entry.offsetMinutes) || entry.offsetMinutes < 0 || entry.offsetMinutes > 60 * 24 * 60 || textFields.some(field => typeof entry[field] !== 'string' || entry[field].length > TEXT_LIMIT)) throw new Error('Проверьте тексты и смещения дневников истории (от 0 до 60 суток).');
                if (index && entry.offsetMinutes <= template.entries[index - 1].offsetMinutes) throw new Error('Дневники шаблона истории должны идти по возрастанию даты и времени.');
                const entryId = typeof entry.id === 'string' && entry.id.length < 100 && !entryIds.has(entry.id) ? entry.id : uid(); entryIds.add(entryId);
                if (entry.vitals !== undefined && (!entry.vitals || typeof entry.vitals !== 'object' || Array.isArray(entry.vitals))) throw new Error('Проверьте показатели дневника истории.');
                const vitals = Object.fromEntries(vitalFields.map(field => {
                    const value = entry.vitals?.[field] ?? '';
                    if (typeof value !== 'string' || value.length > 67) throw new Error('Показатели дневника истории: не более 67 символов в каждом поле.');
                    return [field, value];
                }));
                return { id: entryId, title: entry.title.trim(), offsetMinutes: entry.offsetMinutes, vitals, diary: entry.diary, examination: entry.examination, treatment: entry.treatment };
            }) };
        }) };
    }
    function instantiateHistoryTemplate(template, firstDate, firstTime) {
        if (!validDate(firstDate) || !validTime(firstTime)) throw new Error('Укажите дату и время первого дневника.');
        const checked = cleanHistoryLibrary({ type: 'fillbars-card-history-templates', version: 1, templates: [template] }).templates[0];
        const [year, month, day] = firstDate.split('-').map(Number), [hour, minute] = firstTime.split(':').map(Number);
        const first = new Date(year, month - 1, day, hour, minute);
        return checked.entries.map(entry => {
            const stamp = dateParts(new Date(first.getTime() + entry.offsetMinutes * 60000));
            return { ...createRow({ date: stamp.date, time: stamp.time }), vitals: { ...entry.vitals }, diary: entry.diary, examination: entry.examination, treatment: entry.treatment, reviewed: false, status: 'draft' };
        });
    }
    function fields(row) {
        return { VISIT_DATE: barsDate(row.date), VISIT_TIME: row.time, TEMPERATURE: String(row.vitals?.temperature ?? ''), AD: String(row.vitals?.pressure ?? ''), THSS: String(row.vitals?.pulse ?? ''), THD: String(row.vitals?.respiration ?? ''), S_DNEVNIK: row.diary, STAC_PLAN: row.examination, RECOMEND_CONS: row.treatment };
    }
    function comparisonSnapshot(row) {
        return { ...Object.fromEntries(textFields.map(field => [field, String(row?.[field] || '')])), vitals: Object.fromEntries(vitalFields.map(field => [field, String(row?.vitals?.[field] || '')])) };
    }
    function diffText(before, after) {
        const tokenize = text => String(text || '').match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
        const a = tokenize(before), b = tokenize(after), result = [];
        const push = (type, text) => { if (!text) return; const last = result.at(-1); if (last?.type === type) last.text += text; else result.push({ type, text }); };
        // Bound work for pathological 4000-character edits. The fallback marks the
        // whole middle as changed, never inventing an inherited segment.
        if (a.length * b.length > 250000) {
            let start = 0, end = 0;
            while (start < a.length && start < b.length && a[start] === b[start]) start++;
            while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
            push('equal', a.slice(0, start).join(''));
            push('removed', a.slice(start, a.length - end).join(''));
            push('added', b.slice(start, b.length - end).join(''));
            push('equal', a.slice(a.length - end).join(''));
            return result;
        }
        const width = b.length + 1, table = new Uint16Array((a.length + 1) * width);
        for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * width + j] = a[i] === b[j] ? 1 + table[(i + 1) * width + j + 1] : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        let i = 0, j = 0;
        while (i < a.length || j < b.length) {
            if (i < a.length && j < b.length && a[i] === b[j]) { push('equal', a[i]); i++; j++; }
            else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) push('removed', a[i++]);
            else push('added', b[j++]);
        }
        return result;
    }
    const api = { VERSION, TEXT_LIMIT, MAX_ROWS, DEFAULTS, DEFAULT_SPREAD, textFields, vitalFields, uid, clone, norm, dateParts, validDate, validTime, barsDate, pressure, number, validateVitals, validateRow, validateQueue, inferGender, renderVariant, chooseVariant, createRow, sampleVitals, cleanSettings, cleanLibrary, emptyLibrary, starterHistoryLibrary, upgradeStarterHistoryLibrary, cleanHistoryLibrary, instantiateHistoryTemplate, renalColicHistoryTemplate, switchSideTexts, changeHistorySide, comparisonSnapshot, diffText, fields };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.FillBARSCardCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
