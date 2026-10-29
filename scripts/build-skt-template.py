"""Build a patient-free CT referral from the first form in the supplied DOCX."""
import argparse
import base64
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'scripts' / 'build-medical-templates.py'
spec = importlib.util.spec_from_file_location('medical_template_builder', HELPER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
W, NS = module.W, module.NS

MAPPING = {
    7: 'Указать подразделение, направляющее на исследование: {{department}}',
    8: 'Ф.И.О. пациента: {{fullName}}',
    9: 'Дата рождения: {{birthDate}}',
    10: 'Медицинская карта пациента, получающего медицинскую помощь в стационарных условиях № {{historyNumber}}',
    12: 'Диагноз основного заболевания с кодом МКБ-10: {{diagnosis}} {{icdCode}}',
    13: ('Дополнительные клинические сведения (симптомы, результаты исследований, '
         'вмешательства, последнее рентгенологическое или СКТ исследование): {{clinicalInfo}}'),
    16: '{{studyRestrictions}}',
    18: '{{anatomicArea}}',
    20: '{{studyType}}',
    22: '{{studyPurpose}}',
    23: 'Ф.И.О. и должность лечащего врача: {{doctorPosition}} {{doctorName}}',
    25: '{{medicalOrganization}} {{organizationAddress}}',
    26: 'Контактный телефон, адрес электронной почты лечащего врача: {{doctorContacts}}',
    27: 'Дата выдачи направления: {{documentDate}}',
}


def build(reference: Path, output: Path):
    before = hashlib.sha256(reference.read_bytes()).hexdigest()
    with ZipFile(reference) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    assert len(parts) == 11, 'Review new OOXML parts before packaging'
    assert not any(name.startswith(('customXml/', 'word/comments')) for name in parts)
    root = E.fromstring(parts['word/document.xml'])
    body = root.find('w:body', NS)
    paragraphs = body.findall('w:p', NS)
    assert len(paragraphs) >= 30 and len(body) == len(paragraphs) + 1
    assert 'НАПРАВЛЕНИЕ' in ''.join(paragraphs[3].xpath('.//w:t/text()', namespaces=NS))
    source_name = ''.join(paragraphs[8].xpath('.//w:t/text()', namespaces=NS)).split('_____')[-1].strip()

    # Every following page is a filled example for another patient. Never ship it.
    for paragraph in paragraphs[30:]:
        body.remove(paragraph)
    for index, replacement in MAPPING.items():
        module.patch_text(paragraphs[index], replacement)
    body.remove(paragraphs[14])  # Second example-only clinical paragraph.

    for element in root.xpath('//w:del|//w:commentRangeStart|//w:commentRangeEnd|//w:commentReference', namespaces=NS):
        element.getparent().remove(element)
    parts['word/document.xml'] = module.serialize(root)
    module.scrub_metadata(parts)

    text = ''.join(root.xpath('.//w:t/text()', namespaces=NS))
    assert '{{fullName}}' in text and '{{studyType}}' in text
    assert source_name and source_name not in text, 'Example patient survived template scrub'
    assert hashlib.sha256(reference.read_bytes()).hexdigest() == before
    fields = list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}', text)))
    template = {
        'extension': 'docx',
        'entries': [{'name': name, 'data': base64.b64encode(data).decode('ascii')} for name, data in parts.items()],
        'fields': fields,
        'preview': module.preview(root),
        'checkboxes': {},
    }
    output.write_text('globalThis.__FillBARSMedicalTemplates__.skt = '
                      + json.dumps(template, ensure_ascii=False) + ';\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'sourceSha256': before, 'fields': fields,
                      'preservedParts': len(parts) - 2}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    build(args.reference, args.output)
