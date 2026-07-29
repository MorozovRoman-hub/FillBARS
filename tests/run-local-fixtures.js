const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const fixtureNames = [
    'dform-runtime-fixture.html',
    'research-order-fixture.html',
    'schedule-fixture.html'
];
const browserCandidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

if (!executablePath) {
    throw new Error('Chrome/Edge executable was not found; set CHROME_PATH');
}

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fillbars-fixtures-'));

try {
    for (const fixtureName of fixtureNames) {
        const fixtureUrl = pathToFileURL(path.join(__dirname, fixtureName)).href;
        const result = spawnSync(executablePath, [
            '--headless=new',
            '--disable-gpu',
            '--disable-gpu-compositing',
            '--disable-software-rasterizer',
            '--disable-features=Vulkan,Dawn',
            '--no-first-run',
            '--no-default-browser-check',
            '--allow-file-access-from-files',
            '--virtual-time-budget=30000',
            '--dump-dom',
            `--user-data-dir=${profileDir}`,
            fixtureUrl
        ], {
            encoding: 'utf8',
            timeout: 45000,
            windowsHide: true
        });
        const html = result.stdout || '';
        const passed = /<body[^>]*data-test-status="passed"/i.test(html);
        const status = html.match(/<[^>]+id="status"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1]
            .replace(/<[^>]+>/g, '')
            .trim() || '';

        if (result.error || result.status !== 0 || !passed) {
            throw new Error([
                `${fixtureName}: ${status || 'fixture failed'}`,
                result.error?.stack || '',
                result.stderr || '',
                html.slice(-6000)
            ].filter(Boolean).join('\n'));
        }

        console.log(`${fixtureName}: ${status}`);
    }
} finally {
    const resolvedProfile = path.resolve(profileDir);
    const resolvedTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (resolvedProfile.startsWith(resolvedTemp)) {
        fs.rmSync(resolvedProfile, { recursive: true, force: true });
    }
}
