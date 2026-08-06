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
const popupHtml = read('popup.html');
const background = read('background.js');
const adapter = read('bars-adapter.js');
const runner = read('fill-runner.js');
const printHtml = read('print.html');
const transfusionHtml = read('transfusion.html');
const transfusionJs = read('transfusion.js');
const officeTemplatesJs = read('office-templates.js');
const officeExportJs = read('office-export.js');
const bloodRequestHtml = read('blood-request.html');
const bloodRequestJs = read('blood-request.js');
const version = manifest.version;

assert(version === '5.1.14', `unexpected manifest version: ${version}`);
assert(popup.includes(`const EXTENSION_VERSION = '${version}'`), 'popup version is not synchronized');
assert(popup.includes('loadedManifestVersion !== EXTENSION_VERSION')
    && popup.includes('Загружена смешанная версия')
    && popup.includes('fillButton.disabled = true'),
    'popup does not fail closed when Yandex keeps a stale extension manifest');
assert(adapter.includes(`const VERSION = '${version}'`), 'adapter version is not synchronized');
assert(runner.includes(`const VERSION = '${version}'`), 'runner version is not synchronized');
assert(runner.includes(`Версия: ${version}`), 'runner console banner is not synchronized');
assert(popup.includes("document.querySelectorAll('.hosp_history_new')")
    && popup.includes("world: 'MAIN'")
    && popup.includes("historyPage?.getCaption")
    && popup.includes("getHistoryCaption('PAT_FIO')")
    && popup.includes("getHistoryCaption('PAT_BDATE')")
    && popup.includes("getHistoryCaption('HH_PREF_NUMB')"),
    'patient print data is not read from the exact hosp_history_new source controls');
assert(printHtml.includes('id="patientHistoryNumber"')
    && popup.includes('historyNumber: sanitizePatientHistoryNumber'),
    'assignment sheet does not receive the hospital history number');
const historySanitizerStart = popup.indexOf('function sanitizePatientHistoryNumber');
const historySanitizerEnd = popup.indexOf('\nfunction scorePulledPatientData', historySanitizerStart);
const historySanitizerSource = popup.slice(historySanitizerStart, historySanitizerEnd);
const sanitizePatientHistoryNumber = Function(`${historySanitizerSource}; return sanitizePatientHistoryNumber;`)();
assert(sanitizePatientHistoryNumber('ХО2 Амурск_1340014-70784/00765') === '1340014-70784/00765'
    && sanitizePatientHistoryNumber('ИБ: ХО2 Амурск_1340014-70784/00765') === '1340014-70784/00765',
    'hospital history number keeps the ХО2 Амурск_ service prefix');
const departmentSanitizerStart = popup.indexOf('function sanitizePatientDepartment');
const departmentSanitizerEnd = popup.indexOf('\nfunction scorePulledPatientData', departmentSanitizerStart);
const departmentSanitizerSource = popup.slice(departmentSanitizerStart, departmentSanitizerEnd);
const sanitizePatientDepartment = Function(`${departmentSanitizerSource}; return sanitizePatientDepartment;`)();
assert(sanitizePatientDepartment('ХО2 Амурск_') === 'ХО2 Амурск'
    && popup.includes("extractDepartmentFromHistoryNumber(getHistoryCaption('HH_PREF_NUMB'))")
    && popup.includes('department: sanitizePatientDepartment(patientData.department)')
    && transfusionJs.includes("setValue('department', patient.department)")
    && bloodRequestJs.includes("setValue('department', patient.department)"),
    'department is not derived from HH_PREF_NUMB for both transfusion documents');
const doctorFormatterStart = popup.indexOf('function formatDoctorName');
const doctorFormatterEnd = popup.indexOf('\nfunction scorePulledPatientData', doctorFormatterStart);
const doctorFormatterSource = popup.slice(doctorFormatterStart, doctorFormatterEnd);
const formatDoctorName = Function(`${doctorFormatterSource}; return formatDoctorName;`)();
assert(formatDoctorName('Морозов Роман Владимирович') === 'Морозов Р.В.'
    && formatDoctorName('МОРОЗОВ РОМАН ВЛАДИМИРОВИЧ (1234)') === 'Морозов Р.В.'
    && formatDoctorName('Морозов Р.В.') === 'Морозов Р.В.',
    'current BARS doctor is not normalized to Фамилия И.О.');
assert(popup.includes("document.querySelectorAll('#Profile .info > section')")
    && popup.includes("document.querySelectorAll('#sys_user_data tr')")
    && popup.includes("row.querySelectorAll('.td_name')")
    && popup.includes("legacyRow?.querySelector('.td_user')")
    && !popup.includes(".td_name, td:first-child")
    && popup.includes("getUserEnvironmentValue('ЛПУ')")
    && popup.includes("getUserEnvironmentValue('Пользователь')")
    && popup.includes("getVar('EMP_NAME')")
    && popup.includes("getVar('LPU_NAME')")
    && popup.includes('medicalOrganization: sanitizeMedicalOrganization(patientData.medicalOrganization)')
    && popup.includes('doctorName: formatDoctorName(patientData.doctorName)'),
    'BARS profile organization/doctor sources are not connected to the print payload');
assert(popup.includes('openTransfusionProtocol')
    && popup.includes('transfusion.html?payload=')
    && transfusionHtml.includes('ПРОТОКОЛ ТРАНСФУЗИИ')
    && transfusionHtml.includes('id="recipientAbo"')
    && transfusionHtml.includes('id="recipientRh"')
    && transfusionHtml.includes('id="indication"')
    && transfusionHtml.includes('id="componentName"')
    && transfusionHtml.includes('id="componentUnitNumber"')
    && transfusionHtml.includes('id="componentVolume"')
    && transfusionHtml.includes('Восполнение объема циркулирующих эритроцитов')
    && transfusionHtml.includes('Восполнение факторов свертывания крови')
    && !transfusionHtml.includes('indicationDetails')
    && !transfusionHtml.includes('Уточнение показания')
    && transfusionJs.includes("beforeBp: '110/70'")
    && transfusionJs.includes("afterTwoHoursDiuresis: 'Свжел'")
    && transfusionJs.includes('syncRecipientBloodGroup')
    && transfusionJs.includes("setValue('selectionOrganization', patient.medicalOrganization)")
    && transfusionJs.includes("setValue('transfusionDoctor', patient.doctorName)")
    && transfusionHtml.includes('id="exportWordButton"')
    && transfusionHtml.includes('id="exportExcelButton"')
    && transfusionHtml.includes('office-templates.js?v=5.1.14')
    && transfusionHtml.includes('office-export.js?v=5.1.14')
    && transfusionJs.includes('buildExportValues')
    && transfusionJs.includes('downloadDocx')
    && transfusionJs.includes('downloadXlsx')
    && officeTemplatesJs.includes('__FillBARSOfficeTemplates__')
    && officeExportJs.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    && officeExportJs.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    && transfusionJs.includes('globalScope.__FillBARSTransfusionProtocol__'),
    'interactive transfusion protocol contract is incomplete');
const documentActionSplitStart = popupHtml.indexOf('class="document-action-split"');
const documentActionSplitEnd = popupHtml.indexOf('</div>', documentActionSplitStart);
const printSheetButton = popupHtml.indexOf('id="openPrintSheet"', documentActionSplitStart);
const bloodRequestButton = popupHtml.indexOf('id="openBloodRequest"', documentActionSplitStart);
const transfusionProtocolButton = popupHtml.indexOf('id="openTransfusionProtocol"', documentActionSplitStart);
assert(documentActionSplitStart >= 0
    && documentActionSplitEnd > documentActionSplitStart
    && printSheetButton > documentActionSplitStart
    && bloodRequestButton > printSheetButton
    && transfusionProtocolButton > bloodRequestButton
    && transfusionProtocolButton < documentActionSplitEnd
    && popup.includes('openBloodRequest')
    && popup.includes('blood-request.html?payload=')
    && bloodRequestHtml.includes('ЗАЯВКА НА КОМПОНЕНТЫ КРОВИ')
    && bloodRequestHtml.includes('(оборотная сторона)')
    && bloodRequestHtml.includes('id="patientFullName"')
    && bloodRequestHtml.includes('id="patientHistoryNumber"')
    && bloodRequestHtml.includes('id="patientBirthDate"')
    && bloodRequestHtml.includes('id="releasedBloodGroup1"')
    && bloodRequestHtml.includes('id="requestDoctor"')
    && bloodRequestJs.includes("setValue('requestDoctor', patient.doctorName)")
    && bloodRequestJs.includes('calculateAge')
    && bloodRequestJs.includes('syncReleasedBloodGroup')
    && bloodRequestJs.includes('globalScope.__FillBARSBloodRequest__'),
    'interactive blood request contract is incomplete');

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
    && runner.includes('scheduleAlreadyOpen: true,')
    && runner.includes('urgentResult: resumedUrgentResult')
    && runner.includes("debugLog('schedule_resume:start'")
    && runner.includes("method: 'schedule_resume'"),
    'runner does not provide a schedule-only continuation without a second Assign click');
assert(runner.includes('globalScope.__FillBARS_RUNNER__'), 'runner does not publish its page entrypoint');
assert(runner.length > 100000, 'runner fixture no longer represents the large production payload');

assert(runner.includes('[name="byNaprAnalyseLab"]'), 'source laboratory button is missing');
assert(runner.includes('[name="linkDirLineOrder"]'), 'visit sidebar laboratory link is missing');
assert(runner.includes('[onclick*=".openDirLineOrder"]'), 'disease-case laboratory link is missing');

const researchSelectionIndex = runner.indexOf('// Проверяем количество чек-боксов');
const urgentApplyIndex = runner.indexOf('const urgentResult = shouldMarkUrgent', researchSelectionIndex);
const urgentBlockIndex = runner.indexOf("debugLog('fill:blocked_before_assign_for_urgent'", urgentApplyIndex);
const scheduleCallIndex = runner.indexOf('scheduleResult = await prepareScheduleForAssignment({ urgentResult });', urgentApplyIndex);
assert(researchSelectionIndex >= 0
    && urgentApplyIndex > researchSelectionIndex
    && urgentBlockIndex > urgentApplyIndex
    && scheduleCallIndex > urgentBlockIndex
    && runner.includes("debugLog('urgent:apply_start'")
    && runner.includes("debugLog('urgent:item_result'")
    && runner.includes("debugLog('urgent:apply_complete'")
    && runner.includes('выполнение остановлено до кнопки «Назначить»'),
    'CITO is not applied and verified in GridDirline before the server-side Assign action');
assert(!runner.includes('fill:blocked_before_research_selection_for_urgent')
    && !runner.includes('urgent_requires_research_order'),
    'obsolete fail-closed CITO placeholder is still present');
assert(!runner.includes('setUrgentCheckboxesInSchedule'),
    'obsolete schedule-level urgent mutation is still present');
assert(adapter.includes("const CITO_CONTROL_SELECTOR = '[name=\"Cito\"]'")
    && adapter.includes('const getDirlineCitoEntries =')
    && adapter.includes('const requestDirlineCito =')
    && adapter.includes('windowRef.D3Api.CheckBoxCtrl.getValue(control)')
    && adapter.includes('runInFormContext(entry.row, () => target.click())')
    && adapter.includes('windowRef.D3Api.CheckBoxCtrl.setChecked(entry.control, desired)')
    && adapter.includes("reason: confirmed")
    && adapter.includes("'cito_not_confirmed'"),
    'adapter does not use and verify the source-backed GridDirline CITO controls');
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
