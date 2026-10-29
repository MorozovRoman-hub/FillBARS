"""Package safe, source-derived Word HTML for browser preview and printing.

Input HTML is produced from the *blank* runtime DOCX templates with Word's
Filtered HTML export. It is only a build artifact: runtime does not use Word.
"""
import base64
import json
import mimetypes
import re
from pathlib import Path
from zipfile import ZipFile

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
REFS = ROOT / 'tests' / 'artifacts' / 'new-form-refs-518'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
SOURCE_FILES = {
    'operationConsent': 'consent-templates.js',
    'anesthesiaConsent': 'consent-templates.js',
    'colonoscopyConsent': 'extra-templates.js',
    'bronchoscopyConsent': 'extra-templates.js',
    'gastroscopyConsent': 'extra-templates.js',
    'thrombolysisConsent': 'extra-templates.js',
    'operationProtocol': 'extra-templates.js',
    'workInjury315': 'followup-templates.js',
    'workInjury316': 'followup-templates.js',
    'epidemicInvestigation': 'followup-templates.js',
}
PAGES = {
    'operationConsent': 2, 'anesthesiaConsent': 2,
    'colonoscopyConsent': 1, 'bronchoscopyConsent': 1,
    'gastroscopyConsent': 1, 'thrombolysisConsent': 2,
    'operationProtocol': 2, 'workInjury315': 1,
    'workInjury316': 1, 'epidemicInvestigation': 8,
}


def templates_for(script):
    value = (ROOT / script).read_text(encoding='utf-8')
    return json.loads(value[value.index('{'):value.rindex('}')+1])


def page_margins(template):
    part = next(entry for entry in template['entries'] if entry['name'] == 'word/document.xml')
    root = etree.fromstring(base64.b64decode(part['data']))
    section = root.xpath('//w:sectPr', namespaces=NS)[-1]
    margins = section.find('w:pgMar', NS)
    def mm(name): return round(int(margins.get('{'+NS['w']+'}'+name))*25.4/1440, 2)
    return {name:mm(name) for name in ['top','right','bottom','left']}


def embed_images(html, stem):
    pattern = re.compile(r'\bsrc=(?:"([^"]+)"|\'([^\']+)\')', re.I)
    def replacement(match):
        source = match.group(1) or match.group(2)
        path = (REFS / source.replace('/', '\\')).resolve()
        assert path.is_relative_to(REFS.resolve()) and path.is_file(), source
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        assert mime in ('image/png','image/gif','image/jpeg')
        return 'src="data:'+mime+';base64,'+base64.b64encode(path.read_bytes()).decode('ascii')+'"'
    return pattern.sub(replacement, html)


def clean_word_html(kind, template):
    path = REFS / f'blank-{kind}.html'
    html = path.read_bytes().decode('cp1251')
    assert not re.search(r'<script\b|\bon\w+\s*=', html, re.I), kind
    html = embed_images(html, f'blank-{kind}')
    html = re.sub(r'<a\b[^>]*>', '<span>', html, flags=re.I).replace('</a>', '</span>')
    if kind == 'epidemicInvestigation':
        # Word starts section 9 on the eighth page; Chromium otherwise pulls it
        # up behind the preceding table and silently shortens this long form.
        marker = html.find('9.&nbsp;Заключение')
        assert marker > 0
        table = html.rfind('<table', 0, marker)
        assert table > 0
        html = html[:table] + '<div style="break-before:page;page-break-before:always"></div>' + html[table:]
    references = re.findall(r'\b(?:src|href)\s*=\s*[\'\"]([^\'\"]+)[\'\"]', html, re.I)
    assert all(reference.startswith('data:') for reference in references), (kind, references)
    html = re.sub(r'charset=windows-1251', 'charset=utf-8', html, flags=re.I)
    fields = set(template['fields'])
    seen = set(re.findall(r'\{\{(\w+)\}\}', html))
    assert seen == fields, (kind, sorted(seen ^ fields))
    html = re.sub(r'\{\{(\w+)\}\}', r'<span data-fillbars-field="\1">{{\1}}</span>', html)
    margins = page_margins(template)
    browser_margins = dict(margins)
    if kind == 'operationConsent':
        # Word positions the opening block in its header space, while its HTML
        # export turns that space into a normal paragraph; remove the duplicate
        # top/right inset for Chromium's print engine.
        browser_margins['top'] = 0
        browser_margins['right'] = 0
    if kind == 'operationProtocol':
        # The source is just over one sheet in Chromium. Keep a comfortable
        # outer margin and scale the complete Word table uniformly instead of
        # changing individual cell fonts or letting its final rows orphan.
        browser_margins['top'] = 12
        browser_margins['bottom'] = 10
    if kind == 'anesthesiaConsent':
        # Chromium's row fragmentation pushes the source-page footer into its
        # own sheet at the original 10 mm bottom margin.
        browser_margins['bottom'] = 2
    # Keep the source text width, but center the printable block on A4.
    horizontal = round((browser_margins['left'] + browser_margins['right']) / 2, 2)
    browser_margins['left'] = browser_margins['right'] = horizontal
    padding = ' '.join(f'{browser_margins[name]}mm' for name in ['top','right','bottom','left'])
    extra = (
        '<style id="fillbars-print-style">'
        '@page{size:A4;margin:'+padding+'}'
        'html,body{padding:0;margin:0;background:white}'
        'div.WordSection1{box-sizing:border-box}'
        '@media screen{html{background:#e9eeeb}div.WordSection1{'
        'width:210mm;min-height:297mm;margin:0 auto 12mm;padding:'+padding+';'
        'background:white;box-shadow:0 3px 15px #0002}}'
        '@media print{div.WordSection1{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}'
        'img{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'
        + ('@media print{div.WordSection1{zoom:.95;width:105.263158%;margin-left:4mm}'
           'table.MsoNormalTable{transform:translateX(6mm)}'
           'table.MsoNormalTable:first-of-type{width:624px!important}}' if kind == 'operationProtocol' else '')
        +
        '[data-fillbars-field]{font-weight:700}'
        '[data-fillbars-field="operationDescription"]{font-weight:normal;white-space:pre-wrap}'
        + '</style>'
    )
    html = html.replace('</head>', extra+'</head>', 1)
    assert '<div class=WordSection1>' in html or '<div class="WordSection1">' in html, kind
    return {'html': html, 'pages': PAGES[kind], 'margins': margins}


def main():
    cache = {script: templates_for(script) for script in set(SOURCE_FILES.values())}
    layouts = {kind: clean_word_html(kind, cache[script][kind]) for kind, script in SOURCE_FILES.items()}
    output = ROOT / 'medical-print-layouts.js'
    output.write_text('globalThis.__FillBARSMedicalPrintLayouts__ = '+json.dumps(layouts, ensure_ascii=False)+';\n',encoding='utf-8')
    print(json.dumps({'output':str(output),'forms':list(layouts),'size':output.stat().st_size},ensure_ascii=False))


if __name__ == '__main__': main()
