// ==============================================
// 1. НАСТРОЙКА ПРОФИЛЕЙ
// ==============================================

const CONFIG_FILE_NAME = 'fillbars-config.json';
let CONFIG_TEMPLATES = {};
let CONFIG_ACTIVE_PROFILE_NAMES = [];
let CONFIG_RESEARCH_CATALOG = {};
let CONFIG_ASSIGNMENT_SETTINGS = {};
// ==============================================

const PROFILE_STORAGE_KEY = 'barsCustomProfilesV4';
const ACTIVE_PROFILE_NAMES_STORAGE_KEY = 'barsActiveProfileNamesV1';
const RESEARCH_CATALOG_STORAGE_KEY = 'barsResearchCatalogV3';
const ASSIGNMENT_SETTINGS_STORAGE_KEY = 'barsAssignmentSettingsV1';
const ASSIGNMENT_STAGE_ANALYSES = 'analyses';
const ASSIGNMENT_STAGE_SCHEDULE = 'schedule';
const DEFAULT_ASSIGNMENT_SETTINGS = {
    assignmentStage: ASSIGNMENT_STAGE_ANALYSES,
    targetCabinet: '',
    markUrgent: false
};
const PROFILE_ICONS = ['🔴', '🟠', '🟡', '🫁', '⚠️', '🏥', '⭐', '🩸', '❤️', '🧪', '🦠', '🧬', '💊', '🔬', '🧫', '🩺', '🚑', '📋'];
const CHECKBOX_SELECTOR = 'input[name="GridResearch_SelectList_Item"]';
const RESEARCH_MATERIAL_NAMES = new Set([
    'сыворотка крови',
    'кровь',
    'кровь венозная',
    'кровь капиллярная',
    'моча',
    'осадок мочи',
    'кал',
    'мокрота',
    'ликвор',
    'слюна',
    'гной',
    'отделяемое',
    'отделяемое из уха',
    'отделяемое влагалища',
    'отделяемое уретры',
    'отделяемое женских мочеполовых органов',
    'отделяемое из носа',
    'плазма крови бедная тромбоцитами',
    'жидкость плевральная',
    'носоглоточная слизь',
    'слизь с миндалин',
    'мазок слизистой ротоглотки',
    'соскоб'
]);
let PROFILES = {};
let loadedResearches = loadSavedResearches();
let editingProfileName = null;
let selectedResearchIds = new Set();
let selectedProfileIcon = PROFILE_ICONS[0];

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProfiles(rawProfiles) {
    if (!isPlainObject(rawProfiles)) {
        return {};
    }

    return Object.entries(rawProfiles).reduce((profiles, [profileName, analyses]) => {
        if (!profileName || !isPlainObject(analyses)) {
            return profiles;
        }

        const normalizedAnalyses = Object.entries(analyses).reduce((result, [researchId, enabled]) => {
            if (researchId && enabled === true) {
                result[researchId] = true;
            }
            return result;
        }, {});

        profiles[profileName] = normalizedAnalyses;
        return profiles;
    }, {});
}

function normalizeProfileNameList(rawNames, profileLibrary = {}) {
    if (!Array.isArray(rawNames)) {
        return [];
    }

    const seen = new Set();
    return rawNames
        .map((profileName) => String(profileName || '').trim())
        .filter((profileName) => {
            if (!profileName || seen.has(profileName) || !profileLibrary[profileName]) {
                return false;
            }

            seen.add(profileName);
            return true;
        });
}

function normalizeAssignmentSettings(settings = {}) {
    const targetCabinet = String(settings.targetCabinet || '').trim();
    const requestedStage = settings.assignmentStage === ASSIGNMENT_STAGE_SCHEDULE
        ? ASSIGNMENT_STAGE_SCHEDULE
        : ASSIGNMENT_STAGE_ANALYSES;

    return {
        assignmentStage: targetCabinet ? requestedStage : ASSIGNMENT_STAGE_ANALYSES,
        targetCabinet,
        markUrgent: settings.markUrgent === true
    };
}

async function loadExtensionConfigFile() {
    try {
        const response = await fetch(chrome.runtime.getURL(CONFIG_FILE_NAME), { cache: 'no-store' });
        if (!response.ok) {
            return {};
        }

        const rawConfig = (await response.text()).trim();
        return rawConfig ? JSON.parse(rawConfig) : {};
    } catch (error) {
        console.warn(`Не удалось прочитать ${CONFIG_FILE_NAME}`, error);
        return {};
    }
}

function applyExtensionConfig(config) {
    CONFIG_TEMPLATES = normalizeProfiles(config?.templates || config?.profiles);
    CONFIG_ACTIVE_PROFILE_NAMES = normalizeProfileNameList(config?.activeProfiles || [], CONFIG_TEMPLATES);
    CONFIG_RESEARCH_CATALOG = getNormalizedResearchCatalog(config?.researchCatalog || {});
    CONFIG_ASSIGNMENT_SETTINGS = normalizeAssignmentSettings(config?.settings || {});
    loadedResearches = loadSavedResearches();
}

function readJsonStorage(key, fallbackValue) {
    try {
        const rawValue = localStorage.getItem(key);
        return rawValue ? JSON.parse(rawValue) : fallbackValue;
    } catch (error) {
        console.warn(`Не удалось прочитать настройки ${key}`, error);
        return fallbackValue;
    }
}

function writeJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function getCustomProfiles() {
    return normalizeProfiles(readJsonStorage(PROFILE_STORAGE_KEY, {}));
}

function saveCustomProfiles(customProfiles) {
    writeJsonStorage(PROFILE_STORAGE_KEY, normalizeProfiles(customProfiles));
}

function getTemplateLibrary() {
    return {
        ...CONFIG_TEMPLATES,
        ...getCustomProfiles()
    };
}

function getActiveProfileNames() {
    const profileLibrary = getTemplateLibrary();
    const rawValue = localStorage.getItem(ACTIVE_PROFILE_NAMES_STORAGE_KEY);
    if (rawValue === null) {
        return normalizeProfileNameList(CONFIG_ACTIVE_PROFILE_NAMES, profileLibrary);
    }

    return normalizeProfileNameList(readJsonStorage(ACTIVE_PROFILE_NAMES_STORAGE_KEY, []), profileLibrary);
}

function saveActiveProfileNames(profileNames) {
    writeJsonStorage(ACTIVE_PROFILE_NAMES_STORAGE_KEY, normalizeProfileNameList(profileNames, getTemplateLibrary()));
}

function loadProfiles() {
    const profileLibrary = getTemplateLibrary();
    const profiles = {};

    for (const profileName of getActiveProfileNames()) {
        profiles[profileName] = { ...profileLibrary[profileName] };
    }

    return profiles;
}

function refreshProfiles() {
    PROFILES = loadProfiles();
}

function normalizeResearchName(name, researchId) {
    const normalizedName = String(name || '').replace(/\s+/g, ' ').trim();
    const lowerName = normalizedName.toLowerCase().replace(/\.$/, '');

    if (!normalizedName
        || normalizedName === `Исследование ${researchId}`
        || RESEARCH_MATERIAL_NAMES.has(lowerName)
        || /^[ab]\d{2}(?:\.\d{2,3})+(?:\.\d+)?$/i.test(lowerName)) {
        return '';
    }

    return normalizedName;
}

function getNormalizedResearchCatalog(rawCatalog) {
    if (Array.isArray(rawCatalog)) {
        return rawCatalog.reduce((catalog, research) => {
            const name = normalizeResearchName(research.name, research.id);
            if (research.id && name) {
                catalog[research.id] = name;
            }
            return catalog;
        }, {});
    }

    if (!rawCatalog || typeof rawCatalog !== 'object') {
        return {};
    }

    return Object.entries(rawCatalog).reduce((catalog, [researchId, name]) => {
        const normalizedName = normalizeResearchName(name, researchId);
        if (researchId && normalizedName) {
            catalog[researchId] = normalizedName;
        }
        return catalog;
    }, {});
}

function getResearchCatalog() {
    const savedCatalog = getNormalizedResearchCatalog(readJsonStorage(RESEARCH_CATALOG_STORAGE_KEY, {}));
    return {
        ...CONFIG_RESEARCH_CATALOG,
        ...savedCatalog
    };
}

function saveResearchCatalog(catalog) {
    writeJsonStorage(RESEARCH_CATALOG_STORAGE_KEY, catalog);
}

function getAssignmentSettings() {
    const savedSettings = readJsonStorage(ASSIGNMENT_SETTINGS_STORAGE_KEY, {});
    return normalizeAssignmentSettings({
        ...DEFAULT_ASSIGNMENT_SETTINGS,
        ...CONFIG_ASSIGNMENT_SETTINGS,
        ...savedSettings
    });
}

function saveAssignmentSettings(settings) {
    const normalizedSettings = normalizeAssignmentSettings(settings);
    writeJsonStorage(ASSIGNMENT_SETTINGS_STORAGE_KEY, normalizedSettings);
    return normalizedSettings;
}

function updateAssignmentStageUi(settings = getAssignmentSettings()) {
    const slider = document.getElementById('assignmentStageSlider');
    const label = document.getElementById('assignmentStageText');
    const targetCabinetInput = document.getElementById('targetCabinetInput');
    const markUrgentCheckbox = document.getElementById('markUrgentCheckbox');
    const hint = document.getElementById('assignmentStageHint');

    if (!slider || !label) {
        return;
    }

    const normalizedSettings = normalizeAssignmentSettings(settings);
    const canUseSchedule = !!normalizedSettings.targetCabinet;

    slider.disabled = !canUseSchedule;
    slider.value = normalizedSettings.assignmentStage === ASSIGNMENT_STAGE_SCHEDULE ? '1' : '0';
    label.textContent = canUseSchedule && normalizedSettings.assignmentStage === ASSIGNMENT_STAGE_SCHEDULE
        ? (normalizedSettings.markUrgent ? 'Кабинеты и срочно' : 'Кабинеты')
        : 'Только анализы';

    if (targetCabinetInput) {
        targetCabinetInput.value = normalizedSettings.targetCabinet;
    }

    if (markUrgentCheckbox) {
        markUrgentCheckbox.checked = normalizedSettings.markUrgent;
    }

    if (hint) {
        hint.textContent = canUseSchedule
            ? ''
            : 'Укажите кабинет, чтобы включить этап кабинетов.';
    }
}

function loadSavedResearches() {
    const catalog = getResearchCatalog();

    return Object.entries(catalog)
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

function mergeResearchCatalog(researches) {
    const catalog = getResearchCatalog();

    for (const research of researches) {
        const name = normalizeResearchName(research.name, research.id);
        if (research.id && name) {
            catalog[research.id] = name;
        }
    }

    saveResearchCatalog(catalog);
    loadedResearches = loadSavedResearches();

    return loadedResearches;
}

function splitProfileTitle(profileName) {
    const parts = profileName.trim().split(/\s+/);
    const firstPart = parts[0] || PROFILE_ICONS[0];

    if (PROFILE_ICONS.includes(firstPart)) {
        return {
            icon: firstPart,
            name: parts.slice(1).join(' ') || profileName.trim()
        };
    }

    return {
        icon: PROFILE_ICONS[0],
        name: profileName.trim()
    };
}

function makeProfileTitle(icon, name) {
    return `${icon} ${name.trim()}`;
}

function setStatus(message, color = '#4CAF50') {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.style.color = color;
}

function populateProfileSelect(preferredProfile = '') {
    const select = document.getElementById('profileSelect');
    const currentValue = preferredProfile || select.value || localStorage.getItem('lastSelectedProfile') || '';

    while (select.options.length > 1) {
        select.remove(1);
    }

    for (const profileName in PROFILES) {
        const option = document.createElement('option');
        option.value = profileName;
        option.textContent = profileName;
        select.appendChild(option);
    }

    if (currentValue && PROFILES[currentValue]) {
        select.value = currentValue;
    } else {
        select.value = '';
    }
}

function renderProfileManagerList() {
    const list = document.getElementById('profileManagerList');
    list.textContent = '';

    const profileNames = Object.keys(PROFILES);
    if (profileNames.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Активные шаблоны не выбраны';
        list.appendChild(empty);
        return;
    }

    for (const profileName of profileNames) {
        const row = document.createElement('div');
        row.className = 'profile-row';

        const name = document.createElement('span');
        name.className = 'profile-row-name';
        name.textContent = profileName;

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'small-btn';
        editButton.textContent = 'Ред.';
        editButton.addEventListener('click', () => openProfileEditor(profileName));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'small-btn danger-mini';
        deleteButton.textContent = 'Удалить';
        deleteButton.addEventListener('click', () => deleteProfile(profileName));

        row.append(name, editButton, deleteButton);
        list.appendChild(row);
    }
}

function renderTemplateLibraryList() {
    const list = document.getElementById('templateLibraryList');
    if (!list) {
        return;
    }

    const profileLibrary = getTemplateLibrary();
    const activeProfileNames = new Set(getActiveProfileNames());
    const profileNames = Object.keys(profileLibrary);
    list.textContent = '';

    if (profileNames.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Предзагруженных шаблонов нет';
        list.appendChild(empty);
        return;
    }

    for (const profileName of profileNames) {
        const row = document.createElement('div');
        row.className = 'template-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = activeProfileNames.has(profileName);
        checkbox.addEventListener('change', () => {
            const nextActiveNames = new Set(getActiveProfileNames());
            if (checkbox.checked) {
                nextActiveNames.add(profileName);
            } else {
                nextActiveNames.delete(profileName);
            }

            saveActiveProfileNames(Array.from(nextActiveNames));
            refreshProfiles();
            populateProfileSelect();
            renderProfileManagerList();
            renderTemplateLibraryList();
        });

        const name = document.createElement('span');
        name.className = 'profile-row-name';
        name.textContent = profileName;

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'small-btn';
        editButton.textContent = 'Ред.';
        editButton.addEventListener('click', () => openProfileEditor(profileName));

        row.append(checkbox, name, editButton);
        list.appendChild(row);
    }
}

function renderIconPicker() {
    const picker = document.getElementById('iconPicker');
    picker.textContent = '';

    for (const icon of PROFILE_ICONS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = icon === selectedProfileIcon ? 'icon-choice selected' : 'icon-choice';
        button.textContent = icon;
        button.addEventListener('click', () => {
            selectedProfileIcon = icon;
            renderIconPicker();
        });
        picker.appendChild(button);
    }
}

function ensureSelectedResearchesInList() {
    const existingIds = new Set(loadedResearches.map((research) => research.id));
    const catalog = getResearchCatalog();

    for (const researchId of selectedResearchIds) {
        if (!existingIds.has(researchId)) {
            loadedResearches.push({
                id: researchId,
                name: catalog[researchId] || `Исследование ${researchId}`
            });
        }
    }

    loadedResearches.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

function renderResearchList() {
    const list = document.getElementById('researchList');
    const counter = document.getElementById('selectedResearchCounter');
    const searchValue = document.getElementById('researchSearch').value.trim().toLowerCase();

    ensureSelectedResearchesInList();
    list.textContent = '';
    counter.textContent = `Выбрано: ${selectedResearchIds.size}`;

    const filteredResearches = loadedResearches.filter((research) => {
        const haystack = `${research.name} ${research.id}`.toLowerCase();
        return haystack.includes(searchValue);
    });

    if (filteredResearches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Исследования не найдены';
        list.appendChild(empty);
        return;
    }

    for (const research of filteredResearches) {
        const label = document.createElement('label');
        label.className = 'research-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedResearchIds.has(research.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedResearchIds.add(research.id);
            } else {
                selectedResearchIds.delete(research.id);
            }
            counter.textContent = `Выбрано: ${selectedResearchIds.size}`;
        });

        const text = document.createElement('span');
        text.textContent = research.name;

        label.append(checkbox, text);
        list.appendChild(label);
    }
}

function openSettingsPanel() {
    document.getElementById('settingsPanel').classList.remove('hidden');
    renderTemplateLibraryList();
    renderProfileManagerList();
}

function closeSettingsPanel() {
    document.getElementById('settingsPanel').classList.add('hidden');
    closeProfileEditor();
}

async function openProfileEditor(profileName = null) {
    const editor = document.getElementById('profileEditor');
    const title = document.getElementById('editorTitle');
    const nameInput = document.getElementById('profileNameInput');
    const saveButton = document.getElementById('saveProfile');

    editingProfileName = profileName;

    if (profileName) {
        const profileLibrary = getTemplateLibrary();
        const profileTitle = splitProfileTitle(profileName);
        selectedProfileIcon = profileTitle.icon;
        selectedResearchIds = new Set(Object.keys(profileLibrary[profileName] || {}));
        nameInput.value = profileTitle.name;
        title.textContent = 'Редактирование профиля';
        saveButton.textContent = 'Сохранить назначение';
    } else {
        selectedProfileIcon = PROFILE_ICONS[0];
        selectedResearchIds = new Set();
        nameInput.value = '';
        title.textContent = 'Новое назначение';
        saveButton.textContent = 'Добавить назначение';
    }

    document.getElementById('researchSearch').value = '';
    editor.classList.remove('hidden');
    renderIconPicker();
    renderResearchList();

    await loadResearchesForEditor();
}

function closeProfileEditor() {
    editingProfileName = null;
    selectedResearchIds = new Set();
    document.getElementById('profileEditor').classList.add('hidden');
}

function saveProfileFromEditor() {
    const nameInput = document.getElementById('profileNameInput');
    const profileName = nameInput.value.trim();

    if (!profileName) {
        setStatus('❌ Укажите название назначения', '#f44336');
        return;
    }

    if (selectedResearchIds.size === 0) {
        setStatus('❌ Выберите хотя бы одно исследование', '#f44336');
        return;
    }

    const newTitle = makeProfileTitle(selectedProfileIcon, profileName);
    const customProfiles = getCustomProfiles();
    const activeProfileNames = new Set(getActiveProfileNames());
    const profileLibrary = getTemplateLibrary();
    const analyses = {};

    if (profileLibrary[newTitle] && editingProfileName !== newTitle && !confirm(`Назначение "${newTitle}" уже существует. Заменить его?`)) {
        return;
    }

    for (const researchId of selectedResearchIds) {
        analyses[researchId] = true;
    }

    mergeResearchCatalog(loadedResearches);

    if (editingProfileName && editingProfileName !== newTitle) {
        delete customProfiles[editingProfileName];
        activeProfileNames.delete(editingProfileName);
    }

    customProfiles[newTitle] = analyses;
    activeProfileNames.add(newTitle);
    saveCustomProfiles(customProfiles);
    saveActiveProfileNames(Array.from(activeProfileNames));
    refreshProfiles();
    populateProfileSelect(newTitle);
    renderTemplateLibraryList();
    renderProfileManagerList();
    closeProfileEditor();
    setStatus(`✅ Назначение "${newTitle}" сохранено`);
}

function deleteProfile(profileName) {
    if (!confirm(`Удалить назначение "${profileName}"?`)) {
        return;
    }

    const customProfiles = getCustomProfiles();
    const activeProfileNames = new Set(getActiveProfileNames());

    delete customProfiles[profileName];
    activeProfileNames.delete(profileName);

    saveCustomProfiles(customProfiles);
    saveActiveProfileNames(Array.from(activeProfileNames));
    refreshProfiles();
    populateProfileSelect();
    renderTemplateLibraryList();
    renderProfileManagerList();
    closeProfileEditor();
    setStatus(`✅ Назначение "${profileName}" удалено`);
}

function getPortableConfig() {
    return {
        templates: normalizeProfiles(getTemplateLibrary()),
        activeProfiles: getActiveProfileNames(),
        settings: getAssignmentSettings(),
        researchCatalog: getResearchCatalog()
    };
}

function exportConfigFile() {
    const config = getPortableConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = CONFIG_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`✅ Файл ${CONFIG_FILE_NAME} подготовлен`);
}

function importConfigObject(config) {
    const importedTemplates = normalizeProfiles(config?.templates || config?.profiles);
    const importedActiveProfiles = Array.isArray(config?.activeProfiles)
        ? normalizeProfileNameList(config.activeProfiles, importedTemplates)
        : normalizeProfileNameList(Object.keys(importedTemplates), importedTemplates);
    const importedSettings = normalizeAssignmentSettings(config?.settings || {});
    const importedCatalog = getNormalizedResearchCatalog(config?.researchCatalog || {});

    saveCustomProfiles(importedTemplates);
    saveActiveProfileNames(importedActiveProfiles);
    saveResearchCatalog(importedCatalog);
    saveAssignmentSettings(importedSettings);

    refreshProfiles();
    loadedResearches = loadSavedResearches();
    populateProfileSelect();
    renderTemplateLibraryList();
    renderProfileManagerList();
    updateAssignmentStageUi();
    closeProfileEditor();
    setStatus('✅ Настройки импортированы');
}

function importConfigFile(file) {
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        try {
            importConfigObject(JSON.parse(String(reader.result || '{}')));
        } catch (error) {
            console.error('Не удалось импортировать настройки', error);
            setStatus('❌ Не удалось прочитать файл настроек', '#f44336');
        }
    };
    reader.readAsText(file, 'utf-8');
}

async function loadResearchesForEditor() {
    const loadButton = document.getElementById('loadResearches');
    const loadStatus = document.getElementById('researchLoadStatus');

    loadButton.disabled = true;
    loadStatus.textContent = 'Загрузка исследований со страницы БАРС...';

    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0]) {
                loadStatus.textContent = 'Активная вкладка не найдена';
                loadButton.disabled = false;
                renderResearchList();
                resolve();
                return;
            }

            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: readResearchesFromPage
            }, (results) => {
                loadButton.disabled = false;

                if (chrome.runtime.lastError) {
                    loadStatus.textContent = `Не удалось считать исследования: ${chrome.runtime.lastError.message}`;
                    renderResearchList();
                    resolve();
                    return;
                }

                const result = results && results[0] && results[0].result;
                const pageResearches = result && Array.isArray(result.researches) ? result.researches : [];

                if (pageResearches.length) {
                    mergeResearchCatalog(pageResearches);
                } else {
                    loadedResearches = loadSavedResearches();
                }

                loadStatus.textContent = loadedResearches.length
                    ? `Загружено исследований: ${loadedResearches.length}`
                    : 'Исследования не найдены. Откройте страницу назначений в БАРС.';

                renderResearchList();
                resolve();
            });
        });
    });
}

async function readResearchesFromPage() {
    const CHECKBOX_SELECTOR = 'input[name="GridResearch_SelectList_Item"]';
    const TARGET_PAGE_SIZE = 150;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const getCheckboxes = () => Array.from(document.querySelectorAll(CHECKBOX_SELECTOR));
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizeLabel = (value) => normalizeText(value).toLowerCase();

    const isVisible = (element) => {
        if (!element || !element.isConnected) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0';
    };

    const getElementLabel = (element) => normalizeLabel([
        element.textContent,
        element.value,
        element.title,
        element.getAttribute('aria-label')
    ].filter(Boolean).join(' '));

    const clickElement = (element, useDoubleClick = true) => {
        const rect = element.getBoundingClientRect();
        const clientX = rect.left + Math.max(1, rect.width / 2);
        const clientY = rect.top + Math.max(1, rect.height / 2);
        const makeMouseEvent = (type) => new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            screenX: window.screenX + clientX,
            screenY: window.screenY + clientY,
            button: 0,
            buttons: type === 'mouseup' ? 0 : 1
        });

        element.dispatchEvent(makeMouseEvent('mouseover'));
        element.dispatchEvent(makeMouseEvent('mousemove'));
        element.dispatchEvent(makeMouseEvent('mousedown'));
        element.dispatchEvent(makeMouseEvent('mouseup'));
        element.dispatchEvent(makeMouseEvent('click'));
        if (useDoubleClick) {
            element.dispatchEvent(makeMouseEvent('dblclick'));
        }
    };

    const dispatchValueEvents = (element) => {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.dispatchEvent(new KeyboardEvent('keypress', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.blur();
    };

    const isPagerArea = (element) => {
        const rect = element.getBoundingClientRect();
        const inBottomPart = rect.top >= window.innerHeight * 0.35 || rect.bottom >= window.innerHeight * 0.5;
        const inRightPart = rect.left >= window.innerWidth * 0.3;

        return inBottomPart && inRightPart;
    };

    const waitForRowsReload = async (previousCount) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < 7000) {
            await sleep(250);

            const currentCount = getCheckboxes().length;
            if (currentCount >= 100 || currentCount > previousCount) {
                return currentCount;
            }
        }

        return getCheckboxes().length;
    };

    const waitForCheckboxesToSettle = async () => {
        const startedAt = Date.now();
        let lastCount = getCheckboxes().length;
        let stableSince = Date.now();

        while (Date.now() - startedAt < 7000) {
            await sleep(250);

            const currentCount = getCheckboxes().length;
            if (currentCount !== lastCount) {
                lastCount = currentCount;
                stableSince = Date.now();
            }

            if (currentCount > 0 && Date.now() - startedAt >= 1200 && Date.now() - stableSince >= 500) {
                return currentCount;
            }
        }

        return getCheckboxes().length;
    };

    const setInputValue = async (input, value) => {
        input.focus();

        const valuePrototype = input instanceof window.HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(valuePrototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(input, String(value));
        } else {
            input.value = String(value);
        }

        dispatchValueEvents(input);
        await sleep(150);
    };

    const setSelectValue = async (select, value) => {
        const targetOption = Array.from(select.options).find((option) => {
            const optionValue = option.value.trim();
            const optionText = option.textContent.trim();
            return optionValue === String(value) || optionText === String(value);
        });

        if (!targetOption) {
            return false;
        }

        select.value = targetOption.value;
        dispatchValueEvents(select);
        await sleep(150);
        return true;
    };

    const openAllResearches = async () => {
        const target = Array.from(document.querySelectorAll('button, a, span, div, td, input[type="button"], input[type="submit"]'))
            .filter((element) => isVisible(element)
                && getElementLabel(element).includes('все исследования')
                && element.querySelectorAll(CHECKBOX_SELECTOR).length === 0)
            .sort((left, right) => {
                const leftLabel = getElementLabel(left);
                const rightLabel = getElementLabel(right);
                const leftExact = leftLabel === 'все исследования' ? 10000 : 0;
                const rightExact = rightLabel === 'все исследования' ? 10000 : 0;

                return (rightExact - rightLabel.length) - (leftExact - leftLabel.length);
            })[0];

        if (target) {
            clickElement(target, false);
            await waitForCheckboxesToSettle();
        }
    };

    const trySetPageSizeTo150 = async () => {
        const currentCount = getCheckboxes().length;

        if (currentCount >= 100) {
            return currentCount;
        }

        const pageSizes = new Set(['5', '10', '15', '20', '25', '30', '50', '100']);
        const currentCountText = String(currentCount);
        const editableSelector = 'input[type="number"], input[type="text"], input:not([type]), textarea, [contenteditable="true"]';
        const isPotentialPageSizeInput = (input, allowEmpty = false) => {
            const value = 'value' in input ? String(input.value).trim() : input.textContent.trim();
            const marker = `${input.id || ''} ${input.name || ''} ${input.className || ''} ${input.getAttribute('aria-label') || ''}`;
            const hasPageSizeMarker = /pagesize|page-size|size|row|limit|count|record|perpage|per-page|запис|строк|размер|колич/i.test(marker);

            return isVisible(input)
                && !input.disabled
                && !input.readOnly
                && isPagerArea(input)
                && (pageSizes.has(value) || hasPageSizeMarker || (allowEmpty && value === ''));
        };

        const selects = Array.from(document.querySelectorAll('select'))
            .filter((select) => isVisible(select) && !select.disabled && isPagerArea(select));

        for (const select of selects) {
            if (await setSelectValue(select, TARGET_PAGE_SIZE)) {
                return waitForRowsReload(currentCount);
            }
        }

        const inputs = Array.from(document.querySelectorAll('input[type="number"], input[type="text"], input:not([type])'))
            .filter((input) => isPotentialPageSizeInput(input));

        for (const input of inputs) {
            await setInputValue(input, TARGET_PAGE_SIZE);
            const count = await waitForRowsReload(currentCount);

            if (count > currentCount) {
                return count;
            }
        }

        const clickableElements = Array.from(document.querySelectorAll('button, span, div, a, td'))
            .filter((element) => {
                const text = element.textContent.trim();
                const marker = `${element.title || ''} ${element.getAttribute('aria-label') || ''} ${element.className || ''}`;
                const isRecordsControl = /запис|record|row|pagesize|page-size/i.test(marker);

                return isVisible(element)
                    && isPagerArea(element)
                    && (pageSizes.has(text) || text === currentCountText || isRecordsControl)
                    && element.querySelectorAll(CHECKBOX_SELECTOR).length === 0;
            })
            .sort((left, right) => {
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                const leftMarker = `${left.title || ''} ${left.getAttribute('aria-label') || ''} ${left.className || ''}`;
                const rightMarker = `${right.title || ''} ${right.getAttribute('aria-label') || ''} ${right.className || ''}`;
                const leftPriority = /запис|record|row|pagesize|page-size/i.test(leftMarker) ? 10000 : 0;
                const rightPriority = /запис|record|row|pagesize|page-size/i.test(rightMarker) ? 10000 : 0;

                return (rightPriority + rightRect.bottom + rightRect.right) - (leftPriority + leftRect.bottom + leftRect.right);
            });

        for (const element of clickableElements) {
            const knownVisibleEditors = new Set(Array.from(document.querySelectorAll(editableSelector)).filter(isVisible));
            clickElement(element);
            await sleep(200);

            const active = document.activeElement;
            if (active && /^(INPUT|TEXTAREA)$/i.test(active.tagName) && isPotentialPageSizeInput(active, true)) {
                await setInputValue(active, TARGET_PAGE_SIZE);
            } else {
                const editor = Array.from(document.querySelectorAll(editableSelector))
                    .filter((candidate) => isPotentialPageSizeInput(candidate, true))
                    .find((candidate) => !knownVisibleEditors.has(candidate));

                if (!editor) {
                    continue;
                }

                if (/^(INPUT|TEXTAREA)$/i.test(editor.tagName)) {
                    await setInputValue(editor, TARGET_PAGE_SIZE);
                } else {
                    editor.textContent = String(TARGET_PAGE_SIZE);
                    dispatchValueEvents(editor);
                }
            }

            const count = await waitForRowsReload(currentCount);
            if (count > currentCount) {
                return count;
            }
        }

        return getCheckboxes().length;
    };

    const getResearchName = (checkbox, researchId) => {
        const MATERIAL_NAMES = new Set([
            'сыворотка крови',
            'кровь',
            'кровь венозная',
            'кровь капиллярная',
            'моча',
            'осадок мочи',
            'кал',
            'мокрота',
            'ликвор',
            'слюна',
            'гной',
            'отделяемое',
            'отделяемое из уха',
            'отделяемое влагалища',
            'отделяемое уретры',
            'отделяемое женских мочеполовых органов',
            'отделяемое из носа',
            'плазма крови бедная тромбоцитами',
            'жидкость плевральная',
            'носоглоточная слизь',
            'слизь с миндалин',
            'мазок слизистой ротоглотки',
            'соскоб'
        ]);

        const splitText = (text) => String(text || '')
            .split(/\r?\n|\t+/)
            .map((part) => normalizeText(part))
            .filter(Boolean);

        const getElementTextParts = (element) => splitText(element ? element.innerText || element.textContent : '');

        const isTechnicalText = (text) => {
            const normalized = normalizeLabel(text).replace(/\.$/, '');

            return !normalized
                || normalized === researchId
                || /^\d+$/.test(normalized)
                || /^[ab]\d{2}(?:\.\d{2,3})+(?:\.\d+)?$/i.test(normalized)
                || MATERIAL_NAMES.has(normalized)
                || /^(да|нет|true|false)$/i.test(normalized);
        };

        const pickResearchName = (texts) => {
            return texts
                .map((text) => normalizeText(text))
                .find((text) => text.length > 1 && text.length <= 220 && !isTechnicalText(text))
                || '';
        };

        const row = checkbox.closest('tr') || checkbox.closest('[role="row"]') || checkbox.parentElement;
        const cellTexts = row
            ? Array.from(row.querySelectorAll('td, [role="gridcell"]')).flatMap(getElementTextParts)
            : [];
        const rowTexts = getElementTextParts(row);
        const checkboxText = normalizeText(checkbox.title || checkbox.getAttribute('aria-label') || '');
        const checkboxRect = checkbox.getBoundingClientRect();
        const checkboxCenterY = checkboxRect.top + checkboxRect.height / 2;
        const visualRowTexts = Array.from(document.querySelectorAll('td, [role="gridcell"], span, div'))
            .filter((element) => {
                if (!isVisible(element) || element.contains(checkbox) || checkbox.contains(element)) {
                    return false;
                }

                const rect = element.getBoundingClientRect();
                const verticallyAligned = checkboxCenterY >= rect.top - 3 && checkboxCenterY <= rect.bottom + 3;
                const isRightOfCheckbox = rect.left >= checkboxRect.right - 5;

                return verticallyAligned && isRightOfCheckbox;
            })
            .flatMap(getElementTextParts);

        return pickResearchName(cellTexts)
            || pickResearchName(rowTexts)
            || pickResearchName(visualRowTexts)
            || pickResearchName([checkboxText])
            || `Исследование ${researchId}`;
    };

    await openAllResearches();
    await trySetPageSizeTo150();
    await waitForCheckboxesToSettle();

    const byId = new Map();
    for (const checkbox of getCheckboxes()) {
        const researchId = checkbox.getAttribute('item_value');
        if (!researchId || byId.has(researchId)) {
            continue;
        }

        byId.set(researchId, {
            id: researchId,
            name: getResearchName(checkbox, researchId)
        });
    }

    return {
        researches: Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name, 'ru')),
        count: byId.size
    };
}

function saveScenarioSettingsFromUi() {
    const slider = document.getElementById('assignmentStageSlider');
    const targetCabinetInput = document.getElementById('targetCabinetInput');
    const markUrgentCheckbox = document.getElementById('markUrgentCheckbox');
    const settings = saveAssignmentSettings({
        assignmentStage: slider?.value === '1' ? ASSIGNMENT_STAGE_SCHEDULE : ASSIGNMENT_STAGE_ANALYSES,
        targetCabinet: targetCabinetInput?.value || '',
        markUrgent: markUrgentCheckbox?.checked === true
    });

    updateAssignmentStageUi(settings);
}

// Заполняем выпадающий список профилями
document.addEventListener('DOMContentLoaded', async () => {
    applyExtensionConfig(await loadExtensionConfigFile());
    refreshProfiles();
    populateProfileSelect();
    renderTemplateLibraryList();
    renderProfileManagerList();
    updateAssignmentStageUi();

    document.getElementById('settingsToggle').addEventListener('click', openSettingsPanel);
    document.getElementById('closeSettings').addEventListener('click', closeSettingsPanel);
    document.getElementById('addProfile').addEventListener('click', () => openProfileEditor());
    document.getElementById('cancelEdit').addEventListener('click', closeProfileEditor);
    document.getElementById('saveProfile').addEventListener('click', saveProfileFromEditor);
    document.getElementById('loadResearches').addEventListener('click', loadResearchesForEditor);
    document.getElementById('researchSearch').addEventListener('input', renderResearchList);
    document.getElementById('assignmentStageSlider').addEventListener('input', saveScenarioSettingsFromUi);
    document.getElementById('targetCabinetInput').addEventListener('input', saveScenarioSettingsFromUi);
    document.getElementById('markUrgentCheckbox').addEventListener('change', saveScenarioSettingsFromUi);
    document.getElementById('exportConfig').addEventListener('click', exportConfigFile);
    document.getElementById('importConfig').addEventListener('click', () => document.getElementById('importConfigFile').click());
    document.getElementById('importConfigFile').addEventListener('change', (event) => {
        importConfigFile(event.target.files?.[0]);
        event.target.value = '';
    });
});

// Обработчик кнопки "Заполнить форму"
document.getElementById('fillForm').addEventListener('click', () => {
    const select = document.getElementById('profileSelect');
    const fillButton = document.getElementById('fillForm');
    const selectedProfile = select.value;
    const statusDiv = document.getElementById('status');

    if (fillButton.disabled) {
        return;
    }
    
    if (!selectedProfile) {
        statusDiv.textContent = '❌ Пожалуйста, выберите профиль';
        statusDiv.style.color = '#f44336';
        return;
    }
    
    if (!PROFILES[selectedProfile]) {
        statusDiv.textContent = '❌ Ошибка: профиль не найден';
        statusDiv.style.color = '#f44336';
        return;
    }
    
    localStorage.setItem('lastSelectedProfile', selectedProfile);
    
    const formData = PROFILES[selectedProfile];
    const assignmentSettings = getAssignmentSettings();
    statusDiv.textContent = '⏳ Заполнение...';
    statusDiv.style.color = '#ff9800';
    fillButton.disabled = true;
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
            statusDiv.textContent = '❌ Ошибка: активная вкладка не найдена';
            statusDiv.style.color = '#f44336';
            fillButton.disabled = false;
            return;
        }

        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: fillForm,
            args: [formData, selectedProfile, assignmentSettings]
        }, (results) => {
            if (chrome.runtime.lastError) {
                statusDiv.textContent = `❌ Ошибка: ${chrome.runtime.lastError.message}`;
                statusDiv.style.color = '#f44336';
            } else if (results && results[0] && results[0].result) {
                const result = results[0].result;
                statusDiv.textContent = `✅ ${result.message}`;
                statusDiv.style.color = '#4CAF50';
            } else {
                statusDiv.textContent = '✅ Заполнение выполнено';
                statusDiv.style.color = '#4CAF50';
            }

            fillButton.disabled = false;
        });
    });
});

// Закрытие попапа
document.getElementById('closePopup').addEventListener('click', () => {
    window.close();
});

// ==============================================
// ФУНКЦИЯ ЗАПОЛНЕНИЯ ФОРМЫ
// ==============================================
async function fillForm(formData, profileName, assignmentSettings = {}) {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║  МИС БАРС - Автоматическое назначение анализов           ║");
    console.log("║  Разработчик: MorozovRV and Bitucckii VA                 ║");
    console.log("║  Версия: 3.0                                              ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`=== Автозаполнение: профиль "${profileName}" ===`);
    
    let filledCount = 0;

    const CHECKBOX_SELECTOR = 'input[name="GridResearch_SelectList_Item"]';
    const TARGET_PAGE_SIZE = 150;
    const ASSIGNMENT_STAGE_ANALYSES = 'analyses';
    const ASSIGNMENT_STAGE_SCHEDULE = 'schedule';
    const targetCabinetName = String(assignmentSettings?.targetCabinet || '').trim();
    const normalizedAssignmentStage = targetCabinetName && assignmentSettings?.assignmentStage === ASSIGNMENT_STAGE_SCHEDULE
        ? ASSIGNMENT_STAGE_SCHEDULE
        : ASSIGNMENT_STAGE_ANALYSES;
    const shouldMarkUrgent = assignmentSettings?.markUrgent === true;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const getCheckboxes = () => Array.from(document.querySelectorAll(CHECKBOX_SELECTOR));

    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

    const getElementLabel = (element) => normalizeText([
        element.textContent,
        element.value,
        element.title,
        element.getAttribute('aria-label')
    ].filter(Boolean).join(' '));

    const clickElement = (element, useDoubleClick = true) => {
        const rect = element.getBoundingClientRect();
        const clientX = rect.left + Math.max(1, rect.width / 2);
        const clientY = rect.top + Math.max(1, rect.height / 2);
        const makeMouseEvent = (type) => new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            screenX: window.screenX + clientX,
            screenY: window.screenY + clientY,
            button: 0,
            buttons: type === 'mouseup' ? 0 : 1
        });

        element.dispatchEvent(makeMouseEvent('mouseover'));
        element.dispatchEvent(makeMouseEvent('mousemove'));
        element.dispatchEvent(makeMouseEvent('mousedown'));
        element.dispatchEvent(makeMouseEvent('mouseup'));
        element.dispatchEvent(makeMouseEvent('click'));
        if (useDoubleClick) {
            element.dispatchEvent(makeMouseEvent('dblclick'));
        }
    };

    const isVisible = (element) => {
        if (!element || !element.isConnected) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0';
    };

    const findCheckboxByItemValue = (itemValue) => {
        return getCheckboxes().find((checkbox) => checkbox.getAttribute('item_value') === itemValue);
    };

    const clickCheckboxLikeUser = (checkbox) => {
        checkbox.scrollIntoView({ block: 'center', inline: 'nearest' });
        if (typeof checkbox.focus === 'function') {
            checkbox.focus();
        }

        checkbox.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        checkbox.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
        checkbox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        checkbox.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        checkbox.click();
    };

    const waitForBarsToProcessSelection = async () => {
        await sleep(220);
    };

    const setCheckboxStateThroughBars = async (itemValue, desiredState) => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const checkbox = findCheckboxByItemValue(itemValue);

            if (!checkbox) {
                console.warn(`Анализ не найден на странице: ${itemValue}`);
                return false;
            }

            if (checkbox.checked === desiredState) {
                return true;
            }

            clickCheckboxLikeUser(checkbox);
            await waitForBarsToProcessSelection();
        }

        return !!findCheckboxByItemValue(itemValue)?.checked === desiredState;
    };

    const resyncSelectedCheckboxThroughBars = async (itemValue) => {
        const checkbox = findCheckboxByItemValue(itemValue);

        if (!checkbox) {
            console.warn(`Анализ не найден на странице: ${itemValue}`);
            return false;
        }

        if (checkbox.checked) {
            const isCleared = await setCheckboxStateThroughBars(itemValue, false);
            if (!isCleared) {
                return false;
            }
        }

        return setCheckboxStateThroughBars(itemValue, true);
    };

    const dispatchValueEvents = (element) => {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.dispatchEvent(new KeyboardEvent('keypress', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        }));
        element.blur();
    };

    const isPagerArea = (element, root) => {
        const rect = element.getBoundingClientRect();
        const rootRect = root === document.body
            ? { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight }
            : root.getBoundingClientRect();

        const inRoot = rect.left >= rootRect.left - 20
            && rect.right <= rootRect.right + 20
            && rect.top >= rootRect.top - 20
            && rect.bottom <= rootRect.bottom + 80;

        const rootHeight = Math.max(rootRect.height, window.innerHeight);
        const rootWidth = Math.max(rootRect.width, window.innerWidth);
        const inBottomPart = rect.top >= rootRect.top + rootHeight * 0.35 || rect.bottom >= window.innerHeight * 0.5;
        const inRightPart = rect.left >= rootRect.left + rootWidth * 0.3;

        return inRoot && inBottomPart && inRightPart;
    };

    const waitForRowsReload = async (previousCount) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < 7000) {
            await sleep(250);

            const currentCount = getCheckboxes().length;
            if (currentCount >= 100 || currentCount > previousCount) {
                return currentCount;
            }
        }

        return getCheckboxes().length;
    };

    const waitForCheckboxesToSettle = async () => {
        const startedAt = Date.now();
        let lastCount = getCheckboxes().length;
        let stableSince = Date.now();

        while (Date.now() - startedAt < 7000) {
            await sleep(250);

            const currentCount = getCheckboxes().length;
            if (currentCount !== lastCount) {
                lastCount = currentCount;
                stableSince = Date.now();
            }

            if (currentCount > 0 && Date.now() - startedAt >= 1200 && Date.now() - stableSince >= 500) {
                return currentCount;
            }
        }

        return getCheckboxes().length;
    };

    const setInputValue = async (input, value) => {
        input.focus();

        const valuePrototype = input instanceof window.HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(valuePrototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(input, String(value));
        } else {
            input.value = String(value);
        }

        dispatchValueEvents(input);
        await sleep(150);
    };

    const setSelectValue = async (select, value) => {
        const targetOption = Array.from(select.options).find((option) => {
            const optionValue = option.value.trim();
            const optionText = option.textContent.trim();
            return optionValue === String(value) || optionText === String(value);
        });

        if (!targetOption) {
            return false;
        }

        select.value = targetOption.value;
        dispatchValueEvents(select);
        await sleep(150);
        return true;
    };

    const setEditableText = async (element, value) => {
        element.focus();

        if (element.isContentEditable) {
            element.textContent = String(value);
        } else {
            element.click();
            await sleep(150);

            const active = document.activeElement;
            if (active && active !== element && /^(INPUT|TEXTAREA)$/i.test(active.tagName)) {
                await setInputValue(active, value);
                return true;
            }

            element.textContent = String(value);
        }

        dispatchValueEvents(element);
        await sleep(150);
        return true;
    };

    const openAllResearches = async () => {
        const candidates = Array.from(document.querySelectorAll('button, a, span, div, td, input[type="button"], input[type="submit"]'))
            .filter((element) => {
                const label = getElementLabel(element);

                return isVisible(element)
                    && label.includes('все исследования')
                    && element.querySelectorAll(CHECKBOX_SELECTOR).length === 0;
            })
            .sort((left, right) => {
                const leftLabel = getElementLabel(left);
                const rightLabel = getElementLabel(right);
                const leftExact = leftLabel === 'все исследования' ? 10000 : 0;
                const rightExact = rightLabel === 'все исследования' ? 10000 : 0;
                const leftTag = /^(BUTTON|A|INPUT)$/i.test(left.tagName) ? 1000 : 0;
                const rightTag = /^(BUTTON|A|INPUT)$/i.test(right.tagName) ? 1000 : 0;

                return (rightExact + rightTag - rightLabel.length) - (leftExact + leftTag - leftLabel.length);
            });

        const target = candidates[0];
        if (!target) {
            console.warn('Кнопка "Все исследования" не найдена. Продолжаю с текущим списком.');
            return { clicked: false, count: getCheckboxes().length };
        }

        clickElement(target, false);
        const count = await waitForCheckboxesToSettle();
        console.log(`Открыт раздел "Все исследования". Текущих чек-боксов: ${count}`);

        return { clicked: true, count };
    };

    const trySetPageSizeTo150 = async () => {
        const currentCount = getCheckboxes().length;

        if (currentCount >= 100) {
            return { changed: false, reason: 'already_full', count: currentCount };
        }

        const root = document.body;
        const pageSizes = new Set(['5', '10', '15', '20', '25', '30', '50', '100']);
        const currentCountText = String(currentCount);
        const editableSelector = 'input[type="number"], input[type="text"], input:not([type]), textarea, [contenteditable="true"]';
        const isPotentialPageSizeInput = (input, allowEmpty = false) => {
            const value = 'value' in input ? String(input.value).trim() : input.textContent.trim();
            const marker = `${input.id || ''} ${input.name || ''} ${input.className || ''} ${input.getAttribute('aria-label') || ''}`;
            const hasPageSizeMarker = /pagesize|page-size|size|row|limit|count|record|perpage|per-page|запис|строк|размер|колич/i.test(marker);

            return isVisible(input)
                && !input.disabled
                && !input.readOnly
                && isPagerArea(input, root)
                && (pageSizes.has(value) || hasPageSizeMarker || (allowEmpty && value === ''));
        };

        const selects = Array.from(root.querySelectorAll('select'))
            .filter((select) => isVisible(select) && !select.disabled && isPagerArea(select, root));

        for (const select of selects) {
            if (await setSelectValue(select, TARGET_PAGE_SIZE)) {
                const count = await waitForRowsReload(currentCount);
                return { changed: count > currentCount, reason: 'select', count };
            }
        }

        const inputs = Array.from(root.querySelectorAll('input[type="number"], input[type="text"], input:not([type])'))
            .filter((input) => isPotentialPageSizeInput(input));

        for (const input of inputs) {
            await setInputValue(input, TARGET_PAGE_SIZE);
            const count = await waitForRowsReload(currentCount);

            if (count > currentCount) {
                return { changed: true, reason: 'input', count };
            }
        }

        const clickableElements = Array.from(root.querySelectorAll('button, span, div, a, td'))
            .filter((element) => {
                const text = element.textContent.trim();
                const marker = `${element.title || ''} ${element.getAttribute('aria-label') || ''} ${element.className || ''}`;
                const isRecordsControl = /запис|record|row|pagesize|page-size/i.test(marker);

                return isVisible(element)
                    && isPagerArea(element, root)
                    && (pageSizes.has(text) || text === currentCountText || isRecordsControl)
                    && element.querySelectorAll(CHECKBOX_SELECTOR).length === 0;
            })
            .sort((left, right) => {
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                const leftMarker = `${left.title || ''} ${left.getAttribute('aria-label') || ''} ${left.className || ''}`;
                const rightMarker = `${right.title || ''} ${right.getAttribute('aria-label') || ''} ${right.className || ''}`;
                const leftPriority = /запис|record|row|pagesize|page-size/i.test(leftMarker) ? 10000 : 0;
                const rightPriority = /запис|record|row|pagesize|page-size/i.test(rightMarker) ? 10000 : 0;

                return (rightPriority + rightRect.bottom + rightRect.right) - (leftPriority + leftRect.bottom + leftRect.right);
            });

        for (const element of clickableElements) {
            const knownVisibleEditors = new Set(Array.from(document.querySelectorAll(editableSelector)).filter(isVisible));
            clickElement(element);
            await sleep(200);

            const active = document.activeElement;
            if (active && /^(INPUT|TEXTAREA)$/i.test(active.tagName) && isPotentialPageSizeInput(active, true)) {
                await setInputValue(active, TARGET_PAGE_SIZE);
            } else {
                const editor = Array.from(document.querySelectorAll(editableSelector))
                    .filter((candidate) => isPotentialPageSizeInput(candidate, true))
                    .find((candidate) => !knownVisibleEditors.has(candidate));

                if (!editor) {
                    continue;
                }

                if (/^(INPUT|TEXTAREA)$/i.test(editor.tagName)) {
                    await setInputValue(editor, TARGET_PAGE_SIZE);
                } else {
                    await setEditableText(editor, TARGET_PAGE_SIZE);
                }
            }

            const count = await waitForRowsReload(currentCount);
            if (count > currentCount) {
                return { changed: true, reason: 'clickable', count };
            }
        }

        return { changed: false, reason: 'not_found', count: getCheckboxes().length };
    };

    const ASSIGNMENT_CABINET_LABEL = normalizeText(targetCabinetName);
    const ASSIGNMENT_CABINET_TOKENS = ASSIGNMENT_CABINET_LABEL.split(' ').filter(Boolean);
    const DEBUG_LOG_KEY = '__FillBARS_DEBUG_LOGS';
    const DEBUG_LOG_NODE_ID = 'fillbars-debug-logs';
    const DEBUG_LOG_STORAGE_KEY = 'FillBARS.debugLogs';

    window[DEBUG_LOG_KEY] = [];

    const publishDebugLogs = () => {
        const logs = window[DEBUG_LOG_KEY] || [];
        const payload = JSON.stringify(logs, null, 2);

        try {
            sessionStorage.setItem(DEBUG_LOG_STORAGE_KEY, payload);
        } catch (error) {
            // Storage can be blocked by the host page; the DOM holder below is the fallback.
        }

        try {
            let holder = document.getElementById(DEBUG_LOG_NODE_ID);
            if (!holder) {
                holder = document.createElement('script');
                holder.id = DEBUG_LOG_NODE_ID;
                holder.type = 'application/json';
                (document.body || document.documentElement).appendChild(holder);
            }

            holder.textContent = payload;
        } catch (error) {
            console.warn('[FillBARS] Не удалось опубликовать отладочный лог', error);
        }
    };

    const compactValue = (value) => {
        if (value === undefined || value === null) {
            return value;
        }

        if (typeof value === 'string') {
            return value.length > 180 ? `${value.slice(0, 180)}...` : value;
        }

        if (Array.isArray(value)) {
            return value.slice(0, 20).map(compactValue);
        }

        if (typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value).map(([key, entryValue]) => [key, compactValue(entryValue)])
            );
        }

        return value;
    };

    const debugLog = (event, details = {}) => {
        const entry = {
            time: new Date().toISOString(),
            event,
            details: compactValue(details)
        };

        window[DEBUG_LOG_KEY].push(entry);
        publishDebugLogs();
        console.log(`[FillBARS] ${event}`, entry.details);
        return entry;
    };

    debugLog('fill:start', {
        profileName,
        assignmentStage: normalizedAssignmentStage,
        targetCabinetName,
        shouldMarkUrgent
    });
    console.log('FillBARS debug: copy(document.getElementById("fillbars-debug-logs")?.textContent || sessionStorage.getItem("FillBARS.debugLogs") || "нет логов")');

    const getVisibleElements = (selector, root = document) => {
        return Array.from(root.querySelectorAll(selector)).filter(isVisible);
    };

    const isVisibleOrInsideVisibleControl = (element) => {
        if (!element || !element.isConnected) {
            return false;
        }

        if (isVisible(element)) {
            return true;
        }

        let current = element.parentElement;
        let depth = 0;
        while (current && depth < 4) {
            if (isVisible(current)) {
                return true;
            }

            current = current.parentElement;
            depth++;
        }

        return false;
    };

    const describeElement = (element) => {
        if (!element) {
            return null;
        }

        const rect = element.getBoundingClientRect();

        return {
            tag: element.tagName,
            id: element.id || '',
            className: String(element.className || ''),
            name: element.name || '',
            type: element.type || '',
            title: element.title || '',
            text: getElementLabel(element),
            rect: {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            },
            visible: isVisibleOrInsideVisibleControl(element)
        };
    };

    const getClickableSurface = (element, stopRoot = document.body) => {
        let current = element;
        let depth = 0;

        while (current && current !== stopRoot && depth < 4) {
            if (isVisible(current)) {
                return current;
            }

            current = current.parentElement;
            depth++;
        }

        return element;
    };

    const waitForCondition = async (predicate, timeout = 10000, interval = 250) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeout) {
            const result = predicate();
            if (result) {
                return result;
            }

            await sleep(interval);
        }

        return null;
    };

    const getZIndex = (element) => {
        const parsed = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const sortByWindowStack = (left, right) => {
        const zIndexDiff = getZIndex(left) - getZIndex(right);
        if (zIndexDiff !== 0) {
            return zIndexDiff;
        }

        if (left === right) {
            return 0;
        }

        return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    };

    const getWindowRoot = (element) => {
        return element?.closest('table.window.WinContent, .window.WinContent, .window') || element;
    };

    const getVisibleWindows = () => {
        return getVisibleElements('table.window.WinContent, .window.WinContent');
    };

    const getTopVisibleWindow = (predicate = () => true) => {
        return getVisibleWindows()
            .filter(predicate)
            .sort(sortByWindowStack)
            .at(-1) || null;
    };

    const findScheduleForm = () => {
        return getVisibleElements('.form-schedule')
            .sort(sortByWindowStack)
            .at(-1) || null;
    };

    const findScheduleWindow = () => {
        const scheduleForm = findScheduleForm();
        return scheduleForm ? getWindowRoot(scheduleForm) : null;
    };

    const hasCabinetLabel = (label) => {
        return ASSIGNMENT_CABINET_TOKENS.length > 0
            && ASSIGNMENT_CABINET_TOKENS.every((token) => label.includes(token));
    };

    const getGridRoot = (element) => {
        return element?.closest('.grid, .grid_container, .grid-container') || element;
    };

    const getSelectableGridRow = (element, root) => {
        if (!element) {
            return null;
        }

        const row = element.closest('tr, [role="row"]');
        if (row && (!root || root.contains(row))) {
            return row;
        }

        const dataCell = element.closest('.column_data');
        if (dataCell && (!root || root.contains(dataCell))) {
            return dataCell;
        }

        return element;
    };

    const normalizeClickableCandidate = (element) => {
        return element.closest('.ctrl_button, button, input[type="button"], input[type="submit"], a') || element;
    };

    const deduplicateElements = (elements) => {
        const seen = new Set();

        return elements.filter((element) => {
            if (!element || seen.has(element)) {
                return false;
            }

            seen.add(element);
            return true;
        });
    };

    const getElementPositionKey = (element) => {
        const rect = element.getBoundingClientRect();
        return `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${element.name || ''}`;
    };

    const uniqueElementsByPosition = (elements) => {
        const seen = new Set();

        return elements.filter((element) => {
            const key = getElementPositionKey(element);
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    };

    const getScheduleGridRoot = (scheduleForm) => {
        return scheduleForm.querySelector('.selected_values') || scheduleForm;
    };

    const findColumnHeaderRect = (root, columnLabel) => {
        const normalizedColumnLabel = normalizeText(columnLabel);
        const headers = getVisibleElements('td, th, div, span', root)
            .filter((element) => {
                const label = getElementLabel(element);
                return label === normalizedColumnLabel
                    || label === `сортировать колонку: ${normalizedColumnLabel}`;
            })
            .sort((left, right) => {
                const leftLabel = getElementLabel(left);
                const rightLabel = getElementLabel(right);
                const leftPriority = (leftLabel === normalizedColumnLabel ? 10000 : 0) - leftLabel.length;
                const rightPriority = (rightLabel === normalizedColumnLabel ? 10000 : 0) - rightLabel.length;

                return rightPriority - leftPriority;
            });

        return headers[0]?.getBoundingClientRect() || null;
    };

    const isElementInColumn = (element, headerRect, tolerance = 35) => {
        if (!headerRect) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;

        return centerX >= headerRect.left - tolerance
            && centerX <= headerRect.right + tolerance
            && rect.top > headerRect.top;
    };

    const clickAssignButton = async () => {
        if (findScheduleForm()) {
            return true;
        }

        const root = getVisibleElements('.dirline_order_alt').at(-1) || document.body;
        const candidates = deduplicateElements(
            Array.from(root.querySelectorAll('button, a, span, div, input[type="button"], input[type="submit"]'))
                .filter((element) => {
                    const label = getElementLabel(element);

                    return isVisible(element)
                        && label.includes('назначить')
                        && label.length <= 80
                        && element.querySelectorAll(CHECKBOX_SELECTOR).length === 0;
                })
                .map(normalizeClickableCandidate)
        ).sort((left, right) => {
            const leftLabel = getElementLabel(left);
            const rightLabel = getElementLabel(right);
            const leftPriority = (leftLabel === 'назначить' ? 10000 : 0)
                + (left.classList.contains('ctrl_button') ? 5000 : 0)
                + (/^(BUTTON|A|INPUT)$/i.test(left.tagName) ? 1000 : 0)
                - leftLabel.length;
            const rightPriority = (rightLabel === 'назначить' ? 10000 : 0)
                + (right.classList.contains('ctrl_button') ? 5000 : 0)
                + (/^(BUTTON|A|INPUT)$/i.test(right.tagName) ? 1000 : 0)
                - rightLabel.length;

            return rightPriority - leftPriority;
        });

        const target = candidates[0];
        if (!target) {
            console.warn('Кнопка "Назначить" не найдена. Подбор времени не открываю.');
            debugLog('assign_button:not_found');
            return false;
        }

        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        debugLog('assign_button:click', { target: describeElement(target) });
        clickElement(target, false);

        const scheduleForm = await waitForCondition(findScheduleForm, 15000);
        if (!scheduleForm) {
            console.warn('Окно "Подбор времени записи на услугу" не открылось.');
            debugLog('schedule:not_opened');
            return false;
        }

        console.log('Открыто окно "Подбор времени записи на услугу".');
        debugLog('schedule:opened', { scheduleForm: describeElement(scheduleForm) });
        return true;
    };

    const getScheduleCabinetGuideButtons = (scheduleForm) => {
        const cabinetHeaderRect = findColumnHeaderRect(scheduleForm, 'Кабинет');
        const buttons = uniqueElementsByPosition(
            Array.from(scheduleForm.querySelectorAll('.ctrl_ButtonEdit_ButGuide'))
                .filter(isVisible)
                .filter((button) => !button.closest('.grid_header'))
        );
        const buttonsInCabinetColumn = buttons.filter((button) => isElementInColumn(button, cabinetHeaderRect, 80));
        const resultButtons = buttonsInCabinetColumn.length > 0 ? buttonsInCabinetColumn : buttons;

        return resultButtons
            .sort((left, right) => {
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
            })
            .map((button) => ({
                button,
                row: button.closest('tr') || button.parentElement
            }));
    };

    const activateElementAtCenter = async (element, useDoubleClick = false, useNativeClick = false) => {
        if (!element || !element.isConnected) {
            debugLog('element_activate:missing', { useDoubleClick, useNativeClick });
            return false;
        }

        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        await sleep(60);

        if (!isVisible(element)) {
            debugLog('element_activate:not_visible', { element: describeElement(element), useDoubleClick, useNativeClick });
            return false;
        }

        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hitElement = document.elementFromPoint(centerX, centerY);
        const target = hitElement && (element.contains(hitElement) || hitElement.contains(element))
            ? hitElement
            : element;

        debugLog('element_activate:click', {
            element: describeElement(element),
            target: describeElement(target),
            centerX: Math.round(centerX),
            centerY: Math.round(centerY),
            useDoubleClick,
            useNativeClick
        });
        clickElement(target, useDoubleClick);

        if (useNativeClick && typeof target.click === 'function') {
            target.click();
        }

        await sleep(120);
        return true;
    };

    const isCabinetPickerWindow = (windowElement) => {
        if (!windowElement || !windowElement.isConnected || !isVisibleOrInsideVisibleControl(windowElement)) {
            return false;
        }

        if (windowElement.querySelector('.form-schedule')) {
            return false;
        }

        const label = getElementLabel(windowElement);
        return label.startsWith('кабинеты')
            || label.includes('кабинеты наименование')
            || label.includes('кабинетыструктура файла');
    };

    const waitForCabinetWindow = async (scheduleWindow, previousWindows, timeout = 8000) => {
        const cabinetWindow = await waitForCondition(() => {
            const candidates = getVisibleWindows()
                .filter((windowElement) => windowElement !== scheduleWindow)
                .filter(isCabinetPickerWindow)
                .sort(sortByWindowStack);
            const newCandidate = candidates
                .filter((windowElement) => !previousWindows.has(windowElement))
                .at(-1);

            return newCandidate || candidates.at(-1) || null;
        }, timeout, 200);

        if (cabinetWindow) {
            debugLog('cabinet_window:opened', {
                isNew: !previousWindows.has(cabinetWindow),
                window: describeElement(cabinetWindow)
            });
        } else {
            debugLog('cabinet_window:not_found', {
                windows: getVisibleWindows().map((windowElement) => ({
                    isPrevious: previousWindows.has(windowElement),
                    isCabinetPicker: isCabinetPickerWindow(windowElement),
                    containsScheduleForm: !!windowElement.querySelector('.form-schedule'),
                    window: describeElement(windowElement)
                }))
            });
        }

        return cabinetWindow;
    };

    const findCabinetRow = (cabinetWindow) => {
        const root = getGridRoot(cabinetWindow.querySelector('.grid.box-sizing-force.m2, .grid')) || cabinetWindow;
        const elements = Array.from(root.querySelectorAll('tr, [role="row"], td, div, span'))
            .filter(isVisibleOrInsideVisibleControl)
            .filter((element) => hasCabinetLabel(getElementLabel(element)))
            .sort((left, right) => {
                const leftLabel = getElementLabel(left);
                const rightLabel = getElementLabel(right);
                const leftPriority = (leftLabel === ASSIGNMENT_CABINET_LABEL ? 10000 : 0)
                    + (/^(TR)$/i.test(left.tagName) ? 500 : 0)
                    - leftLabel.length;
                const rightPriority = (rightLabel === ASSIGNMENT_CABINET_LABEL ? 10000 : 0)
                    + (/^(TR)$/i.test(right.tagName) ? 500 : 0)
                    - rightLabel.length;

                return rightPriority - leftPriority;
            });

        return getSelectableGridRow(elements[0], root);
    };

    const clickShortLabeledControl = async (root, labels) => {
        const normalizedLabels = labels.map(normalizeText);
        const candidates = deduplicateElements(
            Array.from(root.querySelectorAll('button, a, span, div, input[type="button"], input[type="submit"]'))
                .filter((element) => {
                    const label = getElementLabel(element);

                    return isVisibleOrInsideVisibleControl(element)
                        && normalizedLabels.includes(label)
                        && label.length <= 30;
                })
                .map((element) => getClickableSurface(normalizeClickableCandidate(element), root))
        ).sort((left, right) => getElementLabel(left).length - getElementLabel(right).length);

        const target = candidates[0];
        if (!target) {
            return false;
        }

        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        clickElement(target, false);
        await sleep(300);

        return true;
    };

    const openCabinetFilter = async (cabinetWindow) => {
        const gridRoot = getGridRoot(cabinetWindow.querySelector('.grid.box-sizing-force.m2, .grid')) || cabinetWindow;
        const beforeInputsCount = getVisibleElements('input[type="text"], input:not([type]), textarea', gridRoot).length;
        const filterButtons = Array.from(gridRoot.querySelectorAll('.toggleFilter, .toggleFilterSize, .fshow, .grid_label, [title="Фильтр"]'))
            .filter(isVisibleOrInsideVisibleControl)
            .filter((element) => {
                const label = getElementLabel(element);
                const marker = normalizeText(`${element.title || ''} ${element.className || ''}`);

                return marker.includes('фильтр') || label.includes('показать фильтр');
            });

        for (const button of filterButtons) {
            clickElement(getClickableSurface(button, gridRoot), false);
            await sleep(350);

            const afterInputsCount = getVisibleElements('input[type="text"], input:not([type]), textarea', gridRoot).length;
            const hasHideFilter = getElementLabel(gridRoot).includes('скрыть фильтр');

            if (afterInputsCount > beforeInputsCount || hasHideFilter) {
                return true;
            }
        }

        return false;
    };

    const clickFindInCabinetWindow = async (cabinetWindow) => {
        const gridRoot = getGridRoot(cabinetWindow.querySelector('.grid.box-sizing-force.m2, .grid')) || cabinetWindow;
        return clickShortLabeledControl(gridRoot, ['Найти']);
    };

    const filterCabinetWindow = async (cabinetWindow) => {
        await openCabinetFilter(cabinetWindow);

        const gridRoot = getGridRoot(cabinetWindow.querySelector('.grid.box-sizing-force.m2, .grid')) || cabinetWindow;
        const inputs = getVisibleElements('input[type="text"], input:not([type]), textarea', gridRoot)
            .filter((input) => !input.disabled && !input.readOnly)
            .sort((left, right) => {
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
            });

        console.log(`Окно "Кабинеты": полей фильтра найдено ${inputs.length}.`);
        debugLog('cabinet_filter:inputs_found', {
            inputCount: inputs.length,
            inputs: inputs.map(describeElement)
        });

        for (const input of inputs) {
            debugLog('cabinet_filter:set_value', { input: describeElement(input) });
            await setInputValue(input, targetCabinetName);
            await clickFindInCabinetWindow(cabinetWindow);
            await sleep(900);

            const row = findCabinetRow(cabinetWindow);
            if (row) {
                debugLog('cabinet_filter:row_found', { row: describeElement(row) });
                return row;
            }
        }

        debugLog('cabinet_filter:row_not_found');
        return null;
    };

    const isModalWindowOpen = (windowElement) => {
        return !!windowElement && windowElement.isConnected && isVisibleOrInsideVisibleControl(windowElement);
    };

    const waitForWindowToClose = async (windowElement, timeout = 5000) => {
        return waitForCondition(() => !isModalWindowOpen(windowElement), timeout, 200);
    };

    const dispatchEnter = (element) => {
        const target = element || document.activeElement || document.body;

        ['keydown', 'keypress', 'keyup'].forEach((type) => {
            target.dispatchEvent(new KeyboardEvent(type, {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13
            }));
        });
    };

    const dispatchEscape = (element) => {
        const target = element || document.activeElement || document.body;

        ['keydown', 'keypress', 'keyup'].forEach((type) => {
            target.dispatchEvent(new KeyboardEvent(type, {
                bubbles: true,
                cancelable: true,
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27
            }));
        });
    };

    const clickOkInWindow = async (windowElement) => {
        const windowRect = windowElement.getBoundingClientRect();
        const candidates = deduplicateElements(
            Array.from(windowElement.querySelectorAll('.ctrl_button, .btn_caption, button, a, span, div, input[type="button"], input[type="submit"]'))
                .filter((element) => {
                    const label = getElementLabel(element);
                    const rect = element.getBoundingClientRect();
                    const marker = normalizeText(`${element.className || ''} ${element.title || ''}`);
                    const isFooterButton = marker.includes('btn_center') && rect.top >= windowRect.bottom - 140;

                    return isVisibleOrInsideVisibleControl(element)
                        && !label.includes('отмена')
                        && !label.includes('найти')
                        && !label.includes('фильтр')
                        && !label.includes('очистить')
                        && (label === 'ок' || label === 'ok' || label === 'выбрать' || isFooterButton)
                        && label.length <= 30
                        && rect.top >= windowRect.top
                        && rect.bottom <= windowRect.bottom + 10;
                })
                .map((element) => getClickableSurface(normalizeClickableCandidate(element), windowElement))
        ).sort((left, right) => {
            const leftLabel = getElementLabel(left);
            const rightLabel = getElementLabel(right);
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            const leftPriority = (leftLabel === 'ок' || leftLabel === 'ok' ? 10000 : 0)
                + (leftLabel === 'выбрать' ? 7000 : 0)
                + (left.classList.contains('ctrl_button') ? 5000 : 0)
                + leftRect.top
                - leftLabel.length;
            const rightPriority = (rightLabel === 'ок' || rightLabel === 'ok' ? 10000 : 0)
                + (rightLabel === 'выбрать' ? 7000 : 0)
                + (right.classList.contains('ctrl_button') ? 5000 : 0)
                + rightRect.top
                - rightLabel.length;

            return rightPriority - leftPriority;
        });

        const okButton = candidates[0];
        if (!okButton) {
            return false;
        }

        okButton.scrollIntoView({ block: 'center', inline: 'nearest' });
        console.log(`Окно "Кабинеты": нажимаю "${getElementLabel(okButton) || 'ОК'}".`);
        debugLog('cabinet_confirm:ok_click', { button: describeElement(okButton) });
        clickElement(okButton, false);
        await sleep(500);

        return true;
    };

    const clickCancelInWindow = async (windowElement) => {
        debugLog('cabinet_close:try_cancel');
        const clickedCancel = await clickShortLabeledControl(windowElement, ['Отмена', 'Закрыть']);
        if (clickedCancel) {
            await sleep(500);
            return true;
        }

        const closeButtons = Array.from(windowElement.querySelectorAll('[title*="Закрыть"], .win_close, .win_closeButton, .close, .WinClose'))
            .filter(isVisibleOrInsideVisibleControl);

        for (const button of closeButtons) {
            debugLog('cabinet_close:close_button_click', { button: describeElement(button) });
            clickElement(getClickableSurface(button, windowElement), false);
            await sleep(500);
            return true;
        }

        debugLog('cabinet_close:no_cancel_button');
        return false;
    };

    const getScheduleGuideAtIndex = (index) => {
        const scheduleForm = findScheduleForm();
        const guideButtons = scheduleForm ? getScheduleCabinetGuideButtons(scheduleForm) : [];
        return guideButtons[index] || null;
    };

    const isCabinetAppliedToSchedule = (guide, index) => {
        const currentGuide = getScheduleGuideAtIndex(index) || guide;
        const row = currentGuide?.row || currentGuide?.button?.closest('tr');
        const control = currentGuide?.button?.closest('.ctrl_ButtonEdit, .editControl, td, tr');

        return hasCabinetLabel(getElementLabel(row))
            || hasCabinetLabel(getElementLabel(control));
    };

    const waitForCabinetAppliedToSchedule = async (guide, index, timeout = 3000) => {
        return waitForCondition(() => isCabinetAppliedToSchedule(guide, index), timeout, 200);
    };

    const closeCabinetWindowAfterApplied = async (cabinetWindow) => {
        if (!isModalWindowOpen(cabinetWindow)) {
            debugLog('cabinet_close:already_closed_after_apply');
            return true;
        }

        console.log('Окно "Кабинеты": значение применилось, закрываю справочник без повторного подтверждения.');
        debugLog('cabinet_close:after_applied_start', { window: describeElement(cabinetWindow) });

        if (await clickCancelInWindow(cabinetWindow)) {
            if (await waitForWindowToClose(cabinetWindow, 4000)) {
                debugLog('cabinet_close:closed_by_cancel');
                return true;
            }
        }

        dispatchEscape(document.activeElement);
        await sleep(700);

        if (await waitForWindowToClose(cabinetWindow, 3000)) {
            debugLog('cabinet_close:closed_by_escape');
            return true;
        }

        console.warn('Окно "Кабинеты" не закрылось после применения значения. Останавливаю дальнейшую обработку.');
        debugLog('cabinet_close:failed_after_applied', { window: describeElement(cabinetWindow) });
        return false;
    };

    const confirmCabinetSelection = async (cabinetWindow, cabinetRow) => {
        if (!isModalWindowOpen(cabinetWindow)) {
            return true;
        }

        if (await clickOkInWindow(cabinetWindow)) {
            if (await waitForWindowToClose(cabinetWindow, 5000)) {
                return true;
            }
        }

        if (cabinetRow?.isConnected) {
            cabinetRow.focus?.();
            dispatchEnter(cabinetRow);
            await sleep(600);

            if (await waitForWindowToClose(cabinetWindow, 3000)) {
                return true;
            }
        }

        dispatchEnter(document.activeElement);
        await sleep(600);

        if (await waitForWindowToClose(cabinetWindow, 3000)) {
            return true;
        }

        console.warn('Окно "Кабинеты" не закрылось автоматически. Выбор уже сделан, но окно осталось открытым.');
        return false;
    };

    const selectCabinetInWindow = async (cabinetWindow, guide, index) => {
        debugLog('cabinet_select:start', {
            index,
            cabinetWindow: describeElement(cabinetWindow),
            guide: describeElement(guide?.button)
        });

        let cabinetRow = await waitForCondition(() => findCabinetRow(cabinetWindow), 3000, 250);
        if (!cabinetRow) {
            cabinetRow = await filterCabinetWindow(cabinetWindow);
        }

        if (!cabinetRow) {
            console.warn(`В окне "Кабинеты" не найдена строка "${targetCabinetName}".`);
            debugLog('cabinet_select:row_not_found', {
                index,
                cabinetWindow: describeElement(cabinetWindow)
            });
            return false;
        }

        cabinetRow.scrollIntoView({ block: 'center', inline: 'nearest' });
        console.log(`Окно "Кабинеты": выбираю "${targetCabinetName}".`);
        debugLog('cabinet_select:row_click', {
            index,
            row: describeElement(cabinetRow)
        });
        clickElement(cabinetRow, true);
        await sleep(700);

        if (await waitForCabinetAppliedToSchedule(guide, index, 3500)) {
            debugLog('cabinet_select:applied_after_row_click', { index });
            return closeCabinetWindowAfterApplied(cabinetWindow);
        }

        if (!isModalWindowOpen(cabinetWindow)) {
            debugLog('cabinet_select:assume_applied_after_window_closed', { index });
            return true;
        }

        if (isModalWindowOpen(cabinetWindow)) {
            await confirmCabinetSelection(cabinetWindow, cabinetRow);
        }

        if (await waitForCabinetAppliedToSchedule(guide, index, 2500)) {
            debugLog('cabinet_select:applied_after_confirm', { index });
            return closeCabinetWindowAfterApplied(cabinetWindow);
        }

        if (!isModalWindowOpen(cabinetWindow)) {
            debugLog('cabinet_select:assume_applied_after_confirm_closed', { index });
            return true;
        }

        console.warn(`${targetCabinetName} не применился для строки ${index + 1}. Останавливаю дальнейшую обработку.`);
        debugLog('cabinet_select:not_applied', {
            index,
            guide: describeElement(guide?.button),
            snapshot: getScheduleDebugSnapshot()
        });
        return false;
    };

    const chooseCabinetsInSchedule = async () => {
        const scheduleReady = await waitForScheduleReady();
        if (!scheduleReady?.scheduleForm) {
            return { selected: 0, total: 0 };
        }

        let selected = 0;
        let total = getScheduleCabinetGuideButtons(scheduleReady.scheduleForm).length;
        let stopped = false;
        console.log(`Подбор времени: найдено кнопок выбора кабинета: ${total}`);
        debugLog('cabinet_choose:start', { total, snapshot: getScheduleDebugSnapshot() });

        for (let index = 0; index < total; index++) {
            const guide = await waitForCondition(() => {
                const scheduleForm = findScheduleForm();
                const guideButtons = scheduleForm ? getScheduleCabinetGuideButtons(scheduleForm) : [];

                if (guideButtons.length > total) {
                    total = guideButtons.length;
                }

                return guideButtons[index]?.button?.isConnected && isVisible(guideButtons[index].button)
                    ? guideButtons[index]
                    : null;
            }, 5000, 200);
            const scheduleWindow = findScheduleWindow();
            if (!guide || !scheduleWindow) {
                debugLog('cabinet_choose:guide_missing', { index, total, snapshot: getScheduleDebugSnapshot() });
                continue;
            }

            if (isCabinetAppliedToSchedule(guide, index)) {
                selected++;
                debugLog('cabinet_choose:already_applied', {
                    index,
                    guide: describeElement(guide.button)
                });
                continue;
            }

            console.log(`Подбор времени: выбираю кабинет для строки ${index + 1}/${total}.`);
            debugLog('cabinet_choose:open_window', {
                index,
                total,
                guide: describeElement(guide.button),
                row: describeElement(guide.row)
            });
            const previousWindows = new Set(getVisibleWindows());
            await activateElementAtCenter(guide.button, false, false);

            let cabinetWindow = await waitForCabinetWindow(scheduleWindow, previousWindows, 7000);
            if (!cabinetWindow && guide.button.isConnected) {
                await activateElementAtCenter(guide.button, true, false);
                cabinetWindow = await waitForCabinetWindow(scheduleWindow, previousWindows, 6000);
            }

            if (!cabinetWindow && guide.button.isConnected) {
                await activateElementAtCenter(guide.button, false, true);
                cabinetWindow = await waitForCabinetWindow(scheduleWindow, previousWindows, 8000);
            }

            if (!cabinetWindow) {
                console.warn(`Окно "Кабинеты" не открылось для строки ${index + 1}.`);
                debugLog('cabinet_choose:window_not_opened', {
                    index,
                    guide: describeElement(guide.button),
                    snapshot: getScheduleDebugSnapshot()
                });
                stopped = true;
                break;
            }

            const isSelected = await selectCabinetInWindow(cabinetWindow, guide, index);
            if (isSelected) {
                selected++;
                debugLog('cabinet_choose:selected', { index, selected, total });
            } else {
                debugLog('cabinet_choose:stop_after_failed_select', {
                    index,
                    selected,
                    total,
                    modalStillOpen: isModalWindowOpen(cabinetWindow),
                    snapshot: getScheduleDebugSnapshot()
                });
                stopped = true;
                break;
            }

            await sleep(350);
        }

        debugLog('cabinet_choose:done', { selected, total, stopped, snapshot: getScheduleDebugSnapshot() });
        return { selected, total, stopped };
    };

    const uniqueCheckboxesByPosition = (checkboxes) => {
        return uniqueElementsByPosition(checkboxes);
    };

    const findUrgentCheckboxesInSchedule = (scheduleForm) => {
        const gridRoot = getScheduleGridRoot(scheduleForm);
        const checkboxes = getVisibleElements('input[type="checkbox"]', gridRoot)
            .filter((checkbox) => !checkbox.disabled);

        const namedUrgent = checkboxes.filter((checkbox) => {
            const marker = normalizeText([
                checkbox.name,
                checkbox.id,
                checkbox.className,
                checkbox.title
            ].filter(Boolean).join(' '));

            return marker.includes('cito') || marker.includes('сроч');
        });

        if (namedUrgent.length > 0) {
            return uniqueCheckboxesByPosition(namedUrgent);
        }

        const urgentHeaderRect = findColumnHeaderRect(gridRoot, 'Срочно');
        if (!urgentHeaderRect) {
            return [];
        }

        return uniqueCheckboxesByPosition(checkboxes
            .filter((checkbox) => checkbox.name !== 'GridServices_SelectList_Item')
            .filter((checkbox) => isElementInColumn(checkbox, urgentHeaderRect, 35)));
    };

    const getScheduleDebugSnapshot = () => {
        const scheduleForm = findScheduleForm();
        const guideButtons = scheduleForm ? getScheduleCabinetGuideButtons(scheduleForm) : [];
        const urgentCheckboxes = scheduleForm ? findUrgentCheckboxesInSchedule(scheduleForm) : [];

        return {
            hasScheduleForm: !!scheduleForm,
            scheduleForm: describeElement(scheduleForm),
            guideCount: guideButtons.length,
            urgentCount: urgentCheckboxes.length,
            guides: guideButtons.map((guide, index) => ({
                index,
                button: describeElement(guide.button),
                row: describeElement(guide.row)
            })),
            urgentCheckboxes: urgentCheckboxes.map((checkbox, index) => ({
                index,
                checkbox: describeElement(checkbox),
                checked: checkbox.checked
            })),
            windows: getVisibleWindows().map((windowElement, index) => {
                const label = getElementLabel(windowElement);
                return {
                    index,
                    window: describeElement(windowElement),
                    containsScheduleForm: !!windowElement.querySelector('.form-schedule'),
                    looksLikeCabinetWindow: isCabinetPickerWindow(windowElement)
                };
            })
        };
    };

    const setUrgentCheckboxesInSchedule = async () => {
        const scheduleForm = findScheduleForm();
        if (!scheduleForm) {
            debugLog('urgent:no_schedule');
            return { selected: 0, total: 0 };
        }

        const urgentCheckboxes = findUrgentCheckboxesInSchedule(scheduleForm);
        let selected = 0;
        console.log(`Подбор времени: найдено чек-боксов "Срочно": ${urgentCheckboxes.length}`);
        debugLog('urgent:start', {
            urgentCount: urgentCheckboxes.length,
            checkboxes: urgentCheckboxes.map((checkbox) => ({
                checkbox: describeElement(checkbox),
                checked: checkbox.checked
            }))
        });

        for (const checkbox of urgentCheckboxes) {
            if (!checkbox.isConnected || !isVisible(checkbox)) {
                debugLog('urgent:skip_not_visible', { checkbox: describeElement(checkbox) });
                continue;
            }

            if (!checkbox.checked) {
                debugLog('urgent:click', { checkbox: describeElement(checkbox) });
                clickCheckboxLikeUser(checkbox);
                await waitForBarsToProcessSelection();
            }

            if (checkbox.checked) {
                selected++;
            }
        }

        debugLog('urgent:done', { selected, total: urgentCheckboxes.length });
        return { selected, total: urgentCheckboxes.length };
    };

    const waitForScheduleReady = async () => {
        const startedAt = Date.now();
        let lastKey = '';
        let stableSince = Date.now();
        let lastReady = null;

        debugLog('schedule_ready:wait_start');

        while (Date.now() - startedAt < 25000) {
            const scheduleForm = findScheduleForm();
            if (!scheduleForm) {
                await sleep(250);
                continue;
            }

            const guideCount = getScheduleCabinetGuideButtons(scheduleForm).length;
            const urgentCount = findUrgentCheckboxesInSchedule(scheduleForm).length;
            const key = `${guideCount}:${urgentCount}`;

            if (guideCount > 0 && (!shouldMarkUrgent || urgentCount > 0)) {
                lastReady = { scheduleForm, guideCount, urgentCount };

                if (key !== lastKey) {
                    lastKey = key;
                    stableSince = Date.now();
                    debugLog('schedule_ready:counts_changed', { guideCount, urgentCount });
                }

                if (Date.now() - stableSince >= 1200) {
                    debugLog('schedule_ready:ready', { guideCount, urgentCount, snapshot: getScheduleDebugSnapshot() });
                    return lastReady;
                }
            } else {
                lastKey = key;
                stableSince = Date.now();
            }

            await sleep(250);
        }

        debugLog('schedule_ready:timeout', {
            lastReady: lastReady ? {
                guideCount: lastReady.guideCount,
                urgentCount: lastReady.urgentCount
            } : null,
            snapshot: getScheduleDebugSnapshot()
        });
        return lastReady;
    };

    const prepareScheduleForAssignment = async () => {
        await sleep(600);

        const scheduleOpened = await clickAssignButton();
        if (!scheduleOpened) {
            return 'подбор времени не открыт';
        }

        const scheduleReady = await waitForScheduleReady();
        if (!scheduleReady) {
            console.warn('Окно подбора времени открылось, но строки таблицы не загрузились.');
            return 'подбор времени открыт, но строки не найдены';
        }

        console.log(`Подбор времени готов: кнопок кабинета ${scheduleReady.guideCount}, чек-боксов "Срочно" ${scheduleReady.urgentCount}.`);
        await sleep(300);

        const cabinetsResult = await chooseCabinetsInSchedule();
        await sleep(500);
        if (cabinetsResult.stopped) {
            const resultMessage = `кабинеты: ${cabinetsResult.selected}/${cabinetsResult.total}, срочно: пропущено из-за незакрытого окна кабинетов`;
            debugLog('schedule:stopped_after_cabinets', { resultMessage, snapshot: getScheduleDebugSnapshot() });
            console.warn(`Подбор времени остановлен (${resultMessage}). Кнопка "Записать" не нажималась.`);
            return `подбор времени остановлен (${resultMessage})`;
        }

        const urgentResult = shouldMarkUrgent
            ? await setUrgentCheckboxesInSchedule()
            : { selected: 0, total: 0, skipped: true };
        const resultMessage = [
            `кабинеты: ${cabinetsResult.selected}/${cabinetsResult.total}`,
            urgentResult.skipped ? 'срочно: пропущено' : `срочно: ${urgentResult.selected}/${urgentResult.total}`
        ].join(', ');

        console.log(`Подбор времени подготовлен (${resultMessage}). Кнопка "Записать" не нажималась.`);
        return `подбор времени подготовлен (${resultMessage})`;
    };
    
    await openAllResearches();

    // Проверяем количество чек-боксов
    let allCheckboxes = getCheckboxes();
    console.log(`Найдено чек-боксов: ${allCheckboxes.length}`);

    const pageSizeResult = await trySetPageSizeTo150();
    if (pageSizeResult.changed) {
        console.log(`Количество записей автоматически переключено на ${TARGET_PAGE_SIZE}. Текущих чек-боксов: ${pageSizeResult.count}`);
        allCheckboxes = getCheckboxes();
    } else if (pageSizeResult.reason === 'not_found') {
        console.warn('Не удалось автоматически найти переключатель количества записей.');
    }
    
    // Если найдено меньше 100 записей, показываем предупреждение
    if (allCheckboxes.length < 100) {
        const warningMsg = `⚠️ Внимание! Найдено только ${allCheckboxes.length} анализов. Автоматически выставить 150 записей не удалось. Установите отображение 150 записей вручную (нажмите на цифру в правом нижнем углу, введите 150 и нажмите Enter).`;
        console.warn(warningMsg);
        
        // Показываем предупреждение на странице
        const notification = document.createElement('div');
        notification.textContent = warningMsg;
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #ff9800;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-family: 'Segoe UI', sans-serif;
            z-index: 9999;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            max-width: 350px;
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 8000);
    }
    
    const targetItemValues = allCheckboxes
        .map((checkbox) => checkbox.getAttribute('item_value'))
        .filter((itemValue) => itemValue && formData.hasOwnProperty(itemValue));

    // Проставляем чек-боксы последовательно, чтобы БАРС успевал обновить нижний список выбранных исследований.
    for (const itemValue of targetItemValues) {
        const shouldBeChecked = formData[itemValue];

        if (shouldBeChecked === true) {
            const isSelected = await resyncSelectedCheckboxThroughBars(itemValue);
            if (!isSelected) {
                console.warn(`Не удалось отметить анализ: ${itemValue}`);
                continue;
            }
            filledCount++;
            console.log(`✓ Отмечен анализ: ${itemValue}`);
        } else if (shouldBeChecked === false) {
            const isCleared = await setCheckboxStateThroughBars(itemValue, false);
            if (!isCleared) {
                console.warn(`Не удалось снять анализ: ${itemValue}`);
                continue;
            }
            filledCount++;
            console.log(`✗ Снят анализ: ${itemValue}`);
        }
    }

    let scheduleMessage = '';
    if (normalizedAssignmentStage === ASSIGNMENT_STAGE_ANALYSES) {
        scheduleMessage = 'остановлено после выбора анализов';
        debugLog('schedule:skipped_by_setting', { assignmentStage: normalizedAssignmentStage });
        console.log('Настройка сценария: остановка после выбора анализов. Кнопку "Назначить" не нажимаю.');
    } else if (filledCount > 0) {
        scheduleMessage = await prepareScheduleForAssignment();
    } else {
        console.warn('Анализы не были обработаны, кнопку "Назначить" не нажимаю.');
    }
    
    const message = `Профиль "${profileName}": обработано ${filledCount} анализов (всего на странице: ${allCheckboxes.length})${scheduleMessage ? `. ${scheduleMessage}` : ''}`;
    console.log(message);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    // Показываем уведомление о результате
    const notification = document.createElement('div');
    const isFullList = allCheckboxes.length >= 100;
    notification.textContent = isFullList ? `✅ ${message}` : `⚠️ ${message}\n⚠️ Для полного списка установите 150 записей!`;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${isFullList ? '#4CAF50' : '#ff9800'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-family: 'Segoe UI', sans-serif;
        z-index: 9999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        animation: fadeOut 5s ease-in-out forwards;
        max-width: 350px;
    `;
    
    const style = document.createElement('style');
    style.textContent = `@keyframes fadeOut {0%{opacity:1}70%{opacity:1}100%{opacity:0;visibility:hidden}}`;
    document.head.appendChild(style);
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
    
    return { message, filledCount, totalFound: allCheckboxes.length };
}
