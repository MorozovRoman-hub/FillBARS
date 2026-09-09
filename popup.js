// ==============================================
// 1. НАСТРОЙКА ПРОФИЛЕЙ
// ==============================================

const CONFIG_FILE_NAME = 'fillbars-config.json';
const DRUG_CATALOG_FILE_NAME = 'drug-catalog-zhvnlp-2025.json';
const EXTENSION_VERSION = '5.2.6';
let CONFIG_TEMPLATES = {};
let CONFIG_ACTIVE_PROFILE_NAMES = [];
let CONFIG_RESEARCH_CATALOG = {};
let CONFIG_ASSIGNMENT_SETTINGS = {};
let CONFIG_DRUG_CATALOG = [];
// ==============================================

const PROFILE_STORAGE_KEY = 'barsCustomProfilesV4';
const ACTIVE_PROFILE_NAMES_STORAGE_KEY = 'barsActiveProfileNamesV1';
const RESEARCH_CATALOG_STORAGE_KEY = 'barsResearchCatalogV3';
const ASSIGNMENT_SETTINGS_STORAGE_KEY = 'barsAssignmentSettingsV1';
const CUSTOM_DRUG_CATALOG_STORAGE_KEY = 'barsCustomDrugCatalogV1';
const DIAGNOSTIC_RUNS_STORAGE_KEY = 'fillbarsDiagnosticRunsV1';
const DIAGNOSTIC_MESSAGE_NAMESPACE = 'fillbars-diagnostics-v1';
const MAX_DIAGNOSTIC_RUNS = 12;
const MAX_DIAGNOSTIC_EVENTS = 220;
const TEMP_PRINT_PAYLOAD_PREFIX = 'barsPrintPayload:';
const TEMP_TRANSFUSION_PAYLOAD_PREFIX = 'barsTransfusionPayload:';
const TEMP_BLOOD_REQUEST_PAYLOAD_PREFIX = 'barsBloodRequestPayload:';
const JOURNAL_DB_NAME = 'FillBARSAssignments';
const JOURNAL_DB_VERSION = 1;
const JOURNAL_STORE_NAME = 'assignments';
const DEFAULT_JOURNAL_RETENTION_DAYS = 60;
const ASSIGNMENT_STAGE_ANALYSES = 'analyses';
const ASSIGNMENT_STAGE_SCHEDULE = 'schedule';
const DEFAULT_ASSIGNMENT_SETTINGS = {
    assignmentStage: ASSIGNMENT_STAGE_ANALYSES,
    targetCabinet: '',
    markUrgent: false,
    journalEnabled: true,
    journalRetentionDays: DEFAULT_JOURNAL_RETENTION_DAYS
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
let selectedMedications = [];
let selectedProcedures = [];
let selectedProfileIcon = PROFILE_ICONS[0];
let activeProfileEditorTab = 'analyses';
let selectedDiagnosticRunId = '';
let diagnosticRunsSnapshot = null;

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAnalyses(rawAnalyses) {
    if (!isPlainObject(rawAnalyses)) {
        return {};
    }

    return Object.entries(rawAnalyses).reduce((result, [researchId, enabled]) => {
        if (researchId && enabled === true) {
            result[researchId] = true;
        }
        return result;
    }, {});
}

function generateId(prefix = 'id') {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeMedication(rawMedication = {}) {
    if (!isPlainObject(rawMedication)) {
        return null;
    }

    const name = String(rawMedication.name || '').trim();
    if (!name) {
        return null;
    }

    return {
        id: String(rawMedication.id || generateId('custom')),
        source: rawMedication.source === 'catalog' ? 'catalog' : 'manual',
        atc: String(rawMedication.atc || '').trim(),
        name,
        form: String(rawMedication.form || '').trim(),
        dose: String(rawMedication.dose || '').trim(),
        route: String(rawMedication.route || '').trim(),
        frequency: String(rawMedication.frequency || '').trim(),
        duration: String(rawMedication.duration || '').trim(),
        regimen: String(rawMedication.regimen || '').trim(),
        comment: String(rawMedication.comment || '').trim()
    };
}

function normalizeMedications(rawMedications) {
    if (!Array.isArray(rawMedications)) {
        return [];
    }

    return rawMedications
        .map(normalizeMedication)
        .filter(Boolean);
}

function normalizeProcedure(rawProcedure) {
    if (typeof rawProcedure === 'string') {
        const name = rawProcedure.trim();
        return name ? {
            id: `procedure-${name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '')}`,
            name,
            comment: ''
        } : null;
    }

    if (!isPlainObject(rawProcedure)) {
        return null;
    }

    const name = String(rawProcedure.name || '').trim();
    if (!name) {
        return null;
    }

    return {
        id: String(rawProcedure.id || `procedure-${name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '')}`),
        name,
        comment: String(rawProcedure.comment || '').trim()
    };
}

function normalizeProcedures(rawProcedures) {
    if (!Array.isArray(rawProcedures)) {
        return [];
    }

    return rawProcedures.map(normalizeProcedure).filter(Boolean);
}

function normalizeProfile(rawProfile) {
    if (!isPlainObject(rawProfile)) {
        return {
            analyses: {},
            medications: [],
            procedures: []
        };
    }

    if (isPlainObject(rawProfile.analyses) || Array.isArray(rawProfile.medications) || Array.isArray(rawProfile.procedures)) {
        return {
            analyses: normalizeAnalyses(rawProfile.analyses),
            medications: normalizeMedications(rawProfile.medications),
            procedures: normalizeProcedures(rawProfile.procedures)
        };
    }

    return {
        analyses: normalizeAnalyses(rawProfile),
        medications: [],
        procedures: []
    };
}

function normalizeProfiles(rawProfiles) {
    if (!isPlainObject(rawProfiles)) {
        return {};
    }

    return Object.entries(rawProfiles).reduce((profiles, [profileName, rawProfile]) => {
        if (!profileName || !isPlainObject(rawProfile)) {
            return profiles;
        }

        profiles[profileName] = normalizeProfile(rawProfile);
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
    const retentionDays = Number.parseInt(settings.journalRetentionDays, 10);

    return {
        assignmentStage: targetCabinet ? requestedStage : ASSIGNMENT_STAGE_ANALYSES,
        targetCabinet,
        markUrgent: settings.markUrgent === true,
        journalEnabled: settings.journalEnabled !== false,
        journalRetentionDays: Number.isFinite(retentionDays) && retentionDays > 0
            ? retentionDays
            : DEFAULT_JOURNAL_RETENTION_DAYS
    };
}

function normalizeDrugCatalog(rawCatalog) {
    if (!Array.isArray(rawCatalog)) {
        return [];
    }

    const byId = new Map();
    for (const rawDrug of rawCatalog) {
        if (!isPlainObject(rawDrug)) {
            continue;
        }

        const name = String(rawDrug.name || '').trim();
        if (!name) {
            continue;
        }

        const atc = String(rawDrug.atc || '').trim();
        const id = String(rawDrug.id || `${atc || 'drug'}-${name}`).trim();
        const forms = Array.isArray(rawDrug.forms)
            ? rawDrug.forms.map((form) => String(form || '').trim()).filter(Boolean)
            : [];

        byId.set(id, {
            id,
            atc,
            group: String(rawDrug.group || '').trim(),
            name,
            forms: Array.from(new Set(forms))
        });
    }

    return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

async function loadDrugCatalogFile() {
    try {
        const url = globalThis.chrome?.runtime?.getURL
            ? chrome.runtime.getURL(DRUG_CATALOG_FILE_NAME)
            : DRUG_CATALOG_FILE_NAME;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            return [];
        }

        return normalizeDrugCatalog(await response.json());
    } catch (error) {
        console.warn(`Не удалось прочитать ${DRUG_CATALOG_FILE_NAME}`, error);
        return [];
    }
}

async function loadExtensionConfigFile() {
    try {
        const url = globalThis.chrome?.runtime?.getURL
            ? chrome.runtime.getURL(CONFIG_FILE_NAME)
            : CONFIG_FILE_NAME;
        const response = await fetch(url, { cache: 'no-store' });
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
    CONFIG_DRUG_CATALOG = normalizeDrugCatalog(config?.drugCatalog || []);
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

function classifyExtensionError(errorMessage) {
    const normalized = String(errorMessage || '').toLowerCase();
    if (!normalized) {
        return null;
    }
    if (normalized.includes('cannot access') || normalized.includes('не удается получить доступ')) {
        return 'tab_access_denied';
    }
    if (normalized.includes('frame') && (normalized.includes('removed') || normalized.includes('not found'))) {
        return 'frame_unavailable';
    }
    if (normalized.includes('message port closed') || normalized.includes('receiving end does not exist')) {
        return 'extension_context_closed';
    }
    if (normalized.includes('cannot be scripted') || normalized.includes('chrome://')) {
        return 'restricted_page';
    }
    return 'extension_api_error';
}

function sendDiagnosticWorkerMessage(action, payload = {}) {
    if (!globalThis.chrome?.runtime?.sendMessage) {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({
                namespace: DIAGNOSTIC_MESSAGE_NAMESPACE,
                action,
                ...payload
            }, (response) => {
                // Reading lastError suppresses the expected warning when an old,
                // not-yet-reloaded extension has no diagnostic worker.
                const runtimeError = chrome.runtime.lastError;
                resolve(runtimeError ? null : response || null);
            });
        } catch (error) {
            resolve(null);
        }
    });
}

function sanitizeDiagnosticValue(value, key = '', seen = new WeakSet(), depth = 0) {
    const blockedKeys = /^(error|location|title|url|href|patient|persmedcard|medicalcardnumber|fullname|birthdate|fio|text|innertext|textcontent|label)$/i;
    if (blockedKeys.test(key)) {
        return undefined;
    }

    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        return value
            .replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'<>]+/gi, '[адрес удалён]')
            .slice(0, 1600);
    }

    if (typeof value !== 'object') {
        return String(value).slice(0, 500);
    }

    if (depth >= 7) {
        return '[глубина ограничена]';
    }
    if (seen.has(value)) {
        return '[циклическая ссылка]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
        return value.slice(0, 100)
            .map((entry) => sanitizeDiagnosticValue(entry, key, seen, depth + 1))
            .filter((entry) => entry !== undefined);
    }

    return Object.fromEntries(
        Object.entries(value)
            .slice(0, 80)
            .map(([entryKey, entryValue]) => [
                entryKey,
                sanitizeDiagnosticValue(entryValue, entryKey, seen, depth + 1)
            ])
            .filter(([, entryValue]) => entryValue !== undefined)
    );
}

function getDiagnosticRuns() {
    if (Array.isArray(diagnosticRunsSnapshot)) {
        return diagnosticRunsSnapshot.slice();
    }

    const stored = readJsonStorage(DIAGNOSTIC_RUNS_STORAGE_KEY, []);
    return Array.isArray(stored)
        ? stored.filter((run) => run && typeof run === 'object')
            .sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))
        : [];
}

function upsertDiagnosticRun(run) {
    let sanitizedRun;
    try {
        sanitizedRun = sanitizeDiagnosticValue(run);
    } catch (error) {
        console.warn('[FillBARS] Диагностическое событие пропущено: не удалось безопасно подготовить данные.', error);
        return null;
    }
    if (!sanitizedRun?.id) {
        return null;
    }

    const runs = getDiagnosticRuns().filter((entry) => entry.id !== sanitizedRun.id);
    const nextRuns = [sanitizedRun, ...runs]
        .sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))
        .slice(0, MAX_DIAGNOSTIC_RUNS);
    diagnosticRunsSnapshot = nextRuns;

    try {
        writeJsonStorage(DIAGNOSTIC_RUNS_STORAGE_KEY, nextRuns);
    } catch (error) {
        console.warn('[FillBARS] Не удалось сохранить полный диагностический журнал, сокращаю историю.', error);
        try {
            writeJsonStorage(DIAGNOSTIC_RUNS_STORAGE_KEY, nextRuns.slice(0, 3));
        } catch (fallbackError) {
            console.error('[FillBARS] Локальное хранилище диагностических логов недоступно.', fallbackError);
        }
    }

    void sendDiagnosticWorkerMessage('upsert', { run: sanitizedRun });

    return sanitizedRun;
}

function createDiagnosticRun(profileName, assignmentSettings) {
    const startedAt = new Date().toISOString();
    const run = {
        schemaVersion: 1,
        id: generateId('diagnostic'),
        extensionVersion: EXTENSION_VERSION,
        startedAt,
        completedAt: null,
        durationMs: null,
        status: 'running',
        profileName,
        assignmentStage: assignmentSettings?.assignmentStage || ASSIGNMENT_STAGE_ANALYSES,
        events: [{ time: startedAt, event: 'popup:run_started', details: {} }]
    };
    upsertDiagnosticRun(run);
    return run;
}

function appendDiagnosticRunEvent(run, event, details = {}) {
    if (!run) {
        return;
    }

    try {
        run.events = Array.isArray(run.events) ? run.events : [];
        run.events.push({
            time: new Date().toISOString(),
            event,
            details: sanitizeDiagnosticValue(details)
        });
        run.events = run.events.slice(-MAX_DIAGNOSTIC_EVENTS);
        upsertDiagnosticRun(run);
    } catch (error) {
        console.warn('[FillBARS] Не удалось добавить диагностическое событие.', error);
    }
}

function completeDiagnosticRun(run, status, summary = {}, pageEvents = []) {
    if (!run) {
        return;
    }

    try {
        const completedAt = new Date().toISOString();
        const safePageEvents = Array.isArray(pageEvents)
            ? pageEvents.map((entry) => sanitizeDiagnosticValue(entry)).filter(Boolean)
            : [];
        run.events = [...(run.events || []), ...safePageEvents, {
            time: completedAt,
            event: 'popup:run_finished',
            details: { status }
        }]
            .sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')))
            .slice(-MAX_DIAGNOSTIC_EVENTS);
        run.status = status;
        run.completedAt = completedAt;
        run.durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(run.startedAt));
        run.summary = sanitizeDiagnosticValue(summary);
        upsertDiagnosticRun(run);
    } catch (error) {
        console.warn('[FillBARS] Не удалось завершить диагностический журнал.', error);
    }

    if (!document.getElementById('diagnosticPanel')?.classList.contains('hidden')) {
        renderDiagnosticPanel();
    }
}

function getSelectedDiagnosticRun(runs = getDiagnosticRuns()) {
    return runs.find((run) => run.id === selectedDiagnosticRunId) || runs[0] || null;
}

async function refreshDiagnosticRunsFromWorker() {
    const response = await sendDiagnosticWorkerMessage('get_runs');
    if (!response?.ok || !Array.isArray(response.runs)) {
        return getDiagnosticRuns();
    }

    const runs = response.runs.slice(0, MAX_DIAGNOSTIC_RUNS);
    diagnosticRunsSnapshot = runs;
    try {
        writeJsonStorage(DIAGNOSTIC_RUNS_STORAGE_KEY, runs);
    } catch (error) {
        console.warn('[FillBARS] Не удалось обновить локальную копию диагностических логов.', error);
    }
    return runs;
}

function renderDiagnosticPanelContents() {
    const panel = document.getElementById('diagnosticPanel');
    const summary = document.getElementById('diagnosticSummary');
    const output = document.getElementById('diagnosticLog');
    const selector = document.getElementById('diagnosticRunSelect');
    if (!panel || !summary || !output || !selector) {
        return;
    }

    const runs = getDiagnosticRuns();
    const selected = getSelectedDiagnosticRun(runs);
    selectedDiagnosticRunId = selected?.id || '';
    selector.textContent = '';
    for (const run of runs) {
        const option = document.createElement('option');
        option.value = run.id;
        option.textContent = `${run.startedAt || 'без времени'} — ${run.status || 'unknown'} — ${run.profileName || 'без профиля'}`;
        selector.appendChild(option);
    }
    selector.disabled = runs.length === 0;
    selector.value = selectedDiagnosticRunId;
    summary.textContent = selected
        ? `Сохранено запусков: ${runs.length}. Выбран: ${selected.status}, ${selected.startedAt}.`
        : 'Диагностических запусков пока нет.';
    output.value = selected ? JSON.stringify(selected, null, 2) : '';
    panel.classList.remove('hidden');
}

async function renderDiagnosticPanel() {
    renderDiagnosticPanelContents();
    await refreshDiagnosticRunsFromWorker();
    renderDiagnosticPanelContents();
}

function closeDiagnosticPanel() {
    document.getElementById('diagnosticPanel')?.classList.add('hidden');
}

async function copyLatestDiagnosticLog() {
    await refreshDiagnosticRunsFromWorker();
    renderDiagnosticPanelContents();
    const selected = getSelectedDiagnosticRun();
    const text = selected ? JSON.stringify(selected, null, 2) : '';
    if (!text) {
        setStatus('❌ Диагностический журнал пока пуст', '#f44336');
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        const output = document.getElementById('diagnosticLog');
        output?.focus();
        output?.select();
        if (!document.execCommand('copy')) {
            throw error;
        }
    }
    setStatus('✅ Выбранный диагностический запуск скопирован');
}

async function exportLatestDiagnosticLog() {
    await refreshDiagnosticRunsFromWorker();
    renderDiagnosticPanelContents();
    const selected = getSelectedDiagnosticRun();
    if (!selected) {
        setStatus('❌ Диагностический журнал пока пуст', '#f44336');
        return;
    }

    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = String(selected.startedAt || new Date().toISOString()).replace(/[:.]/g, '-');
    link.href = url;
    link.download = `fillbars-diagnostic-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('✅ Диагностический JSON подготовлен');
}

async function clearDiagnosticRuns() {
    if (!confirm('Удалить все локальные диагностические логи FillBARS?')) {
        return;
    }
    await sendDiagnosticWorkerMessage('clear');
    diagnosticRunsSnapshot = [];
    try {
        localStorage.removeItem(DIAGNOSTIC_RUNS_STORAGE_KEY);
    } catch (error) {
        console.warn('[FillBARS] Не удалось очистить резервную копию диагностических логов.', error);
    }
    selectedDiagnosticRunId = '';
    renderDiagnosticPanelContents();
    setStatus('✅ Диагностические логи удалены');
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

function getProfileAnalyses(profile) {
    return normalizeProfile(profile).analyses;
}

function getProfileMedications(profile) {
    return normalizeProfile(profile).medications;
}

function getProfileProcedures(profile) {
    return normalizeProfile(profile).procedures;
}

function getActiveProfileNames() {
    const profileLibrary = getTemplateLibrary();
    const rawValue = localStorage.getItem(ACTIVE_PROFILE_NAMES_STORAGE_KEY);
    if (rawValue === null) {
        const defaultActiveNames = normalizeProfileNameList(CONFIG_ACTIVE_PROFILE_NAMES, profileLibrary);
        return defaultActiveNames.length > 0 ? defaultActiveNames : Object.keys(profileLibrary);
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

function getCustomDrugCatalog() {
    return normalizeDrugCatalog(readJsonStorage(CUSTOM_DRUG_CATALOG_STORAGE_KEY, []));
}

function saveCustomDrugCatalog(catalog) {
    writeJsonStorage(CUSTOM_DRUG_CATALOG_STORAGE_KEY, normalizeDrugCatalog(catalog));
}

function getDrugCatalog() {
    return normalizeDrugCatalog([
        ...CONFIG_DRUG_CATALOG,
        ...getCustomDrugCatalog()
    ]);
}

function medicationToText(medication) {
    const normalized = normalizeMedication(medication);
    if (!normalized) {
        return '';
    }

    return [
        normalized.name,
        normalized.form,
        normalized.dose,
        normalized.route,
        normalized.frequency,
        normalized.duration,
        normalized.regimen,
        normalized.comment
    ].filter(Boolean).join(', ');
}

function getAnalysesForPrint(profile) {
    const catalog = getResearchCatalog();
    return Object.keys(getProfileAnalyses(profile))
        .map((id) => ({
            id,
            name: catalog[id] || `Исследование ${id}`
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
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
    const journalEnabledCheckbox = document.getElementById('journalEnabledCheckbox');
    const journalRetentionInput = document.getElementById('journalRetentionDays');
    const hint = document.getElementById('assignmentStageHint');

    if (!slider || !label) {
        return;
    }

    const normalizedSettings = normalizeAssignmentSettings(settings);
    const canUseSchedule = !!normalizedSettings.targetCabinet;

    slider.disabled = !canUseSchedule;
    slider.value = normalizedSettings.assignmentStage === ASSIGNMENT_STAGE_SCHEDULE ? '1' : '0';
    label.textContent = canUseSchedule && normalizedSettings.assignmentStage === ASSIGNMENT_STAGE_SCHEDULE
        ? (normalizedSettings.markUrgent ? 'Кабинеты и CITO' : 'Кабинеты')
        : (normalizedSettings.markUrgent ? 'Только анализы и CITO' : 'Только анализы');

    if (targetCabinetInput) {
        targetCabinetInput.value = normalizedSettings.targetCabinet;
    }

    if (markUrgentCheckbox) {
        markUrgentCheckbox.checked = normalizedSettings.markUrgent;
    }

    if (journalEnabledCheckbox) {
        journalEnabledCheckbox.checked = normalizedSettings.journalEnabled;
    }

    if (journalRetentionInput) {
        journalRetentionInput.value = normalizedSettings.journalRetentionDays;
    }

    if (hint) {
        hint.textContent = canUseSchedule
            ? ''
            : 'CITO применяется к выбранным анализам; укажите кабинет, чтобы дополнительно включить расписание.';
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
        const profile = normalizeProfile(PROFILES[profileName]);
        const row = document.createElement('div');
        row.className = 'profile-row';

        const name = document.createElement('span');
        name.className = 'profile-row-name';
        name.textContent = `${profileName} (${Object.keys(profile.analyses).length} ан., ${profile.medications.length} преп., ${profile.procedures.length} проц.)`;

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

function openJournalDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(JOURNAL_DB_NAME, JOURNAL_DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(JOURNAL_STORE_NAME)) {
                const store = db.createObjectStore(JOURNAL_STORE_NAME, { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt');
                store.createIndex('medicalCardNumber', 'medicalCardNumber');
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withJournalStore(mode, callback) {
    const db = await openJournalDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(JOURNAL_STORE_NAME, mode);
        const store = transaction.objectStore(JOURNAL_STORE_NAME);
        const result = callback(store);

        transaction.oncomplete = () => {
            db.close();
            resolve(result);
        };
        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };
    });
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getJournalEntries() {
    const entries = await withJournalStore('readonly', (store) => requestToPromise(store.getAll()));
    return entries.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

async function addJournalEntry(entry) {
    await withJournalStore('readwrite', (store) => {
        store.put(entry);
    });
}

async function deleteJournalEntry(id) {
    await withJournalStore('readwrite', (store) => {
        store.delete(id);
    });
}

async function clearJournal() {
    await withJournalStore('readwrite', (store) => {
        store.clear();
    });
}

async function cleanupOldJournalEntries() {
    const settings = getAssignmentSettings();
    const cutoff = Date.now() - settings.journalRetentionDays * 24 * 60 * 60 * 1000;
    const entries = await getJournalEntries();
    const oldEntries = entries.filter((entry) => Date.parse(entry.createdAt) < cutoff);

    if (oldEntries.length === 0) {
        return 0;
    }

    await withJournalStore('readwrite', (store) => {
        for (const entry of oldEntries) {
            store.delete(entry.id);
        }
    });

    return oldEntries.length;
}

function getSelectedProfileName() {
    return document.getElementById('profileSelect')?.value || '';
}

function getPatientPrintFields(patientData = {}) {
    return {
        fullName: sanitizePulledFullName(patientData.fullName),
        birthDate: normalizeDateForInput(patientData.birthDate),
        historyNumber: sanitizePatientHistoryNumber(patientData.historyNumber || patientData.medicalCardNumber),
        department: sanitizePatientDepartment(patientData.department),
        medicalOrganization: sanitizeMedicalOrganization(patientData.medicalOrganization),
        doctorName: formatDoctorName(patientData.doctorName),
        appointmentDate: document.getElementById('appointmentDate')?.value || new Date().toISOString().slice(0, 10)
    };
}

function normalizeDateForInput(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
        return '';
    }

    const isoMatch = rawValue.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    const ruMatch = rawValue.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
    if (ruMatch) {
        return `${ruMatch[3]}-${ruMatch[2].padStart(2, '0')}-${ruMatch[1].padStart(2, '0')}`;
    }

    return '';
}

function sanitizePulledFullName(value) {
    const rawValue = String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/\s*,.*$/, '')
        .trim();

    if (!rawValue || /[{}();=]|\b(Form|function|return|var|const|let|D3Api)\b/i.test(rawValue)) {
        return '';
    }

    const words = rawValue.match(/[А-ЯЁ][А-ЯЁа-яё-]+/g) || [];
    if (words.length >= 2) {
        return words.slice(-3).join(' ');
    }

    return '';
}

function sanitizePatientHistoryNumber(value) {
    const normalized = String(value || '')
        .replace(/^(?:иб|история\s+болезни|номер\s+иб|№\s*иб)\s*[:№-]?\s*/i, '')
        .replace(/^хо2\s+амурск[_\s-]*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized || normalized.length > 80 || /[{}();=<>]/.test(normalized)) {
        return '';
    }

    return /\d/.test(normalized) ? normalized : '';
}

function sanitizePatientDepartment(value) {
    const normalized = String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/[_\s-]+$/, '')
        .trim();

    if (!normalized
        || normalized.length > 60
        || !/[А-ЯЁA-Z]/i.test(normalized)
        || /[{}();=<>]/.test(normalized)) {
        return '';
    }

    return normalized;
}

function sanitizeMedicalOrganization(value) {
    const normalized = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized
        || normalized.length > 250
        || !/[А-ЯЁA-Z]/i.test(normalized)
        || /[{}=<>]/.test(normalized)) {
        return '';
    }

    return normalized;
}

function formatDoctorName(value) {
    const normalized = String(value || '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    const titleCase = (word) => {
        const lower = word.toLocaleLowerCase('ru-RU');
        return lower.charAt(0).toLocaleUpperCase('ru-RU') + lower.slice(1);
    };
    const abbreviated = normalized.match(/^([А-ЯЁA-Z][А-ЯЁа-яёA-Z-]+)\s+([А-ЯЁA-Z])\.?\s*([А-ЯЁA-Z])\.?$/i);
    if (abbreviated) {
        return `${titleCase(abbreviated[1])} ${abbreviated[2].toLocaleUpperCase('ru-RU')}.${abbreviated[3].toLocaleUpperCase('ru-RU')}.`;
    }

    const words = normalized.match(/[А-ЯЁA-Z][А-ЯЁа-яёA-Z-]*/gi) || [];
    if (words.length < 2) {
        return '';
    }

    const surname = titleCase(words[0]);
    const initials = words.slice(1, 3)
        .map((word) => `${word.charAt(0).toLocaleUpperCase('ru-RU')}.`)
        .join('');
    return `${surname} ${initials}`;
}

function scorePulledPatientData(data = {}) {
    const medicalCardNumber = String(data.medicalCardNumber || '').trim();
    const historyNumber = sanitizePatientHistoryNumber(data.historyNumber);
    const department = sanitizePatientDepartment(data.department);
    const medicalOrganization = sanitizeMedicalOrganization(data.medicalOrganization);
    const doctorName = formatDoctorName(data.doctorName);
    const fullName = String(data.fullName || '').trim();
    const birthDate = normalizeDateForInput(data.birthDate);
    let score = 0;

    if (/^\d{4,}$/.test(medicalCardNumber)) {
        score += 3;
    }

    if (historyNumber) {
        score += 4;
    }

    if (department) {
        score += 1;
    }

    if (medicalOrganization) {
        score += 1;
    }

    if (doctorName) {
        score += 1;
    }

    if (/^[А-ЯЁ][А-ЯЁа-яё-]+(?:\s+[А-ЯЁ][А-ЯЁа-яё-]+){1,3}$/.test(fullName)) {
        score += 4;
    }

    if (birthDate) {
        score += 3;
    }

    return score;
}

function pickBestPatientData(results = []) {
    const payloads = results
        .map((result) => result?.result || {})
        .filter((data) => data && typeof data === 'object');
    const isLikelyFullName = (value) => {
        return !!sanitizePulledFullName(value);
    };

    const fullName = payloads
        .map((data) => sanitizePulledFullName(data.fullName))
        .find(isLikelyFullName) || '';
    const birthDate = payloads
        .map((data) => normalizeDateForInput(data.birthDate))
        .find(Boolean) || '';
    const medicalCardNumber = payloads
        .map((data) => String(data.medicalCardNumber || '').trim())
        .filter((value) => /^\d{6,}$/.test(value))
        .sort((left, right) => right.length - left.length)[0] || '';
    const historyNumber = payloads
        .map((data) => sanitizePatientHistoryNumber(data.historyNumber))
        .find(Boolean) || '';
    const department = payloads
        .map((data) => sanitizePatientDepartment(data.department))
        .find(Boolean) || '';
    const medicalOrganization = payloads
        .map((data) => sanitizeMedicalOrganization(data.medicalOrganization))
        .find(Boolean) || '';
    const doctorName = payloads
        .map((data) => formatDoctorName(data.doctorName))
        .find(Boolean) || '';

    if (fullName || birthDate || historyNumber || medicalCardNumber || department || medicalOrganization || doctorName) {
        return {
            medicalCardNumber,
            historyNumber,
            department,
            medicalOrganization,
            doctorName,
            fullName,
            birthDate
        };
    }

    return payloads.sort((left, right) => scorePulledPatientData(right) - scorePulledPatientData(left))[0] || {};
}

function getPatientDataFromActiveBarsPage() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0]) {
                reject(new Error('Активная вкладка не найдена'));
                return;
            }

            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id, allFrames: true },
                world: 'MAIN',
                func: readPatientDataFromBarsPage
            }, (results) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                resolve(pickBestPatientData(results || []));
            });
        });
    });
}

function buildAssignmentPayload(profileName, options = {}) {
    const profile = normalizeProfile(options.profile || PROFILES[profileName]);
    if (!profileName || !PROFILES[profileName] && !options.profile) {
        return null;
    }

    return {
        generatedAt: new Date().toISOString(),
        profileName,
        patient: options.patient || getPatientPrintFields(),
        medications: getProfileMedications(profile),
        procedures: getProfileProcedures(profile),
        analyses: getAnalysesForPrint(profile)
    };
}

function openPrintPayload(payload) {
    const key = `${TEMP_PRINT_PAYLOAD_PREFIX}${generateId('print')}`;
    localStorage.setItem(key, JSON.stringify(payload));
    chrome.tabs.create({
        url: chrome.runtime.getURL(`print.html?payload=${encodeURIComponent(key)}`)
    });
}

function openTransfusionPayload(payload) {
    const key = `${TEMP_TRANSFUSION_PAYLOAD_PREFIX}${generateId('transfusion')}`;
    localStorage.setItem(key, JSON.stringify(payload));
    chrome.tabs.create({
        url: chrome.runtime.getURL(`transfusion.html?payload=${encodeURIComponent(key)}`)
    });
}

function openBloodRequestPayload(payload) {
    const key = `${TEMP_BLOOD_REQUEST_PAYLOAD_PREFIX}${generateId('blood-request')}`;
    localStorage.setItem(key, JSON.stringify(payload));
    chrome.tabs.create({
        url: chrome.runtime.getURL(`blood-request.html?payload=${encodeURIComponent(key)}`)
    });
}

async function openBloodRequest() {
    const button = document.getElementById('openBloodRequest');
    button.disabled = true;
    setStatus('⏳ Получаю данные пациента из истории болезни БАРС...', '#ff9800');

    try {
        const patientData = await getPatientDataFromActiveBarsPage();
        const patient = getPatientPrintFields(patientData);
        openBloodRequestPayload({
            generatedAt: new Date().toISOString(),
            patient
        });

        const missing = [
            patient.fullName ? '' : 'ФИО',
            patient.historyNumber ? '' : 'номер истории болезни',
            patient.birthDate ? '' : 'дата рождения'
        ].filter(Boolean);
        setStatus(missing.length
            ? `⚠️ Заявка открыта, не найдено: ${missing.join(', ')}`
            : '✅ Заявка на компоненты крови открыта');
    } catch (error) {
        console.error('Не удалось получить данные пациента из БАРС', error);
        setStatus(`❌ Не удалось открыть заявку: ${error.message}`, '#f44336');
    } finally {
        button.disabled = false;
    }
}

async function openTransfusionProtocol() {
    const button = document.getElementById('openTransfusionProtocol');
    button.disabled = true;
    setStatus('⏳ Получаю данные пациента из истории болезни БАРС...', '#ff9800');

    try {
        const patientData = await getPatientDataFromActiveBarsPage();
        const patient = getPatientPrintFields(patientData);
        openTransfusionPayload({
            generatedAt: new Date().toISOString(),
            patient
        });

        const missing = [
            patient.fullName ? '' : 'ФИО',
            patient.historyNumber ? '' : 'номер истории болезни',
            patient.birthDate ? '' : 'дата рождения'
        ].filter(Boolean);
        setStatus(missing.length
            ? `⚠️ Протокол открыт, не найдено: ${missing.join(', ')}`
            : '✅ Протокол трансфузии открыт');
    } catch (error) {
        console.error('Не удалось получить данные пациента из БАРС', error);
        setStatus(`❌ Не удалось открыть протокол: ${error.message}`, '#f44336');
    } finally {
        button.disabled = false;
    }
}

async function openPrintSheetForSelectedProfile() {
    const profileName = getSelectedProfileName();
    if (!profileName || !PROFILES[profileName]) {
        setStatus('❌ Выберите профиль назначений', '#f44336');
        return;
    }

    const button = document.getElementById('openPrintSheet');
    button.disabled = true;
    setStatus('⏳ Получаю ФИО, дату рождения и номер истории из БАРС...', '#ff9800');

    try {
        const patientData = await getPatientDataFromActiveBarsPage();
        const patient = getPatientPrintFields(patientData);
        const payload = buildAssignmentPayload(profileName, { patient });

        if (!payload) {
            setStatus('❌ Не удалось сформировать лист назначений', '#f44336');
            return;
        }

        localStorage.setItem('lastSelectedProfile', profileName);
        openPrintPayload(payload);

        const missing = [
            patient.fullName ? '' : 'ФИО',
            patient.historyNumber ? '' : 'номер истории болезни',
            patient.birthDate ? '' : 'дата рождения'
        ].filter(Boolean);
        setStatus(missing.length
            ? `⚠️ Лист открыт, не найдено: ${missing.join(', ')}`
            : '✅ Лист назначений открыт');
    } catch (error) {
        console.error('Не удалось получить данные пациента из БАРС', error);
        setStatus(`❌ Не удалось прочитать данные пациента из БАРС: ${error.message}`, '#f44336');
    } finally {
        button.disabled = false;
    }
}

async function saveSelectedProfileToJournal() {
    const settings = getAssignmentSettings();
    if (!settings.journalEnabled) {
        setStatus('❌ Журнал отключён в настройках', '#f44336');
        return;
    }

    const profileName = getSelectedProfileName();
    const payload = buildAssignmentPayload(profileName);
    if (!payload) {
        setStatus('❌ Выберите профиль назначений', '#f44336');
        return;
    }

    const button = document.getElementById('saveJournalEntry');
    button.disabled = true;
    setStatus('⏳ Получаю номер медицинской карты из БАРС...', '#ff9800');

    try {
        const patientData = await getPatientDataFromActiveBarsPage();
        const medicalCardNumber = String(patientData.medicalCardNumber || '').trim();
        if (!/^\d{6,}$/.test(medicalCardNumber)) {
            setStatus('❌ Номер медицинской карты не найден. Запись в журнал не сохранена', '#f44336');
            return;
        }

        const entry = {
            id: generateId('journal'),
            createdAt: new Date().toISOString(),
            medicalCardNumber,
            profileName,
            medications: payload.medications,
            procedures: payload.procedures,
            analyses: payload.analyses
        };

        await addJournalEntry(entry);
        await renderJournalPanel();
        setStatus(`✅ Запись для карты № ${medicalCardNumber} сохранена в журнал`);
    } catch (error) {
        console.error('Не удалось получить номер медицинской карты из БАРС', error);
        setStatus(`❌ Не удалось сохранить запись: ${error.message}`, '#f44336');
    } finally {
        button.disabled = false;
    }
}

function buildPayloadFromJournalEntry(entry) {
    return {
        generatedAt: entry.createdAt,
        profileName: entry.profileName,
        patient: {
            medicalCardNumber: entry.medicalCardNumber || '',
            fullName: '',
            birthDate: '',
            appointmentDate: new Date(entry.createdAt || Date.now()).toISOString().slice(0, 10)
        },
        medications: normalizeMedications(entry.medications),
        procedures: normalizeProcedures(entry.procedures),
        analyses: Array.isArray(entry.analyses) ? entry.analyses : []
    };
}

async function renderJournalPanel() {
    const panel = document.getElementById('journalPanel');
    const list = document.getElementById('journalList');
    if (!panel || !list) {
        return;
    }

    const entries = await getJournalEntries();
    list.textContent = '';

    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Журнал пуст';
        list.appendChild(empty);
    }

    for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'journal-row';

        const info = document.createElement('div');
        info.className = 'journal-row-info';
        const dateText = new Date(entry.createdAt).toLocaleString('ru-RU');
        info.textContent = `${dateText} · карта ${entry.medicalCardNumber || 'не указана'} · ${entry.profileName}`;

        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'small-btn';
        openButton.textContent = 'Открыть лист';
        openButton.addEventListener('click', () => openPrintPayload(buildPayloadFromJournalEntry(entry)));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'small-btn danger-mini';
        deleteButton.textContent = 'Удалить';
        deleteButton.addEventListener('click', async () => {
            await deleteJournalEntry(entry.id);
            renderJournalPanel();
        });

        row.append(info, openButton, deleteButton);
        list.appendChild(row);
    }

    panel.classList.remove('hidden');
}

function closeJournalPanel() {
    document.getElementById('journalPanel')?.classList.add('hidden');
}

function readPatientDataFromBarsPage() {
    const normalizeSpaces = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const cleanValue = (value) => normalizeSpaces(value)
        .replace(/^(фио|ф\.и\.о\.|пациент|дата рождения|д\/р|др|№\s*мед(?:ицинской)?\s*карты|номер\s*карты|медкарта|карта)\s*[:№\-]?\s*/i, '')
        .trim();
    const visibleText = normalizeSpaces(document.body?.innerText || document.body?.textContent || '');
    const getHeaderPatientData = () => {
        const match = visibleText.match(/([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){1,3})\s*,\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*,\s*№\s*карты\s*(\d{6,})/i);
        return {
            fullName: match?.[1] || '',
            birthDate: match?.[2] || '',
            medicalCardNumber: match?.[3] || ''
        };
    };
    const headerPatientData = getHeaderPatientData();
    const isVisible = (element) => {
        if (!element) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none';
    };
    const historyForms = Array.from(document.querySelectorAll('.hosp_history_new'))
        .filter(isVisible);
    const historyForm = historyForms.at(-1) || null;
    const historyPage = historyForm?.form?.page
        || historyForm?.jsParent?.page
        || historyForm?.DForm?.page
        || null;
    const getHistoryCaption = (name) => {
        if (!historyForm) {
            return '';
        }

        try {
            if (typeof historyPage?.getCaption === 'function') {
                return cleanValue(historyPage.getCaption(name));
            }
        } catch (error) {
            // The exact legacy page exists but is still initializing.
        }

        try {
            if (typeof getCaption === 'function') {
                return cleanValue(getCaption(name));
            }
        } catch (error) {
            // Fall through to DOM/text compatibility paths below.
        }

        return '';
    };
    const getUserEnvironmentValue = (label) => {
        const normalizedLabel = String(label || '').replace(/\s+/g, ' ').replace(/:$/, '').trim().toLowerCase();
        const profileSection = Array.from(document.querySelectorAll('#Profile .info > section'))
            .find((section) => cleanValue(section.querySelector('.title')?.textContent)
                .replace(/:$/, '')
                .toLowerCase() === normalizedLabel);
        const profileValue = cleanValue(profileSection?.querySelector('.info')?.textContent);
        if (profileValue) {
            return profileValue;
        }

        const legacyRow = Array.from(document.querySelectorAll('#sys_user_data tr'))
            .find((row) => Array.from(row.querySelectorAll('.td_name'))
                .some((cell) => cleanValue(cell.textContent)
                    .replace(/:$/, '')
                    .toLowerCase() === normalizedLabel));
        return cleanValue(legacyRow?.querySelector('.td_user')?.textContent);
    };
    const getCurrentDoctorName = () => {
        const profileName = cleanValue(document.querySelector('#Profile .user .name, #Profile .name')?.textContent);
        if (profileName) {
            return profileName.replace(/\s*\([^)]*\)\s*$/, '').trim();
        }

        const legacyName = getUserEnvironmentValue('Пользователь');
        if (legacyName) {
            return legacyName.replace(/\s*\([^)]*\)\s*$/, '').trim();
        }

        try {
            if (typeof getVar === 'function') {
                return cleanValue(getVar('EMP_NAME')).replace(/\s*\([^)]*\)\s*$/, '').trim();
            }
        } catch (error) {
            // DOM profile remains the primary source for both BARS themes.
        }
        return '';
    };
    const getCurrentMedicalOrganization = () => {
        const profileOrganization = getUserEnvironmentValue('ЛПУ');
        if (profileOrganization) {
            return profileOrganization;
        }

        try {
            if (typeof getVar === 'function') {
                return cleanValue(getVar('LPU_NAME'));
            }
        } catch (error) {
            // The global LPU caption is unavailable in some BARS builds.
        }
        return '';
    };
    const getCaptionValues = (caption) => Array.from(document.querySelectorAll(`[data="caption:${caption}"]`))
        .map((element) => ({
            value: cleanValue(element.value || element.innerText || element.textContent || ''),
            visible: isVisible(element)
        }))
        .filter((item) => item.value)
        .sort((left, right) => Number(right.visible) - Number(left.visible))
        .map((item) => item.value);
    const getCaptionValue = (caption, accept = (value) => !!value) => {
        const values = getCaptionValues(caption);
        return values.find(accept) || '';
    };
    const getDirectCaptionValue = (caption) => {
        const visibleElement = Array.from(document.querySelectorAll(`[data="caption:${caption}"]`))
            .filter(isVisible)
            .find((element) => cleanValue(element.value || element.innerText || element.textContent || ''));
        const element = visibleElement || document.querySelector(`[data="caption:${caption}"]`);
        return cleanValue(element?.value || element?.innerText || element?.textContent || '');
    };
    const normalizeCardNumber = (value) => {
        const match = String(value || '').match(/\b\d{6,}\b/);
        return match ? match[0] : '';
    };
    const normalizeHistoryNumber = (value) => {
        const normalized = cleanValue(value)
            .replace(/^(?:иб|история\s+болезни|номер\s+иб|№\s*иб)\s*[:№-]?\s*/i, '')
            .trim();
        return normalized
            && normalized.length <= 80
            && /\d/.test(normalized)
            && !/[{}();=<>]/.test(normalized)
            ? normalized
            : '';
    };
    const extractDepartmentFromHistoryNumber = (value) => {
        const normalized = cleanValue(value)
            .replace(/^(?:иб|история\s+болезни|номер\s+иб|№\s*иб)\s*[:№-]?\s*/i, '')
            .trim();
        const separatorIndex = normalized.indexOf('_');
        if (separatorIndex < 2 || separatorIndex > 60) {
            return '';
        }

        const department = normalized.slice(0, separatorIndex)
            .replace(/\s+/g, ' ')
            .trim();
        return department
            && /[А-ЯЁA-Z]/i.test(department)
            && !/[{}();=<>]/.test(department)
            ? department
            : '';
    };
    const normalizeFullName = (value) => {
        const cleaned = cleanValue(value)
            .replace(/\s*,.*$/, '')
            .replace(/^(заказ|история|болезни|исследований|исследование|пациент|карты|медицинская|информационная|система)\s+/i, '')
            .trim();

        if (/[{}();=]|\b(Form|function|return|var|const|let|D3Api)\b/i.test(cleaned)) {
            return '';
        }

        const words = cleaned.match(/[А-ЯЁ][А-ЯЁа-яё-]+/g) || [];
        if (words.length >= 2 && words.length <= 4) {
            return words.join(' ');
        }

        const match = cleaned.match(/\b[А-ЯЁ][А-ЯЁа-яё-]+(?:\s+[А-ЯЁ][А-ЯЁа-яё-]+){1,3}\b/);
        return match ? match[0] : '';
    };

    const inputValueByHints = (hints) => {
        const controls = Array.from(document.querySelectorAll('input, textarea, select'));
        for (const control of controls) {
            const getExternalLabel = () => {
                if (!control.id) {
                    return '';
                }

                try {
                    return document.querySelector(`label[for="${control.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)?.innerText || '';
                } catch (error) {
                    return '';
                }
            };
            const containerText = normalizeSpaces(
                control.closest('tr, [role="row"], .row, .form-group, .field, .control, .input-group, td, div')?.innerText || ''
            );
            const marker = normalizeSpaces([
                control.id,
                control.name,
                control.placeholder,
                control.title,
                control.getAttribute('aria-label'),
                control.closest('label')?.innerText,
                getExternalLabel(),
                containerText
            ].filter(Boolean).join(' ')).toLowerCase();

            if (hints.some((hint) => marker.includes(hint))) {
                const value = cleanValue(control.value || control.textContent);
                if (value) {
                    return value;
                }
            }
        }
        return '';
    };

    const textAfterLabel = (labels) => {
        for (const label of labels) {
            const pattern = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n\\r]{3,120})`, 'i');
            const match = visibleText.match(pattern);
            if (match?.[1]) {
                return cleanValue(match[1]);
            }
        }
        return '';
    };

    const findMedicalCardNumber = () => {
        if (headerPatientData.medicalCardNumber) {
            return headerPatientData.medicalCardNumber;
        }

        const fromCaption = getCaptionValue('CARD_NUMB', (value) => !!normalizeCardNumber(value));
        const captionCard = normalizeCardNumber(fromCaption);
        if (captionCard) {
            return captionCard;
        }

        const fromInput = inputValueByHints([
            'медицинской карты',
            'медкарта',
            'номер карты',
            '№ карты',
            'card',
            'history',
            'case'
        ]);
        const inputCard = normalizeCardNumber(fromInput);
        if (inputCard) {
            return inputCard;
        }

        const fromText = textAfterLabel([
            '№\\s*мед(?:ицинской)?\\s*карты',
            'Номер\\s*мед(?:ицинской)?\\s*карты',
            'Мед(?:ицинская)?\\s*карта',
            'Медкарта',
            'Карта'
        ]);
        const textCard = normalizeCardNumber(fromText);
        if (textCard) {
            return textCard;
        }

        const nearbyCard = visibleText.match(/(?:№\s*мед(?:ицинской)?\s*карты|номер\s*мед(?:ицинской)?\s*карты|медкарта|карта)\D{0,20}(\d{6,})/i);
        return nearbyCard?.[1] || '';
    };

    const findFullName = () => {
        const exactHistoryName = normalizeFullName(getHistoryCaption('PAT_FIO'));
        if (exactHistoryName) {
            return exactHistoryName;
        }

        if (headerPatientData.fullName) {
            return headerPatientData.fullName;
        }

        const directCaptionName = normalizeFullName(getDirectCaptionValue('FIO'));
        if (directCaptionName) {
            return directCaptionName;
        }

        const fromCaption = getCaptionValue('FIO', (value) => !!normalizeFullName(value));
        const captionName = normalizeFullName(fromCaption);
        if (captionName) {
            return captionName;
        }

        const patientBlockText = normalizeSpaces(document.querySelector('[name="PatientSelect"], .pat_sub_patient_select')?.innerText || '');
        const blockName = normalizeFullName(patientBlockText);
        if (blockName) {
            return blockName;
        }

        const fromInput = inputValueByHints(['фио', 'ф.и.о', 'пациент', 'patient', 'fullname']);
        const inputName = normalizeFullName(fromInput);
        if (inputName) {
            return inputName;
        }

        const fromText = textAfterLabel(['Ф\\.И\\.О\\.', 'ФИО', 'Пациент']);
        if (fromText) {
            const compact = normalizeFullName(fromText
                .replace(/\b(пол|возраст|дата рождения|д\/р|др|№|номер)\b.*$/i, '')
                .trim());
            if (compact) {
                return compact;
            }
        }

        return normalizeFullName(visibleText);
    };

    const findBirthDate = () => {
        const exactHistoryBirthDate = getHistoryCaption('PAT_BDATE')
            .match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/);
        if (exactHistoryBirthDate) {
            return exactHistoryBirthDate[0];
        }

        if (headerPatientData.birthDate) {
            return headerPatientData.birthDate;
        }

        const fromCaption = getCaptionValue('BIRTHDATE', (value) => /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(value));
        if (fromCaption) {
            return fromCaption;
        }

        const fromInput = inputValueByHints(['дата рождения', 'birth', 'birthday', 'др', 'д/р']);
        const inputDate = fromInput.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/);
        if (inputDate) {
            return inputDate[0];
        }

        const fromText = textAfterLabel(['Дата рождения', 'Д\\/р', 'ДР']);
        const textDate = fromText.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/);
        if (textDate) {
            return textDate[0];
        }

        const nearbyDate = visibleText.match(/(?:Дата рождения|Д\/р|ДР)\D{0,30}(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})/i);
        return nearbyDate?.[1] || '';
    };

    const findHistoryNumber = () => {
        const exactHistoryNumber = normalizeHistoryNumber(getHistoryCaption('HH_PREF_NUMB'));
        if (exactHistoryNumber) {
            return exactHistoryNumber;
        }

        const fromCaption = [
            getCaptionValue('HH_PREF_NUMB'),
            getCaptionValue('HH_NUMB')
        ].map(normalizeHistoryNumber).find(Boolean);
        if (fromCaption) {
            return fromCaption;
        }

        const fromText = textAfterLabel([
            'ИБ\\s*№',
            '№\\s*ИБ',
            'Номер\\s*ИБ',
            'История\\s+болезни'
        ]);
        return normalizeHistoryNumber(fromText);
    };

    const findDepartment = () => {
        const exactDepartment = extractDepartmentFromHistoryNumber(getHistoryCaption('HH_PREF_NUMB'));
        if (exactDepartment) {
            return exactDepartment;
        }

        return [
            getCaptionValue('HH_PREF_NUMB'),
            getCaptionValue('HH_NUMB')
        ].map(extractDepartmentFromHistoryNumber).find(Boolean) || '';
    };

    return {
        medicalCardNumber: findMedicalCardNumber(),
        historyNumber: findHistoryNumber(),
        department: findDepartment(),
        medicalOrganization: getCurrentMedicalOrganization(),
        doctorName: getCurrentDoctorName(),
        fullName: findFullName(),
        birthDate: findBirthDate()
    };
}

function switchProfileEditorTab(tabName) {
    activeProfileEditorTab = ['analyses', 'medications', 'procedures'].includes(tabName)
        ? tabName
        : 'analyses';

    document.querySelectorAll('.editor-tab').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === activeProfileEditorTab);
    });

    document.querySelectorAll('.editor-tab-panel').forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.panel !== activeProfileEditorTab);
    });
}

function getMedicationFormValues(prefix = 'medication') {
    return {
        id: document.getElementById(`${prefix}Id`)?.value || '',
        source: document.getElementById(`${prefix}Source`)?.value || 'manual',
        atc: document.getElementById(`${prefix}Atc`)?.value || '',
        name: document.getElementById(`${prefix}Name`)?.value || '',
        form: document.getElementById(`${prefix}Form`)?.value || '',
        dose: document.getElementById(`${prefix}Dose`)?.value || '',
        route: document.getElementById(`${prefix}Route`)?.value || '',
        frequency: document.getElementById(`${prefix}Frequency`)?.value || '',
        duration: document.getElementById(`${prefix}Duration`)?.value || '',
        regimen: document.getElementById(`${prefix}Regimen`)?.value || '',
        comment: document.getElementById(`${prefix}Comment`)?.value || ''
    };
}

function setMedicationFormValues(medication = {}, prefix = 'medication') {
    const normalized = normalizeMedication(medication) || {
        id: '',
        source: 'manual',
        atc: '',
        name: '',
        form: '',
        dose: '',
        route: '',
        frequency: '',
        duration: '',
        regimen: '',
        comment: ''
    };

    for (const [field, value] of Object.entries({
        Id: normalized.id,
        Source: normalized.source,
        Atc: normalized.atc,
        Name: normalized.name,
        Form: normalized.form,
        Dose: normalized.dose,
        Route: normalized.route,
        Frequency: normalized.frequency,
        Duration: normalized.duration,
        Regimen: normalized.regimen,
        Comment: normalized.comment
    })) {
        const element = document.getElementById(`${prefix}${field}`);
        if (element) {
            element.value = value;
        }
    }
}

function clearMedicationForm() {
    setMedicationFormValues();
    const saveButton = document.getElementById('addMedicationToProfile');
    if (saveButton) {
        saveButton.textContent = 'Добавить препарат в профиль';
    }
}

function fillMedicationFromCatalog(drug, form = '') {
    setMedicationFormValues({
        id: drug.id,
        source: 'catalog',
        atc: drug.atc,
        name: drug.name,
        form,
        dose: '',
        route: '',
        frequency: '',
        duration: '',
        regimen: '',
        comment: ''
    });
}

function renderDrugCatalogSearch() {
    const list = document.getElementById('drugCatalogList');
    const searchInput = document.getElementById('drugSearch');
    if (!list || !searchInput) {
        return;
    }

    const query = searchInput.value.trim().toLowerCase();
    list.textContent = '';

    if (!query) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Введите название или АТХ для поиска препарата';
        list.appendChild(empty);
        return;
    }

    const results = getDrugCatalog()
        .filter((drug) => `${drug.name} ${drug.atc} ${drug.group}`.toLowerCase().includes(query))
        .slice(0, 25);

    if (results.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Препарат не найден. Добавьте его вручную ниже.';
        list.appendChild(empty);
        return;
    }

    for (const drug of results) {
        const item = document.createElement('div');
        item.className = 'drug-result';

        const header = document.createElement('div');
        header.className = 'drug-result-title';
        header.textContent = `${drug.name}${drug.atc ? ` (${drug.atc})` : ''}`;

        const group = document.createElement('div');
        group.className = 'drug-result-group';
        group.textContent = drug.group;

        const forms = document.createElement('div');
        forms.className = 'drug-result-forms';

        const formValues = drug.forms.length ? drug.forms : [''];
        for (const form of formValues) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'small-btn';
            button.textContent = form || 'Выбрать';
            button.addEventListener('click', () => fillMedicationFromCatalog(drug, form));
            forms.appendChild(button);
        }

        item.append(header, group, forms);
        list.appendChild(item);
    }
}

function renderSelectedMedications() {
    const list = document.getElementById('profileMedicationList');
    const counter = document.getElementById('selectedMedicationCounter');
    if (!list || !counter) {
        return;
    }

    list.textContent = '';
    counter.textContent = `Выбрано: ${selectedMedications.length}`;

    if (selectedMedications.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Препараты в профиль пока не добавлены';
        list.appendChild(empty);
        return;
    }

    selectedMedications.forEach((medication, index) => {
        const row = document.createElement('div');
        row.className = 'medication-row';

        const text = document.createElement('div');
        text.className = 'medication-row-text';
        text.textContent = medicationToText(medication);

        const controls = document.createElement('div');
        controls.className = 'medication-row-actions';

        const upButton = document.createElement('button');
        upButton.type = 'button';
        upButton.className = 'small-btn';
        upButton.textContent = '↑';
        upButton.disabled = index === 0;
        upButton.addEventListener('click', () => {
            [selectedMedications[index - 1], selectedMedications[index]] = [selectedMedications[index], selectedMedications[index - 1]];
            renderSelectedMedications();
        });

        const downButton = document.createElement('button');
        downButton.type = 'button';
        downButton.className = 'small-btn';
        downButton.textContent = '↓';
        downButton.disabled = index === selectedMedications.length - 1;
        downButton.addEventListener('click', () => {
            [selectedMedications[index + 1], selectedMedications[index]] = [selectedMedications[index], selectedMedications[index + 1]];
            renderSelectedMedications();
        });

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'small-btn';
        editButton.textContent = 'Ред.';
        editButton.addEventListener('click', () => {
            setMedicationFormValues(medication);
            document.getElementById('addMedicationToProfile').textContent = 'Обновить препарат';
            switchProfileEditorTab('medications');
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'small-btn danger-mini';
        deleteButton.textContent = 'Удалить';
        deleteButton.addEventListener('click', () => {
            selectedMedications.splice(index, 1);
            renderSelectedMedications();
        });

        controls.append(upButton, downButton, editButton, deleteButton);
        row.append(text, controls);
        list.appendChild(row);
    });
}

function procedureToText(procedure) {
    return [procedure?.name, procedure?.comment]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' — ');
}

function clearProcedureForm() {
    document.getElementById('procedureId').value = '';
    document.getElementById('procedureName').value = '';
    document.getElementById('procedureComment').value = '';
    document.getElementById('addProcedureToProfile').textContent = 'Добавить назначение в профиль';
}

function renderSelectedProcedures() {
    const list = document.getElementById('profileProcedureList');
    const counter = document.getElementById('selectedProcedureCounter');
    if (!list || !counter) {
        return;
    }

    list.textContent = '';
    counter.textContent = `Выбрано: ${selectedProcedures.length}`;

    if (selectedProcedures.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Диагностические и режимные назначения пока не добавлены';
        list.appendChild(empty);
        return;
    }

    selectedProcedures.forEach((procedure, index) => {
        const row = document.createElement('div');
        row.className = 'medication-row';

        const text = document.createElement('div');
        text.className = 'medication-row-text';
        text.textContent = procedureToText(procedure);

        const controls = document.createElement('div');
        controls.className = 'medication-row-actions';

        const upButton = document.createElement('button');
        upButton.type = 'button';
        upButton.className = 'small-btn';
        upButton.textContent = '↑';
        upButton.disabled = index === 0;
        upButton.addEventListener('click', () => {
            [selectedProcedures[index - 1], selectedProcedures[index]] = [selectedProcedures[index], selectedProcedures[index - 1]];
            renderSelectedProcedures();
        });

        const downButton = document.createElement('button');
        downButton.type = 'button';
        downButton.className = 'small-btn';
        downButton.textContent = '↓';
        downButton.disabled = index === selectedProcedures.length - 1;
        downButton.addEventListener('click', () => {
            [selectedProcedures[index + 1], selectedProcedures[index]] = [selectedProcedures[index], selectedProcedures[index + 1]];
            renderSelectedProcedures();
        });

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'small-btn';
        editButton.textContent = 'Ред.';
        editButton.addEventListener('click', () => {
            document.getElementById('procedureId').value = procedure.id;
            document.getElementById('procedureName').value = procedure.name;
            document.getElementById('procedureComment').value = procedure.comment;
            document.getElementById('addProcedureToProfile').textContent = 'Обновить назначение';
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'small-btn danger-mini';
        deleteButton.textContent = 'Удалить';
        deleteButton.addEventListener('click', () => {
            selectedProcedures.splice(index, 1);
            renderSelectedProcedures();
        });

        controls.append(upButton, downButton, editButton, deleteButton);
        row.append(text, controls);
        list.appendChild(row);
    });
}

function addProcedureFromEditor() {
    const procedure = normalizeProcedure({
        id: document.getElementById('procedureId').value || generateId('procedure'),
        name: document.getElementById('procedureName').value,
        comment: document.getElementById('procedureComment').value
    });

    if (!procedure) {
        setStatus('❌ Укажите название диагностического или режимного назначения', '#f44336');
        return;
    }

    const existingIndex = selectedProcedures.findIndex((item) => item.id === procedure.id);
    if (existingIndex >= 0) {
        selectedProcedures[existingIndex] = procedure;
    } else {
        selectedProcedures.push(procedure);
    }

    renderSelectedProcedures();
    clearProcedureForm();
}

function addMedicationFromEditor() {
    const rawMedication = getMedicationFormValues();
    if (!rawMedication.id) {
        rawMedication.id = rawMedication.source === 'catalog'
            ? rawMedication.name
            : generateId('custom');
    }

    const medication = normalizeMedication(rawMedication);
    if (!medication) {
        setStatus('❌ Укажите название препарата', '#f44336');
        return;
    }

    const existingIndex = selectedMedications.findIndex((item) => item.id === medication.id);
    if (existingIndex >= 0) {
        selectedMedications[existingIndex] = medication;
    } else {
        selectedMedications.push(medication);
    }

    renderSelectedMedications();
    clearMedicationForm();
}

function saveManualDrugToCatalog() {
    const medication = normalizeMedication(getMedicationFormValues());
    if (!medication) {
        setStatus('❌ Укажите название препарата для справочника', '#f44336');
        return;
    }

    const customCatalog = getCustomDrugCatalog();
    const id = medication.atc
        ? `${medication.atc}-${medication.name.toLowerCase().replace(/\s+/g, '-')}`
        : `custom-${medication.name.toLowerCase().replace(/\s+/g, '-')}`;
    const existingIndex = customCatalog.findIndex((drug) => drug.id === id);
    const nextDrug = {
        id,
        atc: medication.atc,
        group: 'Пользовательский справочник',
        name: medication.name,
        forms: medication.form ? [medication.form] : []
    };

    if (existingIndex >= 0) {
        customCatalog[existingIndex] = {
            ...customCatalog[existingIndex],
            forms: Array.from(new Set([...customCatalog[existingIndex].forms, ...nextDrug.forms]))
        };
    } else {
        customCatalog.push(nextDrug);
    }

    saveCustomDrugCatalog(customCatalog);
    renderDrugCatalogSearch();
    setStatus('✅ Препарат сохранён в пользовательский справочник');
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
        const profile = normalizeProfile(profileLibrary[profileName]);
        selectedProfileIcon = profileTitle.icon;
        selectedResearchIds = new Set(Object.keys(profile.analyses));
        selectedMedications = [...profile.medications];
        selectedProcedures = [...profile.procedures];
        nameInput.value = profileTitle.name;
        title.textContent = 'Редактирование профиля';
        saveButton.textContent = 'Сохранить назначение';
    } else {
        selectedProfileIcon = PROFILE_ICONS[0];
        selectedResearchIds = new Set();
        selectedMedications = [];
        selectedProcedures = [];
        nameInput.value = '';
        title.textContent = 'Новое назначение';
        saveButton.textContent = 'Добавить назначение';
    }

    document.getElementById('researchSearch').value = '';
    document.getElementById('drugSearch').value = '';
    clearMedicationForm();
    clearProcedureForm();
    editor.classList.remove('hidden');
    switchProfileEditorTab('analyses');
    renderIconPicker();
    renderResearchList();
    renderDrugCatalogSearch();
    renderSelectedMedications();
    renderSelectedProcedures();

    await loadResearchesForEditor();
}

function closeProfileEditor() {
    editingProfileName = null;
    selectedResearchIds = new Set();
    selectedMedications = [];
    selectedProcedures = [];
    document.getElementById('profileEditor').classList.add('hidden');
}

function saveProfileFromEditor() {
    const nameInput = document.getElementById('profileNameInput');
    const profileName = nameInput.value.trim();

    if (!profileName) {
        setStatus('❌ Укажите название назначения', '#f44336');
        return;
    }

    if (selectedResearchIds.size === 0 && selectedMedications.length === 0 && selectedProcedures.length === 0) {
        setStatus('❌ Добавьте хотя бы одно исследование, препарат или процедуру', '#f44336');
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

    customProfiles[newTitle] = {
        analyses,
        medications: normalizeMedications(selectedMedications),
        procedures: normalizeProcedures(selectedProcedures)
    };
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
        researchCatalog: getResearchCatalog(),
        customDrugCatalog: getCustomDrugCatalog()
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
    const importedCustomDrugCatalog = normalizeDrugCatalog(config?.customDrugCatalog || config?.drugCatalog || []);

    saveCustomProfiles(importedTemplates);
    saveActiveProfileNames(importedActiveProfiles);
    saveResearchCatalog(importedCatalog);
    saveAssignmentSettings(importedSettings);
    saveCustomDrugCatalog(importedCustomDrugCatalog);

    refreshProfiles();
    loadedResearches = loadSavedResearches();
    populateProfileSelect();
    renderTemplateLibraryList();
    renderProfileManagerList();
    renderDrugCatalogSearch();
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
    const getCheckboxes = () => Array.from(document.querySelectorAll(CHECKBOX_SELECTOR))
        .filter((checkbox) => checkbox.getAttribute('item_value'));
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
    const journalEnabledCheckbox = document.getElementById('journalEnabledCheckbox');
    const journalRetentionInput = document.getElementById('journalRetentionDays');
    const settings = saveAssignmentSettings({
        assignmentStage: slider?.value === '1' ? ASSIGNMENT_STAGE_SCHEDULE : ASSIGNMENT_STAGE_ANALYSES,
        targetCabinet: targetCabinetInput?.value || '',
        markUrgent: markUrgentCheckbox?.checked === true,
        journalEnabled: journalEnabledCheckbox?.checked !== false,
        journalRetentionDays: journalRetentionInput?.value || DEFAULT_JOURNAL_RETENTION_DAYS
    });

    updateAssignmentStageUi(settings);
}

// Заполняем выпадающий список профилями
document.addEventListener('DOMContentLoaded', async () => {
    const loadedManifestVersion = globalThis.chrome?.runtime?.getManifest?.().version || '';
    const versionMismatch = !!loadedManifestVersion && loadedManifestVersion !== EXTENSION_VERSION;
    const versionElement = document.querySelector('.version');
    if (versionElement) {
        versionElement.textContent = versionMismatch
            ? `Сборка ${EXTENSION_VERSION}; браузер загрузил ${loadedManifestVersion} — перезагрузите расширение`
            : `Версия ${EXTENSION_VERSION} | Для медицинских информационных систем`;
        versionElement.style.color = versionMismatch ? '#d32f2f' : '';
    }
    if (versionMismatch) {
        const fillButton = document.getElementById('fillForm');
        const statusDiv = document.getElementById('status');
        if (fillButton) {
            fillButton.disabled = true;
        }
        if (statusDiv) {
            statusDiv.textContent = `❌ Загружена смешанная версия: сборка ${EXTENSION_VERSION}, манифест ${loadedManifestVersion}. Перезагрузите расширение в Яндекс Браузере.`;
            statusDiv.style.color = '#f44336';
        }
    }

    applyExtensionConfig(await loadExtensionConfigFile());
    CONFIG_DRUG_CATALOG = normalizeDrugCatalog([
        ...CONFIG_DRUG_CATALOG,
        ...await loadDrugCatalogFile()
    ]);
    refreshProfiles();
    populateProfileSelect();
    renderTemplateLibraryList();
    renderProfileManagerList();
    updateAssignmentStageUi();
    document.getElementById('appointmentDate').value = new Date().toISOString().slice(0, 10);
    cleanupOldJournalEntries().catch((error) => console.warn('Не удалось очистить журнал назначений', error));

    document.getElementById('settingsToggle').addEventListener('click', openSettingsPanel);
    document.getElementById('closeSettings').addEventListener('click', closeSettingsPanel);
    document.getElementById('addProfile').addEventListener('click', () => openProfileEditor());
    document.getElementById('cancelEdit').addEventListener('click', closeProfileEditor);
    document.getElementById('saveProfile').addEventListener('click', saveProfileFromEditor);
    document.getElementById('loadResearches').addEventListener('click', loadResearchesForEditor);
    document.getElementById('researchSearch').addEventListener('input', renderResearchList);
    document.querySelectorAll('.editor-tab').forEach((button) => {
        button.addEventListener('click', () => switchProfileEditorTab(button.dataset.tab));
    });
    document.getElementById('drugSearch').addEventListener('input', renderDrugCatalogSearch);
    document.getElementById('addMedicationToProfile').addEventListener('click', addMedicationFromEditor);
    document.getElementById('clearMedicationForm').addEventListener('click', clearMedicationForm);
    document.getElementById('saveManualDrug').addEventListener('click', saveManualDrugToCatalog);
    document.getElementById('addProcedureToProfile').addEventListener('click', addProcedureFromEditor);
    document.getElementById('clearProcedureForm').addEventListener('click', clearProcedureForm);
    document.getElementById('assignmentStageSlider').addEventListener('input', saveScenarioSettingsFromUi);
    document.getElementById('targetCabinetInput').addEventListener('input', saveScenarioSettingsFromUi);
    document.getElementById('markUrgentCheckbox').addEventListener('change', saveScenarioSettingsFromUi);
    document.getElementById('journalEnabledCheckbox').addEventListener('change', saveScenarioSettingsFromUi);
    document.getElementById('journalRetentionDays').addEventListener('change', saveScenarioSettingsFromUi);
    document.getElementById('openPrintSheet').addEventListener('click', openPrintSheetForSelectedProfile);
    document.getElementById('openBloodRequest').addEventListener('click', openBloodRequest);
    document.getElementById('openTransfusionProtocol').addEventListener('click', openTransfusionProtocol);
    document.getElementById('saveJournalEntry').addEventListener('click', () => {
        saveSelectedProfileToJournal().catch((error) => {
            console.error('Не удалось сохранить журнал назначений', error);
            setStatus('❌ Не удалось сохранить журнал', '#f44336');
        });
    });
    document.getElementById('openJournal').addEventListener('click', () => {
        renderJournalPanel().catch((error) => {
            console.error('Не удалось открыть журнал назначений', error);
            setStatus('❌ Не удалось открыть журнал', '#f44336');
        });
    });
    document.getElementById('closeJournal').addEventListener('click', closeJournalPanel);
    document.getElementById('openDiagnostics').addEventListener('click', () => {
        renderDiagnosticPanel().catch((error) => {
            console.error('Не удалось открыть диагностический журнал', error);
            setStatus('❌ Не удалось открыть диагностический журнал', '#f44336');
        });
    });
    document.getElementById('closeDiagnostics').addEventListener('click', closeDiagnosticPanel);
    document.getElementById('diagnosticRunSelect').addEventListener('change', (event) => {
        selectedDiagnosticRunId = event.target.value;
        renderDiagnosticPanelContents();
    });
    document.getElementById('copyDiagnostics').addEventListener('click', () => {
        copyLatestDiagnosticLog().catch((error) => {
            console.error('Не удалось скопировать диагностический журнал', error);
            setStatus('❌ Не удалось скопировать диагностический журнал', '#f44336');
        });
    });
    document.getElementById('exportDiagnostics').addEventListener('click', () => {
        exportLatestDiagnosticLog().catch((error) => {
            console.error('Не удалось выгрузить диагностический журнал', error);
            setStatus('❌ Не удалось выгрузить диагностический журнал', '#f44336');
        });
    });
    document.getElementById('clearDiagnostics').addEventListener('click', () => {
        clearDiagnosticRuns().catch((error) => {
            console.error('Не удалось удалить диагностические логи', error);
            setStatus('❌ Не удалось удалить диагностические логи', '#f44336');
        });
    });
    document.getElementById('clearJournalNow').addEventListener('click', async () => {
        if (!confirm('Очистить локальный журнал назначений сейчас?')) {
            return;
        }
        await clearJournal();
        renderJournalPanel();
        setStatus('✅ Журнал очищен');
    });
    document.getElementById('exportConfig').addEventListener('click', exportConfigFile);
    document.getElementById('importConfig').addEventListener('click', () => document.getElementById('importConfigFile').click());
    document.getElementById('importConfigFile').addEventListener('change', (event) => {
        importConfigFile(event.target.files?.[0]);
        event.target.value = '';
    });
});

function inspectBarsFrame() {
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (element) => {
        if (!element || !element.isConnected) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden';
    };
    const getVisibleElements = (selector) => Array.from(document.querySelectorAll(selector)).filter(isVisible);
    const contexts = [window];

    try {
        contexts.push(window.parent, window.top);
    } catch (error) {
        // A cross-origin parent cannot contribute to the BARS context.
    }

    const patientVariableNames = ['PERSMEDCARD', 'PATIENT_ID', 'PATIENT'];
    const hasPatientContext = contexts
        .filter((context, index, list) => context && list.indexOf(context) === index)
        .some((context) => {
            try {
                if (typeof context.getVar !== 'function') {
                    return false;
                }

                return patientVariableNames.flatMap((name) => [context.getVar(name, 1), context.getVar(name)])
                    .some((value) => value !== undefined && value !== null && String(value).trim() !== '');
            } catch (error) {
                return false;
            }
        });
    const orderShells = getVisibleElements('.dirline_order_alt');
    const orderForms = orderShells.filter((form) => form.querySelector('[name="GridGroups"]')
        && form.querySelector('[name="GridResearch"]')
        && form.querySelector('[name="GridDirline"]'));
    const researchGrids = orderForms
        .map((form) => form.querySelector('[name="GridResearch"]'))
        .filter(Boolean);
    const checkboxCount = researchGrids.reduce((count, grid) => count
        + Array.from(grid.querySelectorAll('input[name="GridResearch_SelectList_Item"]'))
            .filter((checkbox) => checkbox.getAttribute('item_value')
                || (checkbox.value && checkbox.value !== 'on')).length, 0);
    const hasOrderForm = orderForms.length > 0;
    const hasOpenLabButton = getVisibleElements([
        '[name="byNaprAnalyseLab"]',
        '[name="linkDirLineOrder"]',
        '[onclick*=".openDirLineOrder"]'
    ].join(', ')).length > 0;
    const hasLabHistoryLink = getVisibleElements('span, a, td, div')
        .some((element) => normalizeText(element.textContent).includes('лабораторные исследования')
            && normalizeText(element.getAttribute('onclick')).includes('openonlinkwindow'));
    const hasBarsApi = contexts.some((context) => {
        try {
            return typeof context?.openD3Form === 'function';
        } catch (error) {
            return false;
        }
    });
    const score = (hasOrderForm ? 10000 : 0)
        + (researchGrids.length > 0 ? 6000 : 0)
        + Math.min(checkboxCount, 500)
        + (hasPatientContext && hasOpenLabButton ? 2000 : 0)
        + (hasPatientContext && hasLabHistoryLink ? 1200 : 0)
        + (hasPatientContext && hasBarsApi ? 500 : 0);

    return {
        score,
        hasOrderForm,
        hasOrderShell: orderShells.length > 0,
        researchGridCount: researchGrids.length,
        checkboxCount,
        hasPatientContext,
        hasOpenLabButton,
        hasLabHistoryLink,
        hasBarsApi
    };
}

function selectBarsFrame(results) {
    const candidates = (results || [])
        .map((entry) => ({ frameId: entry.frameId, ...entry.result }))
        .filter((frame) => Number.isInteger(frame.frameId)
            && frame.score > 0
            && (frame.hasOrderForm
                || frame.researchGridCount > 0
                || frame.hasOpenLabButton
                || frame.hasLabHistoryLink))
        .sort((left, right) => right.score - left.score || right.checkboxCount - left.checkboxCount);
    if (candidates.length > 0) {
        return candidates[0];
    }

    // API fallback is safe only when exactly one frame owns both the patient
    // context and the BARS form API. Never start a mutating runner in all frames.
    const apiCandidates = (results || [])
        .map((entry) => ({ frameId: entry.frameId, ...entry.result }))
        .filter((frame) => Number.isInteger(frame.frameId)
            && frame.hasPatientContext
            && frame.hasBarsApi);
    return apiCandidates.length === 1 ? apiCandidates[0] : null;
}

function invokeFillBARSRunner(formData, profileName, assignmentSettings, diagnosticRunId, diagnosticBridgeToken) {
    const runner = globalThis.__FillBARS_RUNNER__;
    if (!runner || typeof runner.run !== 'function') {
        return {
            message: 'Движок FillBARS не загружен',
            filledCount: 0,
            totalFound: 0,
            fatalError: true,
            runnerMissing: true
        };
    }

    const lockSlot = '__FillBARS_ACTIVE_RUN_V1__';
    const activeRun = globalThis[lockSlot];
    if (activeRun?.promise) {
        return {
            message: 'В этой форме уже выполняется другой запуск FillBARS',
            filledCount: 0,
            totalFound: 0,
            blocked: true,
            runnerBusy: true,
            activeRunId: activeRun.runId || ''
        };
    }

    const promise = Promise.resolve().then(() => runner.run(
        formData,
        profileName,
        assignmentSettings,
        diagnosticRunId,
        diagnosticBridgeToken
    ));
    globalThis[lockSlot] = { runId: diagnosticRunId, promise };
    return promise.finally(() => {
        if (globalThis[lockSlot]?.promise === promise) {
            delete globalThis[lockSlot];
        }
    });
}

function installDiagnosticBridge(diagnosticRunId, bridgeToken, extensionVersion, continuationContext = {}) {
    const namespace = 'fillbars-diagnostics-v1';
    // A bridge is scoped to its random token. A second popup run must not
    // detach diagnostics from an earlier runner that is still finishing.
    const bridgeSlot = `__fillbarsDiagnosticBridgeV1_${bridgeToken}`;
    const previousBridge = window[bridgeSlot];
    if (previousBridge && typeof previousBridge.dispose === 'function') {
        previousBridge.dispose();
    }

    const forward = (payload) => {
        try {
            chrome.runtime.sendMessage({
                namespace,
                ...payload,
                runId: diagnosticRunId,
                extensionVersion
            }, () => {
                // The popup may close while the page keeps running. Reading
                // lastError prevents a harmless console warning in that case.
                void chrome.runtime.lastError;
            });
        } catch (error) {
            // Diagnostics must never interrupt the BARS workflow.
        }
    };

    let scheduleObserver = null;
    let schedulePollTimer = null;
    let scheduleTimeoutTimer = null;
    let scheduleWatchdogTimer = null;
    let scheduleMonitorStarted = false;
    let scheduleDetected = false;
    let resumeRequestInFlight = false;
    let pageCompleted = false;
    let lastResumeReason = '';

    const stopScheduleMonitor = () => {
        if (scheduleObserver) {
            scheduleObserver.disconnect();
            scheduleObserver = null;
        }
        clearInterval(schedulePollTimer);
        clearTimeout(scheduleTimeoutTimer);
        schedulePollTimer = null;
        scheduleTimeoutTimer = null;
    };

    const getVisibleScheduleForms = () => {
        return Array.from(document.querySelectorAll('.form-schedule'))
            .filter((form) => {
                if (!form.isConnected) {
                    return false;
                }
                const rect = form.getBoundingClientRect();
                const style = window.getComputedStyle(form);
                return rect.width > 0
                    && rect.height > 0
                    && style.display !== 'none'
                    && style.visibility !== 'hidden';
            });
    };

    const requestScheduleResume = (trigger) => {
        if (pageCompleted || resumeRequestInFlight || getVisibleScheduleForms().length === 0) {
            return;
        }
        resumeRequestInFlight = true;

        try {
            chrome.runtime.sendMessage({
                namespace,
                action: 'resume_schedule',
                runId: diagnosticRunId,
                token: bridgeToken,
                extensionVersion,
                continuation: continuationContext
            }, (response) => {
                const runtimeError = chrome.runtime.lastError;
                resumeRequestInFlight = false;
                if (pageCompleted) {
                    return;
                }
                const reason = runtimeError
                    ? 'resume_message_failed'
                    : (response?.reason || response?.error || 'resume_response_missing');
                const resumed = !runtimeError && response?.resumed === true;
                if (trigger === 'detected' || resumed || reason !== lastResumeReason) {
                    forward({
                        action: 'append',
                        time: new Date().toISOString(),
                        event: trigger === 'detected'
                            ? 'bridge:schedule_resume_result'
                            : 'bridge:schedule_watchdog_result',
                        details: {
                            trigger,
                            ok: !runtimeError && response?.ok === true,
                            resumed,
                            reason
                        }
                    });
                }
                lastResumeReason = reason;
            });
        } catch (error) {
            resumeRequestInFlight = false;
            // The original runner may still own the transition. Resume is best-effort.
        }
    };

    const detectScheduleForm = () => {
        if (scheduleDetected) {
            return true;
        }

        const forms = getVisibleScheduleForms();
        if (forms.length === 0) {
            return false;
        }

        scheduleDetected = true;
        stopScheduleMonitor();
        forward({
            action: 'append',
            time: new Date().toISOString(),
            event: 'bridge:schedule_detected',
            details: {
                formCount: forms.length,
                sourceOrderFormPresent: !!document.querySelector('.dirline_order_alt')
            }
        });
        requestScheduleResume('detected');
        scheduleWatchdogTimer = setInterval(() => {
            requestScheduleResume('watchdog');
        }, 1000);
        return true;
    };

    const startScheduleMonitor = () => {
        if (scheduleMonitorStarted) {
            return;
        }
        scheduleMonitorStarted = true;

        if (detectScheduleForm()) {
            return;
        }

        scheduleObserver = new MutationObserver(detectScheduleForm);
        scheduleObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });
        schedulePollTimer = setInterval(detectScheduleForm, 250);
        scheduleTimeoutTimer = setTimeout(() => {
            stopScheduleMonitor();
            forward({
                action: 'append',
                time: new Date().toISOString(),
                event: 'bridge:schedule_transition_timeout',
                details: {
                    timeoutMs: 30000,
                    sourceOrderFormPresent: !!document.querySelector('.dirline_order_alt')
                }
            });
        }, 30000);
    };

    const onMessage = (event) => {
        const data = event?.data;
        if (event.source !== window
            || !data
            || data.source !== 'fillbars-diagnostic-page-v1'
            || data.runId !== diagnosticRunId
            || data.token !== bridgeToken) {
            return;
        }

        if (data.kind === 'append') {
            if (data.event === 'assign_button:click') {
                startScheduleMonitor();
            }
            forward({
                action: 'append',
                id: data.id,
                time: data.time,
                event: data.event,
                details: data.details
            });
            return;
        }

        if (data.kind === 'complete') {
            pageCompleted = true;
            clearInterval(scheduleWatchdogTimer);
            scheduleWatchdogTimer = null;
            forward({
                action: 'page_complete',
                time: data.time,
                status: data.status,
                summary: data.summary
            });
            setTimeout(dispose, 1000);
        }
    };

    const dispose = () => {
        stopScheduleMonitor();
        clearInterval(scheduleWatchdogTimer);
        scheduleWatchdogTimer = null;
        clearTimeout(lifetimeTimer);
        window.removeEventListener('message', onMessage);
        if (window[bridgeSlot]?.dispose === dispose) {
            delete window[bridgeSlot];
        }
    };

    window.addEventListener('message', onMessage);
    window[bridgeSlot] = { runId: diagnosticRunId, dispose };
    const lifetimeTimer = setTimeout(dispose, 10 * 60 * 1000);
    forward({
        action: 'append',
        time: new Date().toISOString(),
        event: 'bridge:installed',
        details: {}
    });
    return { installed: true };
}

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
    
    const formData = getProfileAnalyses(PROFILES[selectedProfile]);
    const assignmentSettings = getAssignmentSettings();
    const diagnosticRun = createDiagnosticRun(selectedProfile, assignmentSettings);
    const diagnosticBridgeToken = generateId('bridge');
    statusDiv.textContent = '⏳ Заполнение...';
    statusDiv.style.color = '#ff9800';
    fillButton.disabled = true;
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
            statusDiv.textContent = '❌ Ошибка: активная вкладка не найдена';
            statusDiv.style.color = '#f44336';
            fillButton.disabled = false;
            completeDiagnosticRun(diagnosticRun, 'failed', {
                reason: 'active_tab_not_found'
            });
            return;
        }

        appendDiagnosticRunEvent(diagnosticRun, 'popup:active_tab_found', {
            tabId: tabs[0].id
        });

        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id, allFrames: true },
            world: 'MAIN',
            func: inspectBarsFrame
        }, (probeResults) => {
            const probeError = chrome.runtime.lastError?.message || null;
            const targetFrame = probeError ? null : selectBarsFrame(probeResults);
            appendDiagnosticRunEvent(diagnosticRun, 'popup:frame_probe', {
                errorCode: classifyExtensionError(probeError),
                selectedFrameId: targetFrame?.frameId ?? null,
                frames: (probeResults || []).map((entry) => ({
                    frameId: entry.frameId,
                    score: entry.result?.score || 0,
                    hasOrderForm: entry.result?.hasOrderForm === true,
                    hasOrderShell: entry.result?.hasOrderShell === true,
                    researchGridCount: entry.result?.researchGridCount || 0,
                    checkboxCount: entry.result?.checkboxCount || 0,
                    hasPatientContext: entry.result?.hasPatientContext === true,
                    hasOpenLabButton: entry.result?.hasOpenLabButton === true,
                    hasLabHistoryLink: entry.result?.hasLabHistoryLink === true,
                    hasBarsApi: entry.result?.hasBarsApi === true
                }))
            });

            if (probeError) {
                console.warn('[FillBARS] Не удалось безопасно определить фрейм БАРС; запуск остановлен.', probeError);
            } else {
                console.log('[FillBARS] Диагностика фреймов БАРС', (probeResults || []).map((entry) => ({
                    frameId: entry.frameId,
                    ...entry.result
                })));
            }

            if (!targetFrame) {
                statusDiv.textContent = probeError
                    ? '❌ Не удалось безопасно определить фрейм БАРС'
                    : '❌ Не найден единственный безопасный фрейм БАРС';
                statusDiv.style.color = '#f44336';
                fillButton.disabled = false;
                completeDiagnosticRun(diagnosticRun, 'failed', {
                    reason: probeError ? 'frame_probe_failed' : 'safe_bars_frame_not_found',
                    errorCode: classifyExtensionError(probeError),
                    frameCount: (probeResults || []).length
                });
                return;
            }

            const executionTarget = { tabId: tabs[0].id, frameIds: [targetFrame.frameId] };

            chrome.scripting.executeScript({
                target: executionTarget,
                world: 'ISOLATED',
                func: installDiagnosticBridge,
                args: [diagnosticRun.id, diagnosticBridgeToken, EXTENSION_VERSION, {
                    profileName: selectedProfile,
                    assignmentSettings,
                    filledCount: Object.values(formData).filter((value) => value === true).length
                }]
            }, () => {
                const bridgeError = chrome.runtime.lastError?.message || null;
                appendDiagnosticRunEvent(diagnosticRun, 'popup:diagnostic_bridge', {
                    installed: !bridgeError,
                    errorCode: classifyExtensionError(bridgeError),
                    selectedFrameId: targetFrame?.frameId ?? null
                });

                chrome.scripting.executeScript({
                target: executionTarget,
                world: 'MAIN',
                files: ['bars-adapter.js']
            }, () => {
                const adapterError = chrome.runtime.lastError?.message || null;
                if (adapterError) {
                    statusDiv.textContent = `❌ Не удалось загрузить адаптер БАРС: ${adapterError}`;
                    statusDiv.style.color = '#f44336';
                    fillButton.disabled = false;
                    completeDiagnosticRun(diagnosticRun, 'failed', {
                        reason: 'adapter_load_failed',
                        errorCode: classifyExtensionError(adapterError),
                        selectedFrameId: targetFrame?.frameId ?? null
                    });
                    return;
                }

                appendDiagnosticRunEvent(diagnosticRun, 'popup:adapter_loaded', {
                    selectedFrameId: targetFrame.frameId,
                    allFrames: false
                });

                chrome.scripting.executeScript({
                    target: executionTarget,
                    world: 'MAIN',
                    files: ['fill-runner.js']
                }, () => {
                    const runnerLoadError = chrome.runtime.lastError?.message || null;
                    if (runnerLoadError) {
                        statusDiv.textContent = `❌ Не удалось загрузить движок FillBARS: ${runnerLoadError}`;
                        statusDiv.style.color = '#f44336';
                        fillButton.disabled = false;
                        completeDiagnosticRun(diagnosticRun, 'failed', {
                            reason: 'runner_load_failed',
                            errorCode: classifyExtensionError(runnerLoadError),
                            selectedFrameId: targetFrame?.frameId ?? null
                        });
                        return;
                    }

                    appendDiagnosticRunEvent(diagnosticRun, 'popup:runner_loaded', {
                        selectedFrameId: targetFrame.frameId,
                        allFrames: false
                    });

                    chrome.scripting.executeScript({
                        target: executionTarget,
                        world: 'MAIN',
                        func: invokeFillBARSRunner,
                        args: [formData, selectedProfile, assignmentSettings, diagnosticRun.id, diagnosticBridgeToken]
                    }, (results) => {
                    const executeError = chrome.runtime.lastError?.message || null;
                    const resultEntries = (results || [])
                        .filter((entry) => entry?.result && typeof entry.result === 'object')
                        .map((entry) => ({ frameId: entry.frameId, payload: entry.result }));
                    const resultPayloads = resultEntries.map((entry) => entry.payload);
                    const pageEvents = resultEntries.flatMap((entry) => Array.isArray(entry.payload.diagnostics)
                        ? entry.payload.diagnostics.map((event) => ({
                            ...event,
                            details: {
                                ...(event?.details && typeof event.details === 'object' ? event.details : {}),
                                tabId: tabs[0].id,
                                frameId: entry.frameId
                            }
                        }))
                        : []);

                    if (executeError) {
                        statusDiv.textContent = `❌ Ошибка: ${executeError}`;
                        statusDiv.style.color = '#f44336';
                        completeDiagnosticRun(diagnosticRun, 'failed', {
                            reason: 'fill_script_failed',
                            errorCode: classifyExtensionError(executeError),
                            selectedFrameId: targetFrame?.frameId ?? null
                        }, pageEvents);
                    } else if (results && results.length) {
                        const successfulEntries = resultEntries.filter((entry) => !entry.payload.skipped);
                        const selectedResultEntry = successfulEntries.find((entry) => entry.payload.filledCount > 0 || entry.payload.totalFound > 0)
                            || successfulEntries[0];
                        const result = selectedResultEntry?.payload || null;
                        const selectedResultFrameId = selectedResultEntry?.frameId ?? targetFrame?.frameId ?? null;

                        if (!result) {
                            statusDiv.textContent = '❌ Не найдена карточка пациента или форма лаборатории БАРС';
                            statusDiv.style.color = '#f44336';
                            fillButton.disabled = false;
                            completeDiagnosticRun(diagnosticRun, 'failed', {
                                reason: 'bars_context_not_found',
                                selectedFrameId: targetFrame?.frameId ?? null,
                                resultCount: resultPayloads.length
                            }, pageEvents);
                            return;
                        }

                        const paginationStatus = result.pagination?.usedBarsRangeControl
                            ? ' Штатная пагинация БАРС: 150 записей.'
                            : '';
                        const hasProgress = !result.fatalError && result.filledCount > 0;
                        const isBlocked = result.blocked === true || result.scheduleResult?.blocked === true;
                        const blockedReason = result.runnerBusy === true
                            ? 'runner_already_active'
                            : (result.blockReason || result.scheduleResult?.reason || 'workflow_blocked');
                        const scheduleIncomplete = result.assignmentStage === ASSIGNMENT_STAGE_SCHEDULE
                            && result.scheduleResult?.complete !== true;
                        const hasMissingResearches = (result.missingCount || 0) > 0;
                        const isPartial = hasProgress && (hasMissingResearches || scheduleIncomplete);
                        const runStatus = isBlocked
                            ? 'partial'
                            : (hasProgress ? (isPartial ? 'partial' : 'success') : 'failed');
                        const statusIcon = runStatus === 'success' ? '✅' : (runStatus === 'partial' ? '⚠️' : '❌');
                        statusDiv.textContent = `${statusIcon} ${result.message}${paginationStatus}`;
                        statusDiv.style.color = runStatus === 'success' ? '#4CAF50' : (runStatus === 'partial' ? '#ff9800' : '#f44336');
                        completeDiagnosticRun(diagnosticRun, runStatus, {
                            reason: result.fatalError
                                ? 'unhandled_error'
                                : (isBlocked
                                    ? blockedReason
                                    : (runStatus === 'success'
                                    ? 'completed'
                                    : (runStatus === 'partial'
                                        ? (scheduleIncomplete
                                            ? (hasMissingResearches
                                                ? 'completed_with_missing_researches_and_incomplete_schedule'
                                                : 'completed_with_incomplete_schedule')
                                            : 'completed_with_missing_researches')
                                        : 'no_researches_processed'))),
                            message: result.message,
                            filledCount: result.filledCount || 0,
                            totalFound: result.totalFound || 0,
                            pagesProcessed: result.pagesProcessed || 0,
                            missingCount: result.missingCount || 0,
                            missingItemValues: result.missingItemValues || [],
                            pagination: result.pagination || null,
                            assignmentStage: result.assignmentStage || null,
                            scheduleResult: result.scheduleResult || null,
                            selectedFrameId: selectedResultFrameId
                        }, pageEvents);
                    } else {
                        statusDiv.textContent = '❌ Сценарий не вернул результат';
                        statusDiv.style.color = '#f44336';
                        completeDiagnosticRun(diagnosticRun, 'failed', {
                            reason: 'fill_script_returned_no_results',
                            selectedFrameId: targetFrame?.frameId ?? null
                        }, pageEvents);
                    }

                    fillButton.disabled = false;
                });
                });
            });
            });
        });
    });
});

// Закрытие попапа
document.getElementById('closePopup').addEventListener('click', () => {
    window.close();
});
