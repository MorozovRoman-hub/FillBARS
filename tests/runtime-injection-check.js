const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const manifest = JSON.parse(read('manifest.json'));
const popup = read('popup.js');
const background = read('background.js');
const adapter = read('bars-adapter.js');
const runner = read('fill-runner.js');
const version = manifest.version;

assert(version === '5.1.10', `unexpected manifest version: ${version}`);
assert(popup.includes(`const EXTENSION_VERSION = '${version}'`), 'popup version is not synchronized');
assert(popup.includes('loadedManifestVersion !== EXTENSION_VERSION')
    && popup.includes('Загружена смешанная версия')
    && popup.includes('fillButton.disabled = true'),
    'popup does not fail closed when Yandex keeps a stale extension manifest');
assert(adapter.includes(`const VERSION = '${version}'`), 'adapter version is not synchronized');
assert(runner.includes(`const VERSION = '${version}'`), 'runner version is not synchronized');
assert(runner.includes(`Версия: ${version}`), 'runner console banner is not synchronized');

assert(popup.includes("files: ['fill-runner.js']"), 'runner is not injected as a file');
assert(!/func\s*:\s*fillForm\b/.test(popup), 'large fillForm is still serialized through executeScript');
assert(popup.includes('func: invokeFillBARSRunner'), 'small runner entrypoint is missing');
assert(popup.includes('const executionTarget = { tabId: tabs[0].id, frameIds: [targetFrame.frameId] };'),
    'mutating runner is not pinned to one selected BARS frame');
assert(!popup.includes('allFrames: !targetFrame'),
    'mutating allFrames fallback is still present');
assert(popup.includes('`__fillbarsDiagnosticBridgeV1_${bridgeToken}`'),
    'diagnostic bridge is not isolated per runner token');
assert(popup.includes("const lockSlot = '__FillBARS_ACTIVE_RUN_V1__'"),
    'per-frame runner lock is missing');
assert(popup.includes("data.event === 'assign_button:click'")
    && popup.includes("event: 'bridge:schedule_detected'")
    && popup.includes("event: 'bridge:schedule_transition_timeout'")
    && popup.includes("'bridge:schedule_resume_result'")
    && popup.includes("event: trigger === 'detected'")
    && popup.includes("'bridge:schedule_watchdog_result'")
    && popup.includes("requestScheduleResume('watchdog')")
    && popup.includes('pageCompleted || resumeRequestInFlight')
    && popup.includes('clearInterval(scheduleWatchdogTimer)')
    && popup.includes("action: 'resume_schedule'"),
    'isolated bridge does not watchdog and resume a destroyed MAIN schedule context');
assert(background.includes('function probeScheduleResumeState()')
    && background.includes("files: ['bars-adapter.js', 'fill-runner.js']")
    && background.includes("reason: 'runner_active'")
    && background.includes('resumeScheduleOnly: true')
    && background.includes("case 'resume_schedule':"),
    'service worker does not safely resume a destroyed MAIN schedule context');
assert(runner.includes('if (resumeScheduleOnly)')
    && runner.includes('prepareScheduleForAssignment({ scheduleAlreadyOpen: true })')
    && runner.includes("debugLog('schedule_resume:start'")
    && runner.includes("method: 'schedule_resume'"),
    'runner does not provide a schedule-only continuation without a second Assign click');
assert(runner.includes('globalScope.__FillBARS_RUNNER__'), 'runner does not publish its page entrypoint');
assert(runner.length > 100000, 'runner fixture no longer represents the large production payload');

assert(runner.includes('[name="byNaprAnalyseLab"]'), 'source laboratory button is missing');
assert(runner.includes('[name="linkDirLineOrder"]'), 'visit sidebar laboratory link is missing');
assert(runner.includes('[onclick*=".openDirLineOrder"]'), 'disease-case laboratory link is missing');

const urgentStopIndex = runner.indexOf("debugLog('fill:blocked_before_research_selection_for_urgent'");
const urgentReturnIndex = runner.indexOf('return attachDiagnostics({', urgentStopIndex);
const researchSelectionIndex = runner.indexOf('// Проверяем количество чек-боксов', urgentStopIndex);
const assignClickIndex = runner.indexOf('scheduleOpened = await clickAssignButton()');
assert(urgentStopIndex >= 0
    && urgentReturnIndex > urgentStopIndex
    && researchSelectionIndex > urgentReturnIndex
    && assignClickIndex >= 0
    && runner.includes('исследования не изменялись, кнопка «Назначить» не нажималась'),
    'urgent mode is not stopped before research mutation and the server-side Assign action');
assert(!runner.includes('setUrgentCheckboxesInSchedule'),
    'obsolete schedule-level urgent mutation is still present');
assert(runner.includes("method: 'exact_dom_source_fallback'"),
    'real BARS fallback for an unavailable Form namespace is missing');
assert(runner.includes('runtimeFirstTimeWasObservedTrue = runtimeBeforeWait.isFirstTime === true')
    && runner.includes('|| state.isFirstTime === true')
    && runner.includes('&& !runtimeFirstTimeWasObservedTrue'),
    'degraded runtime path does not preserve an observed isFirstTime=true guard');
const degradedRuntimeIndex = runner.indexOf("method: 'exact_dom_source_fallback'");
const allResearchRequestIndex = runner.indexOf(
    'const request = barsAdapter.requestAllResearches(form);',
    degradedRuntimeIndex
);
assert(runner.includes('currentForm === form')
    && runner.includes('currentAllRow?.isConnected')
    && allResearchRequestIndex > degradedRuntimeIndex,
    'degraded runtime path is not pinned to the exact live form before the ALL_RES request');
assert(adapter.includes("engine.execScript('return Form', [])")
    && adapter.includes("runtimeKind: engine && engine === page?.d3Form ? 'd3' : 'legacy'")
    && adapter.includes("method: 'd3_activate_row_force'")
    && adapter.includes('windowRef.D3Api.GridCtrl.activateRow(row, true)'),
    'real page.d3Form runtime or single force-onchange activation is missing');
assert(runner.includes("reason: 'order_form_replaced_during_initialization'")
    && runner.includes('const stableAfterOpenAll = openAllResult.confirmed === true')
    && runner.includes("lastAttempt?.openAllResult?.reason || 'research_rows_not_loaded'"),
    'runner does not reject stale forms, delays failed retries, or masks the inner reason');
assert(adapter.includes("reason: 'picker_rows_not_loaded'")
    && adapter.includes("reason: 'picker_closed'")
    && adapter.includes("reason: 'picker_replaced'")
    && adapter.includes("'picker_rows_rendering'")
    && adapter.includes('const waitForCabinetPickerSelection = async')
    && adapter.includes('rowCount,')
    && adapter.includes('dataSetRowCount,')
    && adapter.includes('windowRef.setTimeout(resolve, Math.min(intervalMs, remainingMs))'),
    'cabinet adapter does not wait for the asynchronous available_cablabs DS/Grid1 load');
assert(adapter.includes('windowRef.setThisActivRow(entry.row, true)')
    && adapter.includes('context.namespace.OnOkButtonClick()'),
    'cabinet selection is not using the source-backed Grid1 activation and Form.OnOkButtonClick chain');
assert(runner.includes("typeof barsAdapter?.waitForCabinetPickerSelection === 'function'")
    && runner.includes('{ timeoutMs: 5000, intervalMs: 200 }')
    && runner.includes('if (confirmResult?.terminal === true)')
    && runner.includes("reason: 'adapter_confirm_error'")
    && runner.includes('cancelCabinetWindowAfterFailure'),
    'runner does not prefer the bounded source-backed picker readiness wait or stop on an exact terminal failure');
assert(runner.includes('const isExpectedCabinetValue = (state, expectedCabinet = null)')
    && runner.includes('return value === expectedId;')
    && runner.includes('normalizeText(caption) === expectedCaption')
    && !runner.includes('&& hasCabinetLabel(normalizeText(state.caption));'),
    'schedule verification is not pinned to the exact source-selected cabinet ID/caption');
assert(adapter.includes("typeof windowRef.D3Api?.ButtonEditCtrl?.getValue === 'function' && ctrlCABLAB")
    && adapter.includes('windowRef.D3Api.ButtonEditCtrl.getValue(ctrlCABLAB)')
    && adapter.includes("typeof windowRef.D3Api?.ButtonEditCtrl?.getCaption === 'function' && ctrlCABLAB")
    && adapter.includes('windowRef.D3Api.ButtonEditCtrl.getCaption(ctrlCABLAB)')
    && adapter.includes("typeof windowRef.getControlValue === 'function' && ctrlCABLAB")
    && adapter.includes('windowRef.getControlValue(ctrlCABLAB)')
    && adapter.includes("typeof windowRef.getControlCaption === 'function' && ctrlCABLAB")
    && adapter.includes('windowRef.getControlCaption(ctrlCABLAB)'),
    'schedule state does not prefer the D3 ButtonEdit key/caption API for the exact clone control');
assert(runner.includes('sawTargetWhilePending')
    && runner.includes("'cabinet_cleared_after_recalculation'")
    && runner.includes("'cabinet_not_applied_after_recalculation'")
    && runner.includes("debugLog('cabinet_choose:final_count_reconciled'")
    && runner.includes('selected = verifiedAtFinish;'),
    'cabinet verification does not preserve recalculation transitions in diagnostics');

console.log(`PASS runtime injection — popup=${popup.length}, runner=${runner.length}, version=${version}`);
