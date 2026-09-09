(async function () {
    'use strict';
    const C = window.FillBARSCardCore;
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const params = new URLSearchParams(location.search);
    let tabId = Number(params.get('tab'));
    if (params.has('preview') && ['127.0.0.1', 'localhost'].includes(location.hostname)) await import('./tests/card-preview-host.js');
    async function request(action, data = {}) {
        const message = { namespace: 'fillbars-card-v1', tabId, contextId: state?.contextId, action, ...data };
        const response = window.cardPreviewRequest ? await window.cardPreviewRequest(message) : await chrome.runtime.sendMessage(message);
        if (!response?.ok) throw new Error(response?.error || 'Расширение не ответило. Откройте окно дневников заново.');
        return response;
    }
    let library = C.emptyLibrary();
    let settings = C.cleanSettings();
    let state = null;
    const newDraft = () => ({ rows: [C.createRow({ defaults: settings.defaults, autoPick: settings.autoPick, spread: settings.spread })], defaults: { ...settings.defaults }, profileId: '', hourStep: settings.hourStep, gender: 'auto' });
    let draft = newDraft();
    let selected = draft.rows[0].id;
    let saveTimer;
    let saveChain = Promise.resolve();
    let busy = false;
    let polling = false;
    let editLibrary = null;
    let editProfileId = '';
    let editVariantIndex = 0;
    let templatesDirty = false;
    let settingsSaving = false;
    let lastRunVersion = '';
    let connected = false;
    let contextRevision = 0;
    let finishInitialization;
    const initialized = new Promise(resolve => { finishInitialization = resolve; });
    let sourceOperations = Promise.resolve();
    const row = () => draft.rows.find(item => item.id === selected) || draft.rows[0];
    const running = () => state?.run?.status === 'running';
    const unresolved = () => ['uncertain', 'interrupted'].includes(state?.run?.status);
    const locked = () => busy || running() || unresolved();
    const textGender = () => ['male', 'female'].includes(draft.gender) ? draft.gender : C.inferGender(state?.patient?.fullName);
    function message(text, error = false) {
        $('message').hidden = !text;
        $('message').textContent = text;
        $('message').classList.toggle('errors', error);
    }
    function saveDraft() {
        clearTimeout(saveTimer);
        const copy = C.clone(draft);
        const destination = { tabId, contextId: state?.contextId };
        saveChain = saveChain.catch(() => undefined).then(() => request('draft', { draft: copy, ...destination }));
        return saveChain;
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveDraft().catch(error => message('Не удалось сохранить черновик: ' + error.message, true)), 350);
    }
    function resetErrors() {
        $('errors').hidden = true;
        document.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
        document.querySelectorAll('.inline-error').forEach(el => el.remove());
    }
    function showErrors(errors) {
        resetErrors();
        const chosen = errors[0]?.index;
        if (Number.isInteger(chosen) && draft.rows[chosen]) { selected = draft.rows[chosen].id; render(); }
        const list = document.createElement('ul');
        errors.forEach(error => {
            const li = document.createElement('li');
            const button = document.createElement('button');
            button.className = 'text-button danger-text';
            button.textContent = (Number.isInteger(error.index) ? 'Запись ' + (error.index + 1) + ': ' : '') + error.message;
            button.addEventListener('click', () => {
                if (Number.isInteger(error.index)) { selected = draft.rows[error.index].id; render(); }
                $(error.field)?.focus();
            });
            li.append(button); list.append(li);
            if ((!Number.isInteger(error.index) || error.index === chosen) && $(error.field)) {
                $(error.field).setAttribute('aria-invalid', 'true');
                const detail = document.createElement('span');
                detail.className = 'inline-error';
                detail.textContent = error.message;
                $(error.field).insertAdjacentElement('afterend', detail);
            }
        });
        $('errors').replaceChildren(document.createTextNode('Проверьте данные перед отправкой:'), list);
        $('errors').hidden = false;
        $('errors').focus();
    }
    function renderProfiles() {
        $('profile').replaceChildren(new Option('Без шаблона', ''), ...library.profiles.map(profile => new Option(profile.name, profile.id)));
        $('profile').value = row().profileId || '';
        $('profileHint').textContent = row().profileId ? 'Новое время получит другой вариант этого шаблона.' : 'Без шаблона новое время копирует тексты выбранной записи.';
        $('profileHint').textContent += settings.autoPick ? ' Показатели подбираются от последней записи.' : ' Показатели наследуются из последней записи.';
    }
    function renderList() {
        $('rowCount').textContent = draft.rows.length;
        $('rowList').replaceChildren(...draft.rows.map((item, index) => {
            const button = document.createElement('button');
            button.className = 'schedule-item';
            button.type = 'button';
            button.setAttribute('aria-current', String(item.id === selected));
            const status = item.status === 'saved' ? 'Сохранён' : item.reviewed ? 'Проверен' : '';
            button.innerHTML = '<span class="row-number">' + String(index + 1).padStart(2, '0') + '</span><span><span class="row-time">' + escape(item.time || '—:—') + '</span><span class="row-date">' + escape(C.barsDate(item.date) || 'Без даты') + '</span></span><span class="row-status">' + status + '</span>';
            button.addEventListener('click', () => { selected = item.id; resetErrors(); render(); });
            return button;
        }));
    }
    function renderRun() {
        const run = state?.run;
        $('runPanel').hidden = !run;
        if (!run) return;
        const titles = { running: 'Отправка в БАРС', done: 'Готово', filled: 'Форма заполнена', failed: 'Очередь остановлена', uncertain: 'Нужно проверить результат в БАРС', interrupted: 'Работа прервалась', stopped: 'Остановлено' };
        $('runTitle').textContent = titles[run.status] || 'Состояние очереди';
        $('runMessage').textContent = run.message || '';
        $('runProgress').max = run.rows?.length || 1;
        $('runProgress').value = run.results?.length || 0;
        $('stop').hidden = !running();
        $('resolveRun').hidden = !unresolved();
        $('resolveRun').disabled = busy;
        $('discardRun').hidden = !unresolved();
        $('discardRun').disabled = busy;
        $('runRecovery').hidden = !unresolved();
        const current = run.rows?.[run.index || 0];
        const pending = (run.rows || []).filter(item => !run.results?.some(result => result.rowId === item.id));
        const confirming = run.phase === 'saving';
        if (confirming && current) {
            const remaining = pending.filter(item => item.id !== current.id).length;
            $('runRecovery').textContent = 'Проверьте в БАРС запись ' + ((run.index || 0) + 1) + ' за ' + C.barsDate(current.date) + ' в ' + current.time + '. Если она сохранена, подтвердите кнопкой ниже. ' + (remaining ? 'Затем отправятся остальные записи: ' + remaining + '. Текущая повторно не отправится.' : 'Это последняя запись. Подтверждение завершит очередь.') + ' Черновики останутся в окне.';
            $('resolveRun').textContent = remaining ? 'Запись сохранена — продолжить' : 'Запись сохранена — завершить';
        } else {
            $('runRecovery').textContent = 'Подтверждено записей: ' + (run.results?.length || 0) + '. Осталось: ' + pending.length + '. Продолжение пропустит уже сохранённые записи.';
            $('resolveRun').textContent = run.fillOnly ? 'Продолжить заполнение без сохранения' : pending.length ? 'Продолжить оставшиеся записи' : 'Завершить очередь';
        }
        $('runDiagnostics').hidden = !run.trace?.length;
        $('runLog').textContent = (run.trace || []).map(entry => {
            const { time, stage, row: rowNumber, ...details } = entry;
            return [time, 'Запись ' + rowNumber, stage, Object.keys(details).length ? JSON.stringify(details) : ''].filter(Boolean).join(' · ');
        }).join('\n');
    }
    $('downloadRunLog').addEventListener('click', () => {
        const run = state?.run;
        if (!run?.trace?.length) return;
        // Export technical events only; never export patient identity, rows or their texts.
        const data = { format: 'fillbars-card-log-v1', version: window.chrome?.runtime?.getManifest?.().version || 'preview', status: run.status, phase: run.phase, code: run.code || '', events: run.trace };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'fillbars-card-log.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    function render() {
        if (!draft.rows.length) { draft.rows.push(C.createRow({ defaults: settings.defaults, autoPick: settings.autoPick, spread: settings.spread })); selected = draft.rows[0].id; }
        const current = row();
        selected = current.id;
        renderProfiles(); renderList(); renderRun();
        const patient = connected || running() || unresolved() ? state?.patient : null;
        $('patientName').textContent = patient?.fullName || (busy ? 'Определяем пациента…' : 'Карточка не найдена');
        $('patientDetails').textContent = patient ? 'Дата рождения: ' + patient.birth + ' · История болезни: ' + patient.history : 'Откройте карточку БАРС и нажмите «Дневники» в расширении.';
        const inferred = C.inferGender(patient?.fullName);
        $('textGender').options[0].textContent = 'Авто: ' + (inferred === 'male' ? 'мужской' : inferred === 'female' ? 'женский' : 'не определён');
        $('textGender').value = draft.gender || 'auto';
        $('textGender').disabled = locked();
        $('genderHint').textContent = (draft.gender && draft.gender !== 'auto' ? 'Выбран вручную.' : inferred ? 'Определён по отчеству; можно изменить.' : 'При необходимости выберите род вручную.') + ' Для следующего выбора шаблона.';
        $('editorTitle').textContent = 'Запись ' + (draft.rows.indexOf(current) + 1);
        for (const field of ['date', 'time', ...C.textFields]) $(field).value = current[field];
        for (const field of C.vitalFields) $(field).value = current.vitals[field];
        $('reviewed').checked = !!current.reviewed;
        $('hourStep').value = draft.hourStep || 4;
        $('rowBadge').textContent = current.status === 'saved' ? 'Сохранена' : current.reviewed ? 'Проверена' : 'Черновик';
        $('rowBadge').className = 'badge' + (current.reviewed || current.status === 'saved' ? ' ready' : '');
        const profile = library.profiles.find(item => item.id === current.profileId);
        const variant = profile?.variants.find(item => item.id === current.variantId);
        $('variantLabel').textContent = profile ? profile.name + (variant ? ' · ' + variant.title : '') : 'Свободный текст';
        const readOnly = locked() || current.status === 'saved';
        $('rowFields').disabled = readOnly;
        $('reviewed').disabled = readOnly;
        for (const id of ['addTime', 'addDay', 'profile', 'hourStep', 'clearDraft']) $(id).disabled = locked();
        $('profile').disabled = readOnly;
        $('anotherVitals').disabled = readOnly;
        $('deleteRow').disabled = locked() || current.status === 'saved';
        $('anotherVariant').disabled = readOnly || !(library.profiles.find(p => p.id === current.profileId)?.variants.length);
        $('fillOnly').disabled = locked() || !connected || !state?.patient || current.status === 'saved';
        $('sendAll').disabled = locked() || !connected || !state?.patient || !draft.rows.some(item => item.status !== 'saved');
        $('readyCount').textContent = 'Проверено ' + draft.rows.filter(item => item.reviewed).length + ' из ' + draft.rows.length;
        for (const field of C.textFields) $(field + 'Count').textContent = current[field].length + ' / 4000';
    }
    for (const field of ['date', 'time', ...C.vitalFields, ...C.textFields]) {
        $(field).addEventListener('input', () => {
            const current = row();
            if (locked() || current.status === 'saved') return;
            if (C.vitalFields.includes(field)) {
                current.vitals[field] = $(field).value;
                draft.defaults[field] = $(field).value;
            } else current[field] = $(field).value;
            current.reviewed = false;
            $('reviewed').checked = false;
            $('rowBadge').textContent = 'Черновик';
            $('rowBadge').className = 'badge';
            renderList();
            $('readyCount').textContent = 'Проверено ' + draft.rows.filter(item => item.reviewed).length + ' из ' + draft.rows.length;
            for (const name of C.textFields) $(name + 'Count').textContent = current[name].length + ' / 4000';
            $(field).removeAttribute('aria-invalid');
            if ($(field).nextElementSibling?.classList.contains('inline-error')) $(field).nextElementSibling.remove();
            scheduleSave();
        });
    }
    $('reviewed').addEventListener('change', () => {
        if (locked()) return;
        if ($('reviewed').checked) {
            const errors = C.validateRow(row());
            if (errors.length) { $('reviewed').checked = false; showErrors(errors); return; }
        }
        resetErrors();
        row().reviewed = $('reviewed').checked; render(); scheduleSave();
    });
    function applyVariant(profileId = row().profileId) {
        if (locked() || row().status === 'saved') return;
        const profile = library.profiles.find(item => item.id === profileId);
        if (!profile?.variants.length) return message('Добавьте вариант в библиотеке шаблонов.');
        const current = row();
        const index = draft.rows.indexOf(current);
        const neighbours = [draft.rows[index - 1]?.diary, draft.rows[index + 1]?.diary].filter(Boolean).map(value => C.norm(value).toLowerCase());
        let variants;
        try { variants = profile.variants.map(variant => C.renderVariant(profile, variant, textGender())); }
        catch (error) { render(); return message(error.message, true); }
        const differentTexts = new Set(variants.map(v => C.norm(v.diary).toLowerCase())).size;
        const eligible = differentTexts > 1 ? variants.filter(v => !neighbours.includes(C.norm(v.diary).toLowerCase())) : variants;
        const alternatives = eligible.filter(v => C.norm(v.diary).toLowerCase() !== C.norm(current.diary).toLowerCase());
        const variant = C.chooseVariant({ variants: alternatives.length ? alternatives : eligible });
        if (!variant) return message('Для этой позиции нет варианта, отличающегося от соседних записей.');
        if (current.profileId === profile.id && C.textFields.every(field => current[field] === variant[field])) return message('Другого варианта без повторения соседних дневников сейчас нет.');
        Object.assign(current, { diary: variant.diary, examination: variant.examination, treatment: variant.treatment, profileId: profile.id, variantId: variant.id, reviewed: false });
        draft.profileId = profile.id;
        render(); scheduleSave(); message('Шаблон применён к выбранной записи. Проверьте текст перед отправкой.');
    }
    $('profile').addEventListener('change', () => {
        if (locked() || row().status === 'saved') return;
        const profileId = $('profile').value;
        if (profileId) { applyVariant(profileId); render(); }
        else { Object.assign(row(), { profileId: '', variantId: '' }); draft.profileId = ''; render(); scheduleSave(); }
    });
    $('anotherVariant').addEventListener('click', () => applyVariant());
    $('anotherVitals').addEventListener('click', () => {
        if (locked() || row().status === 'saved') return;
        try {
            const vitals = C.sampleVitals(row().vitals, settings.spread);
            Object.assign(row(), { vitals, reviewed: false });
            resetErrors(); render(); scheduleSave();
            message('Показатели подобраны. Проверьте запись перед отправкой.');
        } catch (error) { message(error.message, true); }
    });
    $('textGender').addEventListener('change', () => {
        if (locked()) return;
        draft.gender = $('textGender').value; render(); scheduleSave();
        message('Род будет учтён при следующем выборе шаблона. Уже подготовленные тексты сохранены.');
    });
    $('hourStep').addEventListener('change', () => { draft.hourStep = Math.max(1, Math.min(24, Number($('hourStep').value) || 4)); $('hourStep').value = draft.hourStep; scheduleSave(); });
    function addRow({ nextDay = false } = {}) {
        if (locked()) return;
        if (draft.rows.length >= C.MAX_ROWS) return message('В одной очереди не более ' + C.MAX_ROWS + ' записей.', true);
        const previous = draft.rows.at(-1);
        const source = row();
        let stamp = C.dateParts();
        if (C.validDate(previous.date) && C.validTime(previous.time)) {
            const next = new Date(previous.date + 'T' + previous.time);
            if (nextDay) next.setDate(next.getDate() + 1);
            else next.setHours(next.getHours() + draft.hourStep);
            stamp = C.dateParts(next);
        }
        const profile = library.profiles.find(item => item.id === source.profileId);
        let entry;
        try {
            entry = C.createRow({ previous: source, profile, ...stamp, gender: textGender() });
            if (profile && previous !== source) {
                const variant = C.chooseVariant(profile, previous.diary, Math.random, textGender());
                Object.assign(entry, Object.fromEntries(C.textFields.map(field => [field, variant[field]])), { variantId: variant.id });
            }
            entry.vitals = settings.autoPick ? C.sampleVitals(previous.vitals, settings.spread) : { ...previous.vitals };
        } catch (error) { return message(error.message, true); }
        draft.rows.push(entry); selected = entry.id; resetErrors(); render(); scheduleSave();
        return true;
    }
    $('addTime').addEventListener('click', () => addRow());
    $('addDay').addEventListener('click', () => addRow({ nextDay: true }));
    $('deleteRow').addEventListener('click', () => {
        if (locked() || row().status === 'saved') return;
        if (row().diary && !confirm('Удалить эту запись из черновика? Записи БАРС это действие не затрагивает.')) return;
        const index = draft.rows.indexOf(row());
        draft.rows.splice(index, 1); selected = draft.rows[Math.max(0, index - 1)]?.id;
        resetErrors(); render(); scheduleSave();
    });
    async function connect() {
        if (busy || running() || unresolved()) return;
        contextRevision++;
        const wasConnected = connected;
        busy = true; connected = false; render(); resetErrors(); message('');
        try {
            if (wasConnected) await saveDraft();
            const response = await request('connect');
            state = response.state;
            connected = !!state?.patient;
            lastRunVersion = state?.run?.id + ':' + state?.run?.updatedAt + ':' + state?.run?.status;
            if (state.draft) draft = state.draft;
            else { draft = newDraft(); selected = draft.rows[0].id; }
            await saveDraft();
        } catch (error) { message(error.message, true); }
        finally { busy = false; render(); }
    }
    async function selectSource(sourceTabId) {
        if (!Number.isInteger(sourceTabId) || sourceTabId < 0) throw new Error('Не выбрана вкладка БАРС.');
        if (running() || unresolved() || busy) {
            if (sourceTabId !== tabId) message('Сначала завершите текущую очередь. В окне остаётся пациент этой очереди.');
            return { retained: true };
        }
        if (sourceTabId !== tabId) {
            contextRevision++;
            busy = true; render();
            try {
                // Flush the old patient's draft before changing the destination of messages.
                if (connected) await saveDraft();
                const loaded = await request('load', { tabId: sourceTabId });
                tabId = sourceTabId;
                history.replaceState(null, '', '?tab=' + tabId);
                state = loaded.state; library = C.cleanLibrary(loaded.library); settings = C.cleanSettings(loaded.settings); connected = false;
                lastRunVersion = state?.run?.id + ':' + state?.run?.updatedAt + ':' + state?.run?.status;
                draft = state?.draft?.rows?.length ? state.draft : newDraft();
                selected = draft.rows[0].id;
            } finally { busy = false; render(); }
        }
        await connect();
        return { connected };
    }
    window.chrome?.runtime?.onMessage?.addListener((incoming, sender, respond) => {
        if (incoming?.namespace !== 'fillbars-card-ui-v1' || incoming.action !== 'source') return false;
        if (sender.id !== chrome.runtime.id) { respond({ ok: false }); return false; }
        sourceOperations = sourceOperations.catch(() => undefined).then(async () => {
            await initialized;
            return selectSource(incoming.tabId);
        });
        sourceOperations.then(result => respond({ ok: true, ...result }), error => {
            message(error.message, true); respond({ ok: false });
        });
        return true;
    });
    window.addEventListener('focus', () => {
        void initialized.then(() => { if (!connected && !locked()) return connect(); });
    });
    async function send(fillOnly) {
        resetErrors();
        const candidates = fillOnly ? [row()] : draft.rows.filter(item => item.status !== 'saved');
        const errors = C.validateQueue(candidates, { forSending: true });
        if (errors.length) {
            const mapped = errors.map(error => ({ ...error, index: draft.rows.indexOf(candidates[error.index]) }));
            return showErrors(mapped);
        }
        busy = true; render();
        try {
            await saveDraft();
            const response = await request('start', { rows: candidates, fillOnly });
            state = response.state; lastRunVersion = ''; message('');
        } catch (error) { message(error.message, true); }
        finally { busy = false; render(); }
    }
    $('fillOnly').addEventListener('click', () => send(true));
    $('sendAll').addEventListener('click', () => send(false));
    $('stop').addEventListener('click', async () => {
        try { await request('stop'); $('stop').disabled = true; $('runMessage').textContent = 'Остановка запрошена. Текущее сохранение, если уже началось, будет проверено.'; }
        catch (error) { message(error.message, true); }
    });
    async function clear(checkedInBars = false) {
        if (busy || running()) return;
        const prompt = checkedInBars ? 'Удалить всю локальную очередь, включая неотправленные дневники? Продолжения не будет. Убедитесь, что результат последней отправки проверен в БАРС. Медицинские записи останутся без изменений.' : 'Очистить весь локальный черновик? Медицинские записи в БАРС останутся без изменений.';
        if (!confirm(prompt)) return;
        clearTimeout(saveTimer);
        busy = true; render();
        let cleared = false;
        try {
            await saveChain.catch(() => undefined);
            await request('clear', { checkedInBars });
            state = null; draft = newDraft(); selected = draft.rows[0].id;
            connected = false; cleared = true; resetErrors(); message('');
        } catch (error) { message(error.message, true); }
        finally { busy = false; render(); }
        if (cleared) await connect();
    }
    $('clearDraft').addEventListener('click', () => clear());
    $('discardRun').addEventListener('click', () => clear(true));
    $('resolveRun').addEventListener('click', async () => {
        if (busy || !unresolved()) return;
        const run = state.run;
        const current = run.rows?.[run.index || 0];
        if (!current) return;
        contextRevision++;
        busy = true; render();
        try {
            const response = await request('continue', { runId: run.id, rowId: current.id, checkedInBars: run.phase === 'saving' });
            state = response.state;
            if (state.draft) draft = state.draft;
            connected = !!state.patient;
            lastRunVersion = ''; $('stop').disabled = false; message('');
        } catch (error) { message(error.message, true); }
        finally { busy = false; render(); }
    });
    const upperFirst = name => name[0].toUpperCase() + name.slice(1);
    function renderSettings() {
        for (const field of C.vitalFields) $('settings' + upperFirst(field)).value = settings.defaults[field];
        for (const field of Object.keys(C.DEFAULT_SPREAD)) $('spread' + upperFirst(field)).value = settings.spread[field];
        $('settingsHourStep').value = settings.hourStep;
        $('autoPickVitals').checked = settings.autoPick;
        $('settingsError').hidden = true;
    }
    $('openSettings').addEventListener('click', () => { renderSettings(); $('settingsDialog').showModal(); });
    function closeSettings() {
        if (settingsSaving) return;
        $('settingsDialog').close(); $('openSettings').focus();
    }
    $('closeSettings').addEventListener('click', closeSettings);
    $('settingsDialog').addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
    async function saveSettings() {
        if (settingsSaving) return;
        settingsSaving = true; $('saveSettings').disabled = true;
        try {
            const candidate = C.cleanSettings({
                defaults: Object.fromEntries(C.vitalFields.map(field => [field, $('settings' + upperFirst(field)).value])),
                hourStep: $('settingsHourStep').value,
                autoPick: $('autoPickVitals').checked,
                spread: Object.fromEntries(Object.keys(C.DEFAULT_SPREAD).map(field => [field, $('spread' + upperFirst(field)).value]))
            });
            const response = await request('saveSettings', { settings: candidate });
            settings = C.cleanSettings(response.settings);
            $('settingsDialog').close();
            message('Настройки сохранены. Подбор применяется к новым записям; уже подготовленные записи не изменились.');
            $('openSettings').focus();
        } catch (error) { $('settingsError').textContent = error.message; $('settingsError').hidden = false; }
        finally { settingsSaving = false; $('saveSettings').disabled = false; render(); }
    }
    $('saveSettings').addEventListener('click', () => saveSettings());
    const editProfile = () => editLibrary?.profiles.find(profile => profile.id === editProfileId);
    const editVariant = () => editProfile()?.variants[editVariantIndex];
    function captureTemplate() {
        const profile = editProfile(), variant = editVariant();
        if (!profile) return;
        profile.name = $('profileName').value;
        if (variant) Object.assign(variant, { title: $('variantTitle').value, diary: $('templateDiary').value, examination: $('templateExamination').value, treatment: $('templateTreatment').value });
    }
    function renderTemplates() {
        const profile = editProfile(), variant = editVariant();
        $('templateList').replaceChildren(...editLibrary.profiles.map(item => {
            const button = document.createElement('button');
            button.textContent = item.name || 'Новое заболевание'; button.className = item.id === editProfileId ? 'selected' : '';
            button.addEventListener('click', () => { captureTemplate(); editProfileId = item.id; editVariantIndex = 0; renderTemplates(); });
            return button;
        }));
        if (!editLibrary.profiles.length) { const p = document.createElement('p'); p.className = 'empty-note'; p.textContent = 'Добавьте заболевание и свои варианты дневника.'; $('templateList').append(p); }
        $('templateEditor').hidden = !profile;
        if (!profile) return;
        renderGenderPairs();
        $('profileName').value = profile.name;
        $('templateVariant').replaceChildren(...profile.variants.map((item, index) => new Option((index + 1) + '. ' + (item.title || 'Вариант'), index)));
        $('templateVariant').value = editVariantIndex;
        $('variantTitle').value = variant?.title || '';
        $('templateDiary').value = variant?.diary || '';
        $('templateExamination').value = variant?.examination || '';
        $('templateTreatment').value = variant?.treatment || '';
        for (const id of ['variantTitle', 'templateDiary', 'templateExamination', 'templateTreatment', 'deleteVariant']) $(id).disabled = !variant;
    }
    function closeTemplates() {
        if (templatesDirty && !confirm('Закрыть библиотеку без сохранения изменений?')) return;
        $('templatesDialog').close(); $('manageTemplates').focus();
    }
    $('manageTemplates').addEventListener('click', () => {
        editLibrary = C.clone(library); editProfileId = row().profileId || editLibrary.profiles[0]?.id; editVariantIndex = 0; templatesDirty = false;
        $('templateError').hidden = true; renderTemplates(); $('templatesDialog').showModal();
    });
    $('closeTemplates').addEventListener('click', closeTemplates);
    $('templatesDialog').addEventListener('cancel', event => { event.preventDefault(); closeTemplates(); });
    $('templatesDialog').addEventListener('input', () => { templatesDirty = true; });
    function renderGenderPairs() {
        const pairs = editProfile()?.genderPairs || [];
        $('genderPairs').replaceChildren(...pairs.map((pair, index) => {
            const element = document.createElement('div');
            element.className = 'gender-pair';
            const male = document.createElement('label'), female = document.createElement('label');
            male.textContent = 'Мужской род'; female.textContent = 'Женский род';
            for (const [key, label] of [['male', male], ['female', female]]) {
                const input = document.createElement('input'); input.maxLength = 120; input.value = pair[key];
                input.setAttribute('aria-label', (key === 'male' ? 'Мужской' : 'Женский') + ' род, пара ' + (index + 1));
                input.addEventListener('input', () => { pair[key] = input.value; }); label.append(input);
            }
            const actions = document.createElement('div'); actions.className = 'pair-actions';
            const remove = document.createElement('button'); remove.className = 'text-button danger-text'; remove.textContent = 'Удалить';
            remove.setAttribute('aria-label', 'Удалить пару ' + (index + 1));
            remove.addEventListener('click', () => {
                captureTemplate(); const profile = editProfile();
                profile.genderPairs = profile.genderPairs.filter(item => item.id !== pair.id);
                templatesDirty = true; renderGenderPairs();
            });
            actions.append(remove); element.append(male, female, actions); return element;
        }));
        $('addGenderPair').disabled = pairs.length >= 50;
    }
    $('addGenderPair').addEventListener('click', () => {
        captureTemplate(); const profile = editProfile(); if (!profile) return;
        profile.genderPairs ||= [];
        if (profile.genderPairs.length >= 50) return;
        let id = 1;
        while (profile.genderPairs.some(pair => pair.id === String(id))) id++;
        profile.genderPairs.push({ id: String(id), male: '', female: '' });
        templatesDirty = true; renderGenderPairs();
        $('genderPairs').lastElementChild?.querySelector('input')?.focus();
    });
    $('templateVariant').addEventListener('change', () => { captureTemplate(); editVariantIndex = Number($('templateVariant').value); renderTemplates(); });
    $('newProfile').addEventListener('click', () => {
        captureTemplate();
        if (editLibrary.profiles.length >= 200) return;
        const profile = { id: C.uid(), name: 'Новое заболевание', variants: [{ id: C.uid(), title: 'Вариант 1', diary: '', examination: '-', treatment: '' }] };
        editLibrary.profiles.push(profile); editProfileId = profile.id; editVariantIndex = 0; templatesDirty = true; renderTemplates(); $('profileName').focus(); $('profileName').select();
    });
    $('newVariant').addEventListener('click', () => {
        captureTemplate(); const profile = editProfile(); if (!profile || profile.variants.length >= 200) return;
        profile.variants.push({ id: C.uid(), title: 'Вариант ' + (profile.variants.length + 1), diary: '', examination: '-', treatment: '' });
        editVariantIndex = profile.variants.length - 1; templatesDirty = true; renderTemplates(); $('templateDiary').focus();
    });
    $('deleteVariant').addEventListener('click', () => {
        if (!confirm('Удалить этот вариант из библиотеки? Подготовленные дневники сохранят свой текст.')) return;
        captureTemplate(); editProfile().variants.splice(editVariantIndex, 1); editVariantIndex = 0; templatesDirty = true; renderTemplates();
    });
    $('deleteProfile').addEventListener('click', () => {
        if (!confirm('Удалить заболевание со всеми его вариантами? Подготовленные дневники сохранят свой текст.')) return;
        editLibrary.profiles = editLibrary.profiles.filter(p => p.id !== editProfileId); editProfileId = editLibrary.profiles[0]?.id; editVariantIndex = 0; templatesDirty = true; renderTemplates();
    });
    $('saveTemplates').addEventListener('click', async () => {
        captureTemplate();
        try {
            const response = await request('saveLibrary', { library: editLibrary });
            library = response.library; templatesDirty = false; $('templatesDialog').close(); render(); message('Библиотека сохранена. Уже подготовленные тексты не изменились.');
        } catch (error) { $('templateError').textContent = error.message; $('templateError').hidden = false; }
    });
    $('exportTemplates').addEventListener('click', () => {
        captureTemplate();
        try {
            const data = C.cleanLibrary(editLibrary);
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'fillbars-card-templates.json'; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { $('templateError').textContent = error.message; $('templateError').hidden = false; }
    });
    $('importTemplates').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', async () => {
        try {
            const file = $('importFile').files[0]; if (!file) return;
            if (file.size > 2000000) throw new Error('Файл должен быть меньше 2 МБ.');
            const imported = C.cleanLibrary(JSON.parse(await file.text()));
            if (editLibrary.profiles.length && !confirm('Заменить редактируемую библиотеку шаблонами из файла? Для применения затем нажмите «Сохранить библиотеку».')) return;
            editLibrary = imported; editProfileId = editLibrary.profiles[0]?.id; editVariantIndex = 0; templatesDirty = true; renderTemplates();
        } catch (error) { $('templateError').textContent = 'Импорт не выполнен: ' + error.message; $('templateError').hidden = false; }
        finally { $('importFile').value = ''; }
    });
    async function poll() {
        if (polling || busy) return;
        polling = true;
        const requestedTabId = tabId, requestedRevision = contextRevision;
        try {
            const response = await request('status');
            if (busy || requestedTabId !== tabId || requestedRevision !== contextRevision) return;
            const incoming = response.state;
            const version = incoming?.run?.id + ':' + incoming?.run?.updatedAt + ':' + incoming?.run?.status;
            if (incoming?.run && version !== lastRunVersion) {
                state = incoming; lastRunVersion = version;
                if (incoming.draft) draft = incoming.draft;
                $('stop').disabled = false; render();
            }
        } catch (error) { if (running()) message(error.message, true); }
        finally { polling = false; }
    }
    window.addEventListener('beforeunload', () => {
        if (saveTimer && !locked()) { clearTimeout(saveTimer); void saveDraft(); }
    });
    try {
        if (!window.cardPreviewRequest && window.chrome?.windows?.getCurrent) {
            const currentWindow = await chrome.windows.getCurrent();
            if (currentWindow.type === 'popup') {
                const registration = await chrome.runtime.sendMessage({ namespace: 'fillbars-card-window-v1', action: 'register', windowId: currentWindow.id });
                if (registration?.duplicate) { window.close(); return; }
            }
        }
        const loaded = await request('load');
        library = C.cleanLibrary(loaded.library); state = loaded.state; settings = C.cleanSettings(loaded.settings);
        lastRunVersion = state?.run?.id + ':' + state?.run?.updatedAt + ':' + state?.run?.status;
        if (state?.draft?.rows?.length) draft = state.draft;
        else draft = newDraft();
        selected = draft.rows[0].id;
        render();
        await connect();
        if (window.cardPreviewRequest) message('Предпросмотр интерфейса. Учебные данные, соединения с МИС нет.');
    } catch (error) { render(); message(error.message, true); }
    finally { finishInitialization(); }
    setInterval(poll, 1200);
})();
