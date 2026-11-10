(() => {
    'use strict';
    if (globalThis.FillBARSPatientMetricsBridge) return;
    globalThis.FillBARSPatientMetricsBridge = true;

    const key = `fillbars-patient-metrics:${location.protocol}//${location.hostname}/*`;
    let enabled = false;
    let pending = Promise.resolve();

    function apply(active) {
        if (enabled === active) return;
        enabled = active;
        pending = pending.catch(() => {}).then(async () => {
            if (enabled !== active) return;
            await chrome.runtime.sendMessage({ type: 'fillbars-patient-metrics', enabled: active });
        }).catch(() => {});
    }

    let changed = false;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !Object.hasOwn(changes, key)) return;
        changed = true;
        apply(changes[key].newValue === true);
    });
    chrome.storage.local.get(key).then(saved => {
        if (!changed) apply(saved[key] === true);
    }).catch(() => {});
})();
