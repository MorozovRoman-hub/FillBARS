"""Build editable, patient-free DOCX templates from four supplied references."""
import base64
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
REFS = ROOT / 'tests' / 'artifacts' / 'new-form-refs-518'
ORIGINALS = Path('C:/Users/styno/OneDrive/Desktop/бланки в барсук')
spec = importlib.util.spec_from_file_location('medical_template_builder', ROOT / 'scripts' / 'build-medical-templates.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
NS = helper.NS

SOURCES = {
    'workInjury315': (ORIGINALS / '315у.docx', '941fffdd98b80d1f431449649c407ce338bc1caaca8dcf3865bbae07cb9ef6f5'),
    'workInjury316': (ORIGINALS / '316у.docx', '7720cb99dbd70d56f365c3fd6e18747fc51fd1b853b32a601e451a09bef21cd4'),
    'epidemicInvestigation': (REFS / 'epidemic.docx', 'af2c9cf21b2230863e1ce614a75eb6b1a72d493e520d9b59baa07b60fd325441'),
    'centralCatheter': (REFS / 'central-catheter.docx', 'ef57232907b19911ab2901fd8cb7a1d36ff6b3de4f9b22a5e9fa8cd650ea239b'),
}


def text(paragraph):
    return ''.join(paragraph.xpath('.//w:t/text()', namespaces=NS))


def join_split_fields(paragraph):
    nodes = paragraph.xpath('.//w:t', namespaces=NS)
    joined = ''.join(node.text or '' for node in nodes)
    spans = list(re.finditer(r'\{\{[A-Za-z][A-Za-z0-9]*\}\}', joined))
    for match in reversed(spans):
        offsets = []
        position = 0
        for node in nodes:
            length = len(node.text or '')
            offsets.append((position, position + length))
            position += length
        first = next(i for i, (start, end) in enumerate(offsets) if start <= match.start() < end)
        last = next(i for i, (start, end) in enumerate(offsets) if start < match.end() <= end)
        if first == last: continue
        start = offsets[first][0]
        end = offsets[last][0]
        nodes[first].text = (nodes[first].text or '')[:match.start()-start] + match.group()
        nodes[last].text = (nodes[last].text or '')[match.end()-end:]
        for node in nodes[first+1:last]: node.text = ''


def patch(paragraph, replacement, expected=None):
    before = text(paragraph)
    if expected is not None:
        assert expected in before, (expected, before[:160])
    helper.patch_text(paragraph, replacement)
    join_split_fields(paragraph)
    assert text(paragraph) == replacement, (replacement, text(paragraph))


def build_work_injury(root, kind):
    paragraphs = root.xpath('//w:body//w:p', namespaces=NS)
    if kind == 'workInjury315':
        replacements = {
            6: 'ОГРН (ОГРНИП) {{ogrn}}',
            12: '{{medicalOrganization}}',
            15: '{{organizationAddress}}',
            23: 'Выдано {{employer}}',
            28: 'о том, что пострадавший (пострадавшая) {{fullName}}',
            30: '{{age}} лет, {{workPlace}}',
            32: 'поступил в {{medicalOrganization}}',
            34: '{{department}}, {{startDate}}',
            39: 'болезней и проблем, связанных со здоровьем {{diagnosis}} ({{icdCode}})',
            44: 'производстве повреждение относится к категории {{injurySeverity}}',
            50: 'Дата выдачи медицинского заключения: {{documentDate}}',
            55: '{{organizationHead}}',
        }
    else:
        replacements = {
            5: 'ОГРН (ОГРНИП) {{ogrn}}',
            11: '{{medicalOrganization}}',
            14: '{{organizationAddress}}',
            22: 'Выдана {{employer}}',
            27: 'о том, что пострадавшему (пострадавшей) {{fullName}}',
            28: '{{birthDate}}, {{workPlace}}',
            31: 'оказывалась медицинская помощь {{medicalOrganization}}',
            33: '{{department}}:',
            35: 'в период с {{startDate}} по {{endDate}}',
            36: 'по поводу {{diagnosis}} ({{icdCode}})',
            45: 'производстве {{finalDiagnosis}}',
            51: 'производстве повреждение относится к категории {{injurySeverity}}',
            57: 'Дата выдачи медицинского заключения: {{documentDate}}',
            61: '{{organizationHead}}',
        }
    for index, replacement in replacements.items(): patch(paragraphs[index], replacement)
    return {'source': kind, 'blankFields': ['employer', 'injurySeverity', 'organizationHead', 'finalDiagnosis']}


def build_epidemic(root):
    paragraphs = root.xpath('//w:body//w:p', namespaces=NS)
    replacements = {
        10: 'ЭПИДЕМИОЛОГИЧЕСКОГО РАССЛЕДОВАНИЯ СЛУЧАЯ ИНФЕКЦИОННОЙ БОЛЕЗНИ, СВЯЗАННОЙ С ОКАЗАНИЕМ МЕДИЦИНСКОЙ ПОМОЩИ (ТИПОВАЯ) № {{documentNumber}}',
        13: 'Дата заполнения {{documentDate}}',
        46: re.sub(r'№\s*_+', '№ {{historyNumber}}', text(paragraphs[46])),
        47: 'Фамилия {{surname}} Имя {{firstName}} Отчество (при наличии) {{patronymic}} Возраст {{age}} лет',
        48: '1.2. Адрес места жительства: {{registeredAddress}}',
        50: '1.3. Место работы, должность {{workPlace}} Дата последнего посещения ___________',
        51: '1.4. Диагноз при поступлении: {{diagnosis}}',
    }
    for index, replacement in replacements.items(): patch(paragraphs[index], replacement)
    return {'source': 'epidemic', 'blankFields': ['documentNumber', 'workPlace']}


def build_catheter(root):
    paragraphs = root.xpath('//w:body//w:p', namespaces=NS)
    replacements = {
        4: '1. ФИО пациента {{fullName}}',
        5: '2. ФИО врача (ей) {{doctorName}}',
        6: '3. Медицинская карта № {{historyNumber}}',
        7: '4. Название отделения {{department}}',
        8: '5. Дата, время: {{documentDate}}. Начало {{procedureStart}}. Окончание {{procedureEnd}}. Длительность {{procedureDuration}} мин.',
        15: '12. Количество попыток: _____. Диаметр _____ (G). Длина _____ см. Количество просветов _____.',
        17: re.sub(r'_19__\s*:\s*_10___', '_____ : _____', text(paragraphs[17])),
        21: 'ФИО врача {{doctorName}} подпись __________',
        26: 'ФИО врача {{doctorName}} подпись __________',
        31: 'Я, {{fullName}}, пациент отделения {{department}} ({{medicalOrganization}}) (или законный представитель пациента) ______________________________________________________',
        34: 'О своем заболевании: {{diagnosis}} информирован.',
        40: '«____»___________20__ г. ________ часов ___ мин.',
        41: 'Врач анестезиолог-реаниматолог: {{doctorName}} ___________________',
    }
    for index, replacement in replacements.items(): patch(paragraphs[index], replacement)
    original = text(paragraphs[36])
    original = original.replace('КГБУЗ "Городская больница" им М.И. Шевчук МЗХК г. Амурск', '{{medicalOrganization}}')
    patch(paragraphs[36], original)
    visible = ' '.join(root.xpath('//w:body//w:t/text()', namespaces=NS))
    for forbidden in ['1473\\00463', '2025_ г.', '_19__ : _10___', 'КГБУЗ "Городская больница" им М.И. Шевчук МЗХК г. Амурск']:
        assert forbidden not in visible, forbidden
    return {'source': 'central-catheter', 'blankFields': ['procedureStart', 'procedureEnd', 'procedureDuration']}


def main():
    templates = {}
    for kind, (source, sha) in SOURCES.items():
        assert hashlib.sha256(source.read_bytes()).hexdigest() == sha, f'Source changed: {source}'
        with ZipFile(source) as archive: parts = {name: archive.read(name) for name in archive.namelist()}
        assert not any(name.startswith('word/comments') for name in parts)
        root = E.fromstring(parts['word/document.xml'])
        if kind.startswith('workInjury'): meta = build_work_injury(root, kind)
        elif kind == 'epidemicInvestigation': meta = build_epidemic(root)
        else: meta = build_catheter(root)
        parts['word/document.xml'] = helper.serialize(root)
        helper.scrub_metadata(parts)
        fields = list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}', ''.join(root.xpath('.//w:t/text()', namespaces=NS)))))
        assert ('fullName' in fields or kind == 'epidemicInvestigation' and 'surname' in fields), kind
        templates[kind] = {
            'extension': 'docx',
            'entries': [{'name': name, 'data': base64.b64encode(data).decode('ascii')} for name, data in parts.items()],
            'fields': fields,
            'preview': helper.preview(root),
            'checkboxes': {},
            **meta,
        }
        assert hashlib.sha256(source.read_bytes()).hexdigest() == sha
    output = ROOT / 'followup-templates.js'
    output.write_text('Object.assign(globalThis.__FillBARSMedicalTemplates__, '+json.dumps(templates, ensure_ascii=False)+' );\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'fields': {name: template['fields'] for name, template in templates.items()}}, ensure_ascii=False))


if __name__ == '__main__': main()
