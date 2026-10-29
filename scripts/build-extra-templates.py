"""Build patient-free editable Office forms from the five supplied references.

Run only after manually checking source hashes and the source-page render contract.
The source documents are never modified. Signing dates, signatures and clinical
decisions are not inferred from the source patient.
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
REFS = ROOT / 'tests' / 'artifacts' / 'new-form-refs'
ORIGINALS = Path('C:/Users/styno/OneDrive/Desktop/бланки в барсук')
HELPER = ROOT / 'scripts' / 'build-medical-templates.py'
spec = importlib.util.spec_from_file_location('medical_template_builder', HELPER)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
NS = helper.NS

SOURCES = {
    'colonoscopyConsent': (REFS / 'colonoscopy.docx', 'ea7db4d22e123f6d6a1c42eb4d65ad668a636b35a8dd7605aa95b23d7570bafa'),
    'bronchoscopyConsent': (REFS / 'bronchoscopy.docx', '8eb35a15c6110a0d81b3f9b25bd40a621f0471b2309fb2fb74be30880fcf3c4c'),
    'gastroscopyConsent': (REFS / 'gastroscopy.docx', '0ef6fd46b01925ac95aff83d2c678b704e637b393535ba5e031038a5504d8b8e'),
    'thrombolysisConsent': (ORIGINALS / 'Согласие на тромболизис.docx', 'c6dc2c436481599f770b8920956924952a68c094d242c401a7162294028e95fb'),
    'operationProtocol': (ORIGINALS / 'протокол операции.docx', '887007752d934aa0bebddd2d267077eca2f0f2961f3bec540f9f02049febdfb0'),
}


def patch_paragraph(paragraph, replacement):
    helper.patch_text(paragraph, replacement)
    nodes = paragraph.xpath('.//w:t', namespaces=NS)
    if any('{{' in (node.text or '') and '}}' not in (node.text or '') for node in nodes):
        nodes[0].text = replacement
        for node in nodes[1:]: node.text = ''
    assert ''.join(paragraph.xpath('.//w:t/text()', namespaces=NS)) == replacement


def paragraph_text(paragraph):
    return ''.join(paragraph.xpath('.//w:t/text()', namespaces=NS))


def build_endoscopy(root, kind):
    paragraphs = root.xpath('//w:body/w:p', namespaces=NS)
    assert len(paragraphs) >= 26
    assert '5487-1' in paragraph_text(paragraphs[4])
    patch_paragraph(paragraphs[0], 'Приложение к истории болезни, амбулаторной карте № {{historyNumber}}\nот «____» __________ 20__ г.')
    patch_paragraph(paragraphs[2], 'Я, {{fullName}}, {{age}} лет,')
    patch_paragraph(paragraphs[3], 'Предварительный диагноз {{diagnosis}}')
    original = paragraph_text(paragraphs[4])
    legal = 'В соответствии со статьёй 20 Федерального закона от 21.11.2011 № 323-ФЗ «Об основах охраны здоровья граждан в Российской Федерации» '
    updated, count = re.subn(r'^На основании ст\.31,32,33 Основ законодательства.*?(?=информирован\(а\))', legal, original, count=1, flags=re.S)
    assert count == 1, kind
    updated = re.sub(r'Морозов(?:ым|ом)?\s*Р\.\s*В\._?', '{{doctorName}}', updated)
    assert 'Морозов' not in updated and '5487-1' not in updated, (kind, re.findall(r'.{0,40}(?:Морозов|5487-1).{0,40}', updated))
    patch_paragraph(paragraphs[4], updated)
    signature_statement = paragraph_text(paragraphs[18])
    signature_statement, count = re.subn(r'(врачу-эндоскописту)\s+.*?\s+(провести мне)', r'\1 {{doctorName}} \2', signature_statement, count=1)
    assert count == 1 and 'Морозов' not in signature_statement, kind
    patch_paragraph(paragraphs[18], signature_statement)
    patch_paragraph(paragraphs[25], 'Врач {{doctorName}} ________________________________')
    return {'source': kind, 'legalBasis': 'Федеральный закон от 21.11.2011 № 323-ФЗ, статья 20'}


def build_thrombolysis(root):
    paragraphs = root.xpath('//w:body/w:p', namespaces=NS)
    assert '323-ФЗ' in paragraph_text(paragraphs[3])
    patch_paragraph(paragraphs[4], 'Я, {{fullName}}')
    patch_paragraph(paragraphs[6], '{{birthDate}} г. рождения, зарегистрированный(ая) по адресу')
    patch_paragraph(paragraphs[8], '{{registeredAddress}}')
    patch_paragraph(paragraphs[10], 'проживающий(ая) по адресу: {{actualAddress}}')
    # Do not alter the representative, acceptance, refusal, consilium or signatures.
    return {'source': 'thrombolysis'}


def build_operation(root):
    paragraphs = root.xpath('//w:body/w:p', namespaces=NS)
    assert len(paragraphs) >= 1 and '№ 19' in paragraph_text(paragraphs[0])
    patch_paragraph(paragraphs[0], 'ПРОТОКОЛ ОПЕРАТИВНОГО ВМЕШАТЕЛЬСТВА (ОПЕРАЦИИ) № {{protocolNumber}}')
    tables = root.xpath('//w:body/w:tbl', namespaces=NS)
    assert len(tables) == 2
    def cell(table, row, column):
        tr = tables[table].xpath('./w:tr', namespaces=NS)[row]
        tc = tr.xpath('./w:tc', namespaces=NS)[column]
        return tc.xpath('./w:p', namespaces=NS)[0]
    updates = {
        (0, 0, 0): 'Медицинская организация: {{medicalOrganization}}. Отделение: {{department}}. История болезни № {{historyNumber}}',
        (0, 2, 1): '{{fullName}}',
        (0, 3, 0): 'Дата рождения: {{birthDate}}',
        (0, 4, 0): 'Дата и время начала оперативного вмешательства (операции): {{operationStart}}',
        (0, 5, 0): 'Дата и время окончания оперативного вмешательства (операции): {{operationEnd}}',
        (0, 6, 0): 'Продолжительность оперативного вмешательства (операции): {{operationDuration}}',
        (0, 8, 1): '{{operationName}}',
        (0, 10, 1): '{{operationCode}}',
        (0, 14, 1): '{{diagnosis}}',
        (1, 5, 1): '{{bloodGroupAbo}}',
        (1, 5, 3): '{{bloodGroupRh}}',
        (1, 8, 1): '{{risk}}',
        (1, 11, 0): '{{operationPlan}}',
        (1, 18, 0): '{{operationDescription}}',
        (1, 19, 0): 'Осложнения, возникшие в ходе оперативного вмешательства (операции): {{intraoperativeComplications}}',
        (1, 21, 0): 'Использование медицинских изделий (оборудования): {{equipment}}',
        (1, 23, 1): '{{instrumentCount}}',
        (1, 23, 3): '{{swabCount}}',
        (1, 24, 1): '{{bloodLoss}}',
        (1, 25, 0): 'Вид анестезиологического пособия: {{anesthesia}}',
        (1, 29, 1): '{{postopDiagnosis}}',
        (1, 52, 1): '{{doctorName}}',
        (1, 53, 1): '{{assistantDoctor}}',
        (1, 57, 1): '{{anesthesiologist}}',
    }
    for (table, row, column), text in updates.items():
        patch_paragraph(cell(table, row, column), text)
    visible = ' '.join(root.xpath('//w:body//w:t/text()', namespaces=NS))
    for forbidden in ['Гейкер', 'Полина Павловна', 'Морозов Р.В.', 'Гусева М.Е.', 'Битюцкий В.А.', 'Аппендэктомия', 'аппендицит', '2025 г.', '30 мл', 'средний']:
        assert forbidden not in visible, forbidden
    return {'source': 'operation', 'operationCatalog': True}


def main():
    templates = {}
    for kind, (source, expected_hash) in SOURCES.items():
        assert hashlib.sha256(source.read_bytes()).hexdigest() == expected_hash, f'Source changed: {source}'
        with ZipFile(source) as archive:
            parts = {name: archive.read(name) for name in archive.namelist()}
        assert not any(name.startswith('word/comments') for name in parts), kind
        for name, data in parts.items():
            if name.startswith('customXml/'):
                assert all(token not in data for token in [b'5487-1', b'1993']), f'Unexpected source data in {name}'
        root = E.fromstring(parts['word/document.xml'])
        # The thrombolysis reference contains a local ConsultantPlus hyperlink.
        # Keep the displayed citation text but do not ship an external link.
        if 'word/_rels/document.xml.rels' in parts:
            rels = E.fromstring(parts['word/_rels/document.xml.rels'])
            external = {rel.get('Id') for rel in rels if rel.get('TargetMode') == 'External'}
            for rel in list(rels):
                if rel.get('Id') in external: rels.remove(rel)
            if external:
                for link in list(root.xpath('//w:hyperlink', namespaces=NS)):
                    if link.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id') not in external: continue
                    parent = link.getparent(); index = parent.index(link)
                    for child in list(link): parent.insert(index, child); index += 1
                    parent.remove(link)
                parts['word/_rels/document.xml.rels'] = helper.serialize(rels)
        if kind.endswith('Consent') and kind != 'thrombolysisConsent': meta = build_endoscopy(root, kind)
        elif kind == 'thrombolysisConsent': meta = build_thrombolysis(root)
        else: meta = build_operation(root)
        if kind.endswith('Consent'):
            helper.bold_placeholder_runs(root)
        parts['word/document.xml'] = helper.serialize(root)
        helper.scrub_metadata(parts)
        fields = list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}', ''.join(root.xpath('.//w:t/text()', namespaces=NS)))))
        assert 'fullName' in fields, kind
        templates[kind] = {
            'extension': 'docx',
            'entries': [{'name': name, 'data': base64.b64encode(data).decode('ascii')} for name, data in parts.items()],
            'fields': fields,
            'preview': helper.preview(root),
            'checkboxes': {},
            **meta,
        }
        assert hashlib.sha256(source.read_bytes()).hexdigest() == expected_hash, f'Source changed during build: {source}'
    output = ROOT / 'extra-templates.js'
    output.write_text('Object.assign(globalThis.__FillBARSMedicalTemplates__, '
                      + json.dumps(templates, ensure_ascii=False) + ');\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'fields': {name: item['fields'] for name, item in templates.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
