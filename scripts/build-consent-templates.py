"""Package patient-free editable consent DOCX forms converted from user-supplied files.

Only demographic slots are changed. Clinical choices, declarations, dates of signing,
signatures, and the source legal language are deliberately left untouched.
"""
import base64
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'tests' / 'artifacts' / 'consent-sources'
HELPER = ROOT / 'scripts' / 'build-medical-templates.py'
spec = importlib.util.spec_from_file_location('medical_template_builder', HELPER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
NS = module.NS


def build_one(name, substitutions):
    source = SOURCES / f'{name}.docx'
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    with ZipFile(source) as archive:
        parts = {item: archive.read(item) for item in archive.namelist()}
    assert not any(item.startswith(('customXml/', 'word/comments')) for item in parts)
    root = E.fromstring(parts['word/document.xml'])
    paragraphs = root.find('w:body', NS).findall('w:p', NS)
    assert len(paragraphs) >= 25
    for index, expected, replacement in substitutions:
        target = paragraphs[index]
        original = ''.join(target.xpath('.//w:t/text()', namespaces=NS))
        assert expected in original, (name, index, original[:100])
        module.patch_text(target, replacement)
    if name == 'anesthesia':
        cells = root.xpath('//w:tbl[1]/w:tr[1]/w:tc', namespaces=NS)
        assert len(cells) == 3
        assert 'года рождения' in ''.join(cells[1].xpath('.//w:t/text()', namespaces=NS))
        module.patch_text(cells[0].find('w:p', NS), '{{birthYear}}')
        module.patch_text(cells[2].find('w:p', NS), '{{address}}')
    for item in root.xpath('//w:del|//w:commentRangeStart|//w:commentRangeEnd|//w:commentReference', namespaces=NS):
        item.getparent().remove(item)
    if name == 'operation':
        # Conversion left a trailing empty paragraph that becomes a blank third page
        # once demographic text occupies the original writing lines.
        tail = paragraphs[-1]
        assert not ''.join(tail.xpath('.//w:t/text()', namespaces=NS)).strip()
        tail.getparent().remove(tail)
    module.bold_placeholder_runs(root)
    parts['word/document.xml'] = module.serialize(root)
    module.scrub_metadata(parts)
    preview_file = SOURCES / f'blank-{name}.docx'
    with ZipFile(preview_file, 'w') as archive:
        for item, data in parts.items():
            archive.writestr(item, data)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    fields = list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}', ''.join(root.xpath('.//w:t/text()', namespaces=NS)))))
    assert 'fullName' in fields
    return {
        'extension': 'docx',
        'entries': [{'name': item, 'data': base64.b64encode(data).decode('ascii')} for item, data in parts.items()],
        'fields': fields, 'preview': module.preview(root), 'checkboxes': {},
    }, source_hash


def main():
    specifications = {
        'operationConsent': ('operation', [
            (9, 'Я ', 'Я {{fullName}}'),
            (11, 'года рождения', '{{birthYear}} года рождения, проживающий(ая) по адресу: {{registeredAddress}}'),
            (26, '____', '{{department}}'),
            (30, 'операции:', 'операции: {{operationName}}'),
        ]),
        'anesthesiaConsent': ('anesthesia', [
            (5, 'Я ', 'Я {{fullName}}'),
            (9, 'в отделении', 'находясь на лечении (обследовании, родоразрешении) в отделении {{department}}'),
        ]),
    }
    templates = {}
    hashes = {}
    for key, (name, substitutions) in specifications.items():
        templates[key], hashes[name] = build_one(name, substitutions)
    output = ROOT / 'consent-templates.js'
    output.write_text('Object.assign(globalThis.__FillBARSMedicalTemplates__, '
                      + json.dumps(templates, ensure_ascii=False) + ');\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'sourcesSha256': hashes,
                      'fields': {key: value['fields'] for key, value in templates.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
