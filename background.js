const DIAGNOSTIC_MESSAGE_NAMESPACE = 'fillbars-diagnostics-v1';
const DIAGNOSTIC_RUNS_STORAGE_KEY = 'fillbarsDiagnosticRunsV1';
const MAX_DIAGNOSTIC_RUNS = 12;
const MAX_DIAGNOSTIC_EVENTS = 220;
const RUNNING_STALE_MS = 5 * 60 * 1000;

let diagnosticOperationQueue = Promise.resolve();

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

async function getDiagnosticRuns() {
    const stored = await chrome.storage.local.get(DIAGNOSTIC_RUNS_STORAGE_KEY);
    const runs = stored[DIAGNOSTIC_RUNS_STORAGE_KEY];
    return Array.isArray(runs)
        ? runs.filter((run) => run && typeof run === 'object')
            .sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))
            .slice(0, MAX_DIAGNOSTIC_RUNS)
        : [];
}

async function saveDiagnosticRuns(runs) {
    const limitedRuns = sanitizeDiagnosticValue(runs)
        .slice(0, MAX_DIAGNOSTIC_RUNS)
        .map((run) => ({
            ...run,
            events: Array.isArray(run.events) ? run.events.slice(-MAX_DIAGNOSTIC_EVENTS) : []
        }));

    try {
        await chrome.storage.local.set({ [DIAGNOSTIC_RUNS_STORAGE_KEY]: limitedRuns });
    } catch (error) {
        const compactRuns = limitedRuns.slice(0, 3).map((run) => ({
            ...run,
            events: (run.events || []).slice(-80)
        }));
        await chrome.storage.local.set({ [DIAGNOSTIC_RUNS_STORAGE_KEY]: compactRuns });
    }
}

function eventFingerprint(event) {
    if (event?.id) {
        return `id:${event.id}`;
    }
    try {
        return JSON.stringify([event?.time || '', event?.event || '', event?.details || null]);
    } catch (error) {
        return `${event?.time || ''}:${event?.event || ''}`;
    }
}

function mergeEvents(existingEvents = [], incomingEvents = []) {
    const byFingerprint = new Map();
    for (const rawEvent of [...existingEvents, ...incomingEvents]) {
        const event = sanitizeDiagnosticValue(rawEvent);
        if (event && typeof event === 'object') {
            byFingerprint.set(eventFingerprint(event), event);
        }
    }

    return Array.from(byFingerprint.values())
        .sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')))
        .slice(-MAX_DIAGNOSTIC_EVENTS);
}

function mergeStatus(existingStatus, incomingStatus) {
    if (existingStatus === 'success' || incomingStatus === 'success') {
        return 'success';
    }
    if (existingStatus === 'partial' || incomingStatus === 'partial') {
        return 'partial';
    }
    if (incomingStatus && incomingStatus !== 'running') {
        return incomingStatus;
    }
    return existingStatus || incomingStatus || 'running';
}

function mergeRun(existingRun, incomingRun) {
    const existing = existingRun && typeof existingRun === 'object' ? existingRun : {};
    const incoming = sanitizeDiagnosticValue(incomingRun) || {};
    const status = mergeStatus(existing.status, incoming.status);

    return {
        ...existing,
        ...incoming,
        id: incoming.id || existing.id,
        status,
        completedAt: status === 'running'
            ? null
            : (incoming.completedAt || existing.completedAt || new Date().toISOString()),
        events: mergeEvents(existing.events, incoming.events),
        summary: {
            ...(existing.summary && typeof existing.summary === 'object' ? existing.summary : {}),
            ...(incoming.summary && typeof incoming.summary === 'object' ? incoming.summary : {})
        }
    };
}

function finalizeStaleRuns(runs, excludedRunId = '') {
    const now = Date.now();
    const completedAt = new Date(now).toISOString();
    return runs.map((run) => {
        const startedAtMs = Date.parse(run?.startedAt || '');
        if (run?.id === excludedRunId
            || run?.status !== 'running'
            || !Number.isFinite(startedAtMs)
            || now - startedAtMs < RUNNING_STALE_MS) {
            return run;
        }

        return {
            ...run,
            status: 'failed',
            completedAt,
            durationMs: Math.max(0, now - startedAtMs),
            summary: {
                ...(run.summary && typeof run.summary === 'object' ? run.summary : {}),
                reason: 'runner_timeout_or_popup_closed'
            },
            events: mergeEvents(run.events, [{
                time: completedAt,
                event: 'diagnostic:stale_run_recovered',
                details: { staleAfterMs: RUNNING_STALE_MS }
            }])
        };
    });
}

async function recoverStaleDiagnosticRuns(excludedRunId = '') {
    const runs = await getDiagnosticRuns();
    const recovered = finalizeStaleRuns(runs, excludedRunId);
    if (recovered.some((run, index) => run !== runs[index])) {
        await saveDiagnosticRuns(recovered);
    }
    return recovered;
}

async function upsertDiagnosticRun(incomingRun) {
    if (!incomingRun?.id) {
        return null;
    }

    const runs = await recoverStaleDiagnosticRuns(incomingRun.id);
    const existing = runs.find((run) => run.id === incomingRun.id) || null;
    const merged = mergeRun(existing, incomingRun);
    const nextRuns = [merged, ...runs.filter((run) => run.id !== merged.id)]
        .sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))
        .slice(0, MAX_DIAGNOSTIC_RUNS);
    await saveDiagnosticRuns(nextRuns);
    return merged;
}

async function appendDiagnosticEvent(message, sender) {
    const runs = await getDiagnosticRuns();
    const existing = runs.find((run) => run.id === message.runId) || {
        schemaVersion: 1,
        id: message.runId,
        extensionVersion: message.extensionVersion || '',
        startedAt: message.time || new Date().toISOString(),
        completedAt: null,
        durationMs: null,
        status: 'running',
        events: []
    };
    const details = {
        ...(message.details && typeof message.details === 'object' ? message.details : {}),
        tabId: sender?.tab?.id ?? undefined,
        frameId: sender?.frameId ?? undefined
    };
    const incoming = {
        ...existing,
        events: [...(existing.events || []), {
            id: message.id || undefined,
            time: message.time || new Date().toISOString(),
            event: String(message.event || 'page:diagnostic_event'),
            details
        }]
    };
    return upsertDiagnosticRun(incoming);
}

async function completePageRun(message, sender) {
    const completedAt = message.time || new Date().toISOString();
    const runs = await getDiagnosticRuns();
    const existing = runs.find((run) => run.id === message.runId) || {
        schemaVersion: 1,
        id: message.runId,
        extensionVersion: message.extensionVersion || '',
        startedAt: completedAt,
        events: []
    };
    const incomingStatus = ['success', 'partial', 'failed'].includes(message.status)
        ? message.status
        : 'failed';
    const incoming = {
        ...existing,
        status: incomingStatus,
        completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(existing.startedAt || completedAt)),
        summary: {
            ...(message.summary && typeof message.summary === 'object' ? message.summary : {}),
            completedBy: 'page_bridge',
            tabId: sender?.tab?.id ?? undefined,
            frameId: sender?.frameId ?? undefined
        },
        events: [...(existing.events || []), {
            time: completedAt,
            event: 'page:run_finished',
            details: {
                status: incomingStatus,
                tabId: sender?.tab?.id ?? undefined,
                frameId: sender?.frameId ?? undefined
            }
        }]
    };
    return upsertDiagnosticRun(incoming);
}

function probeScheduleResumeState() {
    const scheduleForms = Array.from(document.querySelectorAll('.form-schedule'))
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
    return {
        scheduleFormCount: scheduleForms.length,
        runnerActive: !!globalThis.__FillBARS_ACTIVE_RUN_V1__?.promise
    };
}

function invokeFillBARSScheduleResume(profileName, assignmentSettings, filledCount, diagnosticRunId, diagnosticBridgeToken) {
    const runner = globalThis.__FillBARS_RUNNER__;
    if (!runner || typeof runner.run !== 'function') {
        return {
            resumed: false,
            reason: 'runner_missing'
        };
    }

    const lockSlot = '__FillBARS_ACTIVE_RUN_V1__';
    if (globalThis[lockSlot]?.promise) {
        return {
            resumed: false,
            reason: 'runner_active'
        };
    }

    const resumeSettings = {
        ...(assignmentSettings && typeof assignmentSettings === 'object' ? assignmentSettings : {}),
        assignmentStage: 'schedule',
        resumeScheduleOnly: true,
        resumeFilledCount: Number(filledCount) || 0
    };
    const promise = Promise.resolve().then(() => runner.run(
        {},
        profileName || 'Продолжение расписания',
        resumeSettings,
        diagnosticRunId,
        diagnosticBridgeToken
    ));
    globalThis[lockSlot] = { runId: diagnosticRunId, promise, resumedSchedule: true };
    return promise.finally(() => {
        if (globalThis[lockSlot]?.promise === promise) {
            delete globalThis[lockSlot];
        }
    });
}

function executeScript(options) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(options, (results) => {
            const error = chrome.runtime.lastError?.message;
            if (error) {
                reject(new Error(error));
                return;
            }
            resolve(results || []);
        });
    });
}

async function resumeScheduleRun(message, sender) {
    const tabId = sender?.tab?.id;
    const frameId = sender?.frameId;
    const continuation = message?.continuation;
    const assignmentSettings = continuation?.assignmentSettings;
    const targetCabinet = String(assignmentSettings?.targetCabinet || '').trim();
    const validRequest = Number.isInteger(tabId)
        && Number.isInteger(frameId)
        && typeof message?.runId === 'string'
        && message.runId.length > 0
        && typeof message?.token === 'string'
        && message.token.length >= 16
        && assignmentSettings?.assignmentStage === 'schedule'
        && targetCabinet.length > 0;
    if (!validRequest) {
        return { resumed: false, reason: 'invalid_schedule_resume_request' };
    }

    const target = { tabId, frameIds: [frameId] };
    const probeResults = await executeScript({
        target,
        world: 'MAIN',
        func: probeScheduleResumeState
    });
    const probe = probeResults[0]?.result || {};
    if (probe.scheduleFormCount < 1) {
        return { resumed: false, reason: 'schedule_form_not_found' };
    }
    if (probe.runnerActive) {
        return { resumed: false, reason: 'runner_active' };
    }

    await appendDiagnosticEvent({
        runId: message.runId,
        extensionVersion: message.extensionVersion || '',
        time: new Date().toISOString(),
        event: 'background:schedule_resume_started',
        details: {
            scheduleFormCount: probe.scheduleFormCount
        }
    }, sender);

    await executeScript({
        target,
        world: 'MAIN',
        files: ['bars-adapter.js', 'fill-runner.js']
    });
    const resumeResults = await executeScript({
        target,
        world: 'MAIN',
        func: invokeFillBARSScheduleResume,
        args: [
            String(continuation.profileName || ''),
            assignmentSettings,
            Number(continuation.filledCount) || 0,
            message.runId,
            message.token
        ]
    });
    const result = resumeResults[0]?.result || null;
    return {
        resumed: result?.resumed !== false,
        reason: result?.reason || 'schedule_resume_finished'
    };
}

async function handleDiagnosticMessage(message, sender) {
    switch (message.action) {
        case 'upsert':
            return { run: await upsertDiagnosticRun(message.run) };
        case 'append':
            return { run: await appendDiagnosticEvent(message, sender) };
        case 'page_complete':
            return { run: await completePageRun(message, sender) };
        case 'resume_schedule':
            return await resumeScheduleRun(message, sender);
        case 'get_runs':
            return { runs: await recoverStaleDiagnosticRuns() };
        case 'clear':
            await chrome.storage.local.remove(DIAGNOSTIC_RUNS_STORAGE_KEY);
            return { cleared: true };
        default:
            throw new Error('unknown_diagnostic_action');
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.namespace !== DIAGNOSTIC_MESSAGE_NAMESPACE) {
        return false;
    }

    diagnosticOperationQueue = diagnosticOperationQueue
        .catch(() => undefined)
        .then(() => handleDiagnosticMessage(message, sender));
    diagnosticOperationQueue.then(
        (result) => sendResponse({ ok: true, ...result }),
        () => sendResponse({ ok: false, error: 'diagnostic_storage_failed' })
    );
    return true;
});

chrome.runtime.onStartup.addListener(() => {
    diagnosticOperationQueue = diagnosticOperationQueue
        .catch(() => undefined)
        .then(() => recoverStaleDiagnosticRuns());
});

importScripts('diary-core.js', 'diary-background.js', 'diary-window.js');
