(() => {
    'use strict';
    if (globalThis.FillBARSPatientMetricsBridge) return;
    globalThis.FillBARSPatientMetricsBridge = true;

    const key = `fillbars-patient-metrics:${location.protocol}//${location.hostname}/*`;
    const historyKey = `fillbars-history-metrics:${location.protocol}//${location.hostname}/*`;
    const repeatKey = `fillbars-lab-repeat:${location.protocol}//${location.hostname}/*`;
    const daysKey = `fillbars-lab-repeat-days:${location.protocol}//${location.hostname}/*`;
    let pending = Promise.resolve();

    function apply() {
        pending = pending.catch(() => {}).then(async () => {
            await chrome.runtime.sendMessage({ type: 'fillbars-patient-metrics' });
        }).catch(() => {});
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && [key, historyKey, repeatKey, daysKey].some(key => Object.hasOwn(changes, key))) apply();
    });
    apply();
})();
