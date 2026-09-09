"""Build a Chrome Web Store ZIP and verify every local HTML/CSS asset."""
import argparse
import hashlib
import json
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = '''manifest.json background.js badger.png bars-adapter.js
blood-request.css blood-request.html blood-request.js diaries.css diaries.html diaries.js
diary-background.js diary-bars-adapter.js diary-core.js diary-icons.svg diary-launch.js diary-window.js
drug-catalog-zhvnlp-2025.json fill-runner.js fillbars-config.json office-export.js office-templates.js
popup.html popup.js print.css print.html print.js transfusion.css transfusion.html transfusion.js LICENSE'''.split()


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = []

    def handle_starttag(self, tag, attrs):
        self.values.extend(value for key, value in attrs if key in ('src', 'href') and value)


def validate(files):
    manifest = json.loads(files['manifest.json'])
    refs = set(manifest.get('icons', {}).values())
    refs.update(manifest['action']['default_icon'].values())
    refs.update((manifest['background']['service_worker'], manifest['action']['default_popup']))
    for ref in refs:
        assert ref in files, f'Missing exact manifest asset: {ref}'
    for name, data in files.items():
        if not name.endswith(('.html', '.css')):
            continue
        text = data.decode('utf-8')
        values = []
        if name.endswith('.html'):
            parser = References()
            parser.feed(text)
            values.extend(parser.values)
        values.extend(value.strip().strip('\"\'') for value in re.findall(r'url\(\s*([^)]*?)\s*\)', text))
        for value in values:
            ref = urlsplit(value)
            if ref.scheme or ref.netloc or not ref.path:
                continue
            asset = (Path(name).parent / unquote(ref.path)).as_posix().removeprefix('./')
            assert asset in files, f'{name}: missing local asset {asset}'
    assert 'card-preview-host.js' not in files['diaries.js'].decode('utf-8')


def build(destination):
    files = {name: (ROOT / name).read_bytes() for name in RUNTIME_FILES}
    for directory in ('images', 'icons'):
        for p in (ROOT / directory).rglob('*'):
            if p.is_file():
                files[p.relative_to(ROOT).as_posix()] = p.read_bytes()
    # The preview host is test-only. All other runtime bytes come from the checkout.
    script = files['diaries.js'].decode('utf-8')
    preview = "    if (params.has('preview') && ['127.0.0.1', 'localhost'].includes(location.hostname)) await import('./tests/card-preview-host.js');"
    assert script.count(preview) == 1, 'Preview bootstrap changed; review packaging'
    files['diaries.js'] = script.replace(preview, '').encode('utf-8')
    manifest = json.loads(files['manifest.json'])
    # Match the icon already used by the extension action if no standalone icon is configured.
    if not manifest.get('icons'):
        manifest['icons'] = {'128': manifest['action']['default_icon']['128']}
        files['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    validate(files)
    destination = Path(destination).resolve()
    with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            archive.writestr(name, data)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        unpacked = {name: archive.read(name) for name in archive.namelist()}
        assert unpacked == files
        validate(unpacked)
    print(json.dumps({'archive': str(destination), 'version': manifest['version'], 'files': len(files),
                      'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path, help='New ZIP path (existing files are not overwritten)')
    build(parser.parse_args().destination)
