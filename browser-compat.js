(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.FillBARSBrowserCompat = api;
    if (root?.document) void api.init({ chromeApi: root.chrome, navigatorApi: root.navigator, documentApi: root.document });
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const ACKNOWLEDGED_KEY = 'fillbarsChrome109WarningAcknowledged';
    const LEGACY_SESSION_QUOTA_BYTES = 1024 * 1024;

    function chromeMajor(userAgent) {
        const match = /(?:Chrome|Chromium)\/(\d+)/.exec(String(userAgent || ''));
        return match ? Number(match[1]) : null;
    }

    function needsWarning(chromeApi, navigatorApi) {
        const reportedQuota = Number(chromeApi?.storage?.session?.QUOTA_BYTES);
        if (Number.isFinite(reportedQuota) && reportedQuota > 0) return reportedQuota <= LEGACY_SESSION_QUOTA_BYTES;
        const major = chromeMajor(navigatorApi?.userAgent);
        return major !== null && major >= 109 && major < 112;
    }

    async function init({ chromeApi, navigatorApi, documentApi } = {}) {
        const warning = documentApi?.getElementById('browserCompatWarning');
        const dismiss = documentApi?.getElementById('dismissBrowserCompatWarning');
        const local = chromeApi?.storage?.local;
        if (!warning || !dismiss || !local || !needsWarning(chromeApi, navigatorApi)) return false;
        try {
            const stored = await local.get(ACKNOWLEDGED_KEY);
            if (stored?.[ACKNOWLEDGED_KEY]) return false;
        } catch (_) {
            // A storage read failure must not conceal the compatibility notice.
        }
        warning.hidden = false;
        dismiss.addEventListener('click', async () => {
            dismiss.disabled = true;
            try {
                await local.set({ [ACKNOWLEDGED_KEY]: true });
                warning.hidden = true;
            } catch (_) {
                dismiss.disabled = false;
                dismiss.textContent = 'Не удалось запомнить. Повторить';
            }
        }, { once: false });
        return true;
    }

    return { ACKNOWLEDGED_KEY, LEGACY_SESSION_QUOTA_BYTES, chromeMajor, needsWarning, init };
});
