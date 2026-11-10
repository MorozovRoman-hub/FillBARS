(() => {
    'use strict';

    if (globalThis.FillBARSCECReminders) return;

    const legacyGrid = '.pat_in_dep_healing_emp [cmptype="Grid"][name="GRID_HH"]';
    const newGrid = '.healing_emp [cmptype="Grid"][name="gridHealingDoctor"]';
    const gridSelector = `${legacyGrid}, ${newGrid}`;
    const rowSelector = 'tr[cmptype="GridRow"]';
    const ownSelector = '[data-fillbars-cec]';
    const panelSelector = 'details[data-fillbars-cec="panel"]';
    const dayMs = 86_400_000;
    const storagePrefix = `fillbars-cec:${location.origin}:`;
    const notNeeded = 'not-needed';
    const panels = new Map();
    let scanNumber = 0;
    let lastScannedDate;

    function admissionDate(value) {
        const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/.exec(value);
        if (!match) return null;
        const [, day, month, year] = match.map(Number);
        const start = Date.UTC(year, month - 1, day);
        const date = new Date(start);
        if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1 || date.getUTCFullYear() !== year) return null;
        return start;
    }

    function isoDate(timestamp) {
        return new Date(timestamp).toISOString().slice(0, 10);
    }

    function episodeKey(row, admission) {
        const history = row.querySelector('td[column_name="HOSP_HISTORY"] a, td[cont="HOSP_HISTORY"] a');
        const caseNumber = history?.textContent.replace(/\s+/g, '');
        const rowId = row.getAttribute('keyvalue') || row.getAttribute('repeaterkeyvalue') || row.getAttribute('repkeyvalue')
            || /(?:^|\s)(?:rep|repeater)keyvalue(\d+)(?=\s|$)/.exec(row.className)?.[1];
        const episode = caseNumber ? `case:${caseNumber}` : rowId ? `id:${rowId}` : '';
        return episode && admission !== null ? `${storagePrefix}${episode}:${isoDate(admission)}` : '';
    }

    function completedDate(mark, admission, today) {
        if (typeof mark !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(mark)) return null;
        const date = Date.parse(mark);
        return date >= admission && date <= today && isoDate(date) === mark ? date : null;
    }

    function visible(element) {
        return element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
    }

    function activeGrids() {
        return [...document.querySelectorAll(gridSelector)].filter(grid => {
            if (!visible(grid)) return false;
            if (grid.matches(newGrid)) return true;
            return grid.closest('.pat_in_dep_healing_emp')
                .querySelector('input[type="radio"][name="N_TYPE"]:checked')?.value === '0';
        });
    }

    function clearGrid(grid, retainedPanels) {
        const { element } = panels.get(grid);
        if (!retainedPanels.has(element)) element.remove();
        panels.delete(grid);
        grid.querySelectorAll(ownSelector).forEach(element => element.remove());
    }

    function setBadge(row, link, day, completed) {
        let badge = row.querySelector(ownSelector);
        if (!link || day < 13) {
            badge?.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('span');
            link.after(badge);
        }
        const tone = String(Math.min(day, 15));
        if (badge.dataset.fillbarsCec !== tone) badge.dataset.fillbarsCec = tone;
        const label = completed ? `Проверьте срок КЭК · ${day} дн. после КЭК` : `Проверьте срок КЭК · ${day}-й день`;
        if (badge.textContent !== label) badge.textContent = label;
    }

    function renderEntry(entry, grid) {
        const { label, key, mark, admission, today } = entry;
        const item = document.createElement('li');
        const patient = document.createElement('button');
        patient.type = 'button';
        patient.textContent = label;
        patient.title = 'Показать ссылку «Номер ИБ» в таблице';
        const error = document.createElement('div');
        error.setAttribute('role', 'status');
        patient.addEventListener('click', () => {
            error.textContent = '';
            const row = entry.link.closest('tr');
            const currentAdmission = admissionDate(row?.querySelector('td[column_name="DATE_IN_TRUNCED"]')?.textContent.trim() || '');
            if (!key || !item.isConnected || !activeGrids().includes(grid) || !grid.contains(row) || !visible(row)
                || episodeKey(row, currentAdmission) !== key) {
                error.textContent = 'Строка пациента изменилась. Откройте сводку заново.';
                return;
            }
            const history = row.querySelector('a[name="HH_LINK"], td[column_name="HOSP_HISTORY"] a, td[cont="HOSP_HISTORY"] a');
            if (!history) {
                error.textContent = 'В строке пациента нет ссылки «Номер ИБ».';
                return;
            }
            grid.querySelector('.fillbars-cec-history-target')?.classList.remove('fillbars-cec-history-target');
            history.classList.add('fillbars-cec-history-target');
            item.closest(panelSelector).open = false;
            history.scrollIntoView({ block: 'center', inline: 'nearest' });
        });
        item.append(patient);
        if (!key) {
            item.append(' · Номер госпитализации недоступен для сохранения отметки.', error);
            return item;
        }

        const actions = document.createElement('div');
        actions.className = 'fillbars-cec-actions';
        const editor = document.createElement('div');
        editor.className = 'fillbars-cec-actions';
        editor.hidden = true;
        const dateLabel = document.createElement('label');
        dateLabel.textContent = 'Дата проведения КЭК ';
        const date = document.createElement('input');
        date.type = 'date';
        date.min = isoDate(admission);
        date.max = isoDate(today);
        dateLabel.append(date);
        editor.append(dateLabel);

        function currentRow() {
            const row = entry.link.closest('tr');
            const currentAdmission = admissionDate(row?.querySelector('td[column_name="DATE_IN_TRUNCED"]')?.textContent.trim() || '');
            if (!item.isConnected || !activeGrids().includes(grid) || !grid.contains(row) || episodeKey(row, currentAdmission) !== key
                || row.querySelector('td[column_name="HH_DEP_DATE_OUT"]')?.textContent.trim()) {
                error.textContent = 'Строка пациента изменилась. Откройте отметку заново.';
                return null;
            }
            return row;
        }

        let saving = false;
        async function save(value) {
            if (saving || !currentRow()) return;
            saving = true;
            error.textContent = '';
            try {
                if (value === null) await chrome.storage.local.remove(key);
                else await chrome.storage.local.set({ [key]: value });
                editor.hidden = true;
                scheduleScan();
            } catch {
                error.textContent = 'Не удалось сохранить отметку. Повторите попытку.';
            } finally {
                saving = false;
            }
        }

        function addButton(parent, text, action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.addEventListener('click', action);
            parent.append(button);
        }

        addButton(actions, 'КЭК проведена', () => {
            date.value = isoDate(today);
            error.textContent = '';
            editor.hidden = false;
            date.focus();
        });
        if (mark !== notNeeded) addButton(actions, 'КЭК не нужна', () => save(notNeeded));
        addButton(actions, 'Распечатать представление на КЭК', async event => {
            const row = currentRow();
            if (!row) return;
            const button = event.currentTarget;
            const birth = row.querySelector('td[column_name="BIRTDAT"], td[column_name="BIRTDATE"], td[column_name="BIRTH_DATE"], td[column_name="BIRTHDATE"]');
            const birthDate = admissionDate(birth?.textContent.trim() || '');
            button.disabled = true;
            error.textContent = '';
            try {
                const result = await chrome.runtime.sendMessage({
                    type: 'fillbars-cec-print',
                    patient: { fullName: entry.link.textContent.trim(), birthDate: birthDate === null ? '' : isoDate(birthDate) }
                });
                if (!result?.opened) throw new Error('cec_print_failed');
            } catch {
                error.textContent = 'Не удалось открыть бланк КЭК. Повторите попытку.';
            } finally {
                button.disabled = false;
            }
        });
        if (mark) addButton(actions, 'Снять отметку', () => save(null));
        addButton(editor, 'Сохранить дату', () => {
            if (completedDate(date.value, admission, today) === null) {
                error.textContent = 'Укажите дату от поступления до сегодняшнего дня.';
                return;
            }
            void save(date.value);
        });
        addButton(editor, 'Отмена', () => {
            editor.hidden = true;
            error.textContent = '';
        });
        item.append(actions, editor, error);
        return item;
    }

    function renderPanel(grid, entries, totals, storageUnavailable) {
        const anchor = grid.closest('.form-container > .content-wrapper') || grid;
        let panel = panels.get(grid);
        let element = anchor.previousElementSibling;
        if (!element?.matches(panelSelector)) {
            element = panel?.element;
            if (!element?.isConnected || element.parentElement !== anchor.parentElement) {
                element = document.createElement('details');
                element.dataset.fillbarsCec = 'panel';
                element.append(document.createElement('summary'), document.createElement('div'), document.createElement('ul'));
                anchor.before(element);
            }
        }
        while (element.previousElementSibling?.matches(panelSelector)) {
            const duplicate = element.previousElementSibling;
            if (duplicate.open) element.open = true;
            duplicate.remove();
        }
        if (panel?.element !== element) {
            panel?.element.remove();
            panel = { element, entries: null };
            panels.set(grid, panel);
        }

        const [summary, note, list] = panel.element.children;
        const counts = [
            [' · 15-й день и далее: ', totals.later],
            [' · 14-й: ', totals.next],
            [' · 13-й: ', totals.soon]
        ];
        const title = storageUnavailable ? 'КЭК · отметки недоступны' : 'КЭК · текущая страница';
        const heading = title + counts.map(([label, count]) => label + count).join('');
        if (summary.textContent !== heading || summary.childElementCount !== counts.length) {
            summary.replaceChildren(title, ...counts.flatMap(([label, count]) => {
                const value = document.createElement('span');
                if (count > 0) value.className = 'fillbars-cec-count-alert';
                value.textContent = count;
                return [label, value];
            }));
        }
        const explanation = (storageUnavailable ? 'Отметки КЭК недоступны. Обновите страницу, чтобы повторить проверку.'
            : `Проверено: ${totals.checked}. Нажмите на фамилию, чтобы найти «Номер ИБ» в таблице. Отметки действуют в этом браузере. Срок ЭЛН и решения КЭК сверяйте в карте.`)
            + (totals.unknown ? ` Строк без данных для расчёта: ${totals.unknown}.` : '');
        if (note.textContent !== explanation) note.textContent = explanation;
        entries.sort((a, b) => b.day - a.day);
        if (entries.length === panel.entries?.length && entries.every(({ link, label, key, mark, today }, index) => {
            const previous = panel.entries[index];
            return (key || link === previous.link) && key === previous.key && label === previous.label
                && mark === previous.mark && today === previous.today;
        })) {
            entries.forEach(({ link }, index) => { panel.entries[index].link = link; });
            return;
        }
        panel.entries = entries;
        list.replaceChildren(...entries.map(entry => renderEntry(entry, grid)));
    }

    async function scan() {
        const request = ++scanNumber;
        const grids = activeGrids();
        const now = new Date();
        lastScannedDate = now.toDateString();
        const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const pages = grids.map(grid => {
            const loadedRow = grid.matches(newGrid) ? '[isclone="1"]' : '[keyvalue]:not([keyvalue=""])';
            const rows = [...grid.querySelectorAll(rowSelector)].map(row => {
                if (!row.matches(loadedRow) || !visible(row)) return { row };
                const link = row.querySelector('[name="PAT_LINK"]');
                const discharge = row.querySelector('td[column_name="HH_DEP_DATE_OUT"]');
                if (discharge?.textContent.trim()) return { row };
                const admission = admissionDate(row.querySelector('td[column_name="DATE_IN_TRUNCED"]')?.textContent.trim() || '');
                if (!discharge || admission === null || admission > today || !link?.textContent.trim()) return { row, unknown: true };
                return { row, link, admission, key: episodeKey(row, admission) };
            });
            return { grid, rows };
        });
        const keys = [...new Set(pages.flatMap(({ rows }) => rows.map(({ key }) => key).filter(Boolean)))];
        let marks = {};
        let storageUnavailable = false;
        if (keys.length) {
            try {
                marks = await chrome.storage.local.get(keys);
            } catch {
                storageUnavailable = true;
            }
        }
        const render = request === scanNumber;
        const results = pages.map(({ grid, rows }) => {
            const totals = { checked: 0, unknown: 0, soon: 0, next: 0, later: 0 };
            const entries = [];
            for (const { row, link, admission, key, unknown } of rows) {
                if (unknown || (storageUnavailable && key)) {
                    totals.unknown++;
                    if (render) setBadge(row, null, 0);
                    continue;
                }
                if (!link) {
                    if (render) setBadge(row, null, 0);
                    continue;
                }
                const mark = marks[key];
                const completed = completedDate(mark, admission, today);
                const exempt = mark === notNeeded;
                const day = exempt ? 0 : completed === null ? (today - admission) / dayMs + 1 : (today - completed) / dayMs;
                totals.checked++;
                if (render) setBadge(row, link, day, completed !== null);
                if (day >= 13) totals[day === 13 ? 'soon' : day === 14 ? 'next' : 'later']++;
                const detail = exempt ? 'КЭК не нужна' : completed === null ? `${day}-й день госпитализации`
                    : `КЭК от ${mark.split('-').reverse().join('.')} · прошло ${day} дн.`;
                entries.push({ link, day, key, mark, admission, today, label: `${link.textContent.trim()} · ${detail}` });
            }
            if (render && grid.isConnected && visible(grid)) renderPanel(grid, entries, totals, storageUnavailable);
            if (storageUnavailable) totals.storageUnavailable = true;
            return totals;
        });
        if (render) {
            const retained = new Set(grids.map(grid => panels.get(grid)?.element));
            for (const grid of panels.keys()) {
                if (!grids.includes(grid)) clearGrid(grid, retained);
            }
        }
        return results;
    }

    let scheduled = false;
    function scheduleScan() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            scan();
        });
    }

    globalThis.FillBARSCECReminders = { scan };
    new MutationObserver(records => {
        if (records.some(record => {
            const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
            if (!target || target.closest(ownSelector)) return false;
            const inGrid = !!target.closest(gridSelector);
            if (record.type === 'characterData') return inGrid;
            if (record.type === 'childList') {
                return [...record.addedNodes, ...record.removedNodes].some(node =>
                    !node.matches?.(ownSelector) && (inGrid || panels.has(node) || node.matches?.(gridSelector)
                        || node.querySelector?.(gridSelector) || [...panels.keys()].some(grid => node.contains(grid))));
            }
            if (target.matches('input[name="N_TYPE"]')) return true;
            if (target.matches(rowSelector)) {
                // BARS changes the active/hover class as the doctor works with the table.
                if (record.attributeName === 'class') {
                    const classes = value => (value || '').split(/\s+/).filter(name => name && !/^(active|hover)$/.test(name)).sort().join(' ');
                    return inGrid && classes(record.oldValue) !== classes(target.className);
                }
                return inGrid;
            }
            return target.matches(gridSelector) || !!target.querySelector(gridSelector)
                || [...panels.keys()].some(grid => target.contains(grid));
        })) scheduleScan();
    }).observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
        attributeFilter: ['class', 'style', 'hidden', 'checked', 'keyvalue', 'repkeyvalue', 'repeaterkeyvalue', 'isclone', 'repeatershow']
    });
    document.addEventListener('change', event => {
        if (event.target.matches?.('input[name="N_TYPE"]')) scheduleScan();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleScan();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && Object.keys(changes).some(key => key.startsWith(storagePrefix))) scheduleScan();
    });
    setInterval(() => {
        if (!document.hidden && new Date().toDateString() !== lastScannedDate) scheduleScan();
    }, 60_000);
    scheduleScan();
})();
