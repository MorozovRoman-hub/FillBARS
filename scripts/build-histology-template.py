"""Package the supplied two-page histology form without patient or author data."""
import base64
import hashlib
import json
import re
import runpy
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('O:/[ОБЩАЯ]/Хирургия/направление на гистологию/Код формы по ОКУД.docx')
SOURCE_SHA = '7c0731d95c6866544bfe913b35ce24951b2358c3e28185c8ba35845f297698cf'
OUT = ROOT / 'tests/artifacts/histology-540'
helper = runpy.run_path(str(ROOT / 'scripts/build-medical-templates.py'))
NS = helper['NS']

def main():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_SHA
    with ZipFile(SOURCE) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    original = dict(parts)
    root = E.fromstring(parts['word/document.xml'])
    paragraphs = root.xpath('//w:body//w:p', namespaces=NS)
    assert len(paragraphs) == 99
    mapping = {
        0: '                                                                                     Код формы по ОКУД {{okudCode}}',
        1: '                                                                                     Код учреждения по ОКПО {{okpoCode}}',
        4: '                                                                                     {{medicalOrganization}}',
        5: '                                                                                     {{organizationAddress}}',
        10: 'Отделение, направившее биопсийный (операционный) материал {{department}}',
        11: 'Фамилия, имя, отчество (при наличии) пациента {{fullName}}',
        13: 'Пол: {{histologySex}}.               4. Дата рождения: {{birthDate}}',
        14: '5. Полис ОМС {{policyNumber}}     6. СНИЛС: {{snils}}',
        15: '7. Место регистрации: {{registeredAddress}}',
        17: '8. Местность: {{residenceType}}',
        18: '9. Диагноз основного заболевания (состояния) {{diagnosis}}',
        19: '10. Код по МКБ {{icdCode}}',
        20: '11. Задача прижизненного патолого-анатомического исследования биопсийного (операционного) материала {{histologyPurpose}}',
        22: '12. Дополнительные клинические сведения (основные симптомы, оперативное или гормональное, или лучевое лечение, результаты инструментальных и лабораторных исследований) {{clinicalInfo}}',
        24: '13. Результаты предыдущих прижизненных патолого-анатомических исследований (наименование медицинской организации, дата, регистрационный номер, заключение) {{previousHistology}}',
        26: '14. Проведённое предоперационное лечение (вид лечения, его сроки, дозировка лекарственного препарата, доза облучения) {{preoperativeTreatment}}',
        28: '15. Способ получения биопсийного (операционного) материала: {{biopsyMethod}}',
        29: '16. Дата забора материала {{materialDate}} время {{materialTime}}',
        30: '17. Материал помещён в 10%-ный раствор нейтрального формалина (да/нет) {{formalin}}',
        59: '19. Фамилия, инициалы врача {{doctorName}} Подпись _______________',
        60: '20. Дата направления {{documentDate}}, тел. {{doctorPhone}}',
        63: '{{medicalOrganization}}                                    Учетная форма № 014-1/у',
        64: '{{organizationAddress}}                                    Утверждена приказом',
        65: '                                                                                      Минздрава России',
        70: 'Отделение, направившее биопсийный (операционный) материал {{department}}',
        71: 'Фамилия, имя, отчество (при наличии) пациента {{fullName}}',
        73: 'Пол: {{histologySex}}.               4. Дата рождения: {{birthDate}}',
        74: '5. Полис ОМС {{policyNumber}}     6. СНИЛС: {{snils}}',
        75: '7. Место регистрации: {{registeredAddress}}',
        76: 'Тел. {{patientPhone}}     8. Местность: {{residenceType}}',
        77: '9. Диагноз заболевания (состояния) по данным направления {{diagnosis}}',
        78: '10. Код по МКБ {{icdCode}}',
        79: '11. Дата забора материала по данным направления {{materialDate}} время {{materialTime}}. 12. Материал доставлен в 10%-ном растворе нейтрального формалина (да/нет) {{deliveryFormalin}}, загрязнён (да/нет) {{materialContaminated}}.',
        80: '13. Дата поступления биопсийного (операционного) материала: {{materialReceivedDate}} время {{materialReceivedTime}}',
        81: '14. Отметка о сохранности упаковки {{packagingCondition}}. 15. Дата регистрации биопсийного (операционного) материала: {{materialRegisteredDate}} время {{materialRegisteredTime}}. 16. Регистрационный номер {{materialRegistrationNumber}}.',
        82: '17. Медицинские услуги: код {{histologyServiceCode}}, количество {{histologyServiceCount}}. 18. Категория сложности (1–5) {{histologyComplexity}}',
        83: '19. Вырезка проводилась: дата {{cuttingDate}} время {{cuttingTime}}. 20. В проводку взято {{processedObjects}} объектов',
        84: '21. Назначенные окраски (реакции, определения): {{histologyStains}}',
        86: '22. Макроскопическое описание: {{macroDescription}}',
        88: '23. Микроскопическое описание: {{microDescription}}',
        90: '24. Заключение: {{histologyConclusion}}     25. Код по МКБ {{histologyIcdCode}}',
        92: '26. Комментарии к заключению и рекомендации: {{histologyRecommendations}}',
        95: 'Врач-патологоанатом {{pathologist}}     М.П.     Подпись _______________',
        97: 'осуществляющий консультирование {{consultant}}     М.П.     Подпись _______________',
        98: '28. Дата проведения прижизненного патолого-анатомического исследования: {{histologyDate}}',
    }
    for index, replacement in mapping.items():
        helper['patch_text'](paragraphs[index], replacement)
        # Keep placeholders in a single text node for deterministic Office filling.
        nodes = paragraphs[index].xpath('.//w:t', namespaces=NS)
        joined = ''.join(node.text or '' for node in nodes)
        if '{{' in joined and any('{{' in (node.text or '') and '}}' not in (node.text or '') for node in nodes):
            nodes[0].text = replacement
            for node in nodes[1:]: node.text = ''
    table = root.xpath('//w:tbl', namespaces=NS)[0]
    for row_index, row in enumerate(table.xpath('./w:tr', namespaces=NS)[1:], 1):
        for column, cell in zip(['Number','Location','Description','Count'], row.xpath('./w:tc', namespaces=NS)):
            paragraph = cell.find('w:p', NS)
            helper['patch_text'](paragraph, '{{vial'+str(row_index)+column+'}}')
    # Filling short values must not pull the protocol header onto the referral page.
    protocol_props = paragraphs[63].find('w:pPr', NS)
    if protocol_props is None:
        protocol_props = E.Element('{'+NS['w']+'}pPr')
        paragraphs[63].insert(0, protocol_props)
    if protocol_props.find('w:pageBreakBefore', NS) is None:
        E.SubElement(protocol_props, '{'+NS['w']+'}pageBreakBefore')
    join_fields = runpy.run_path(str(ROOT / 'scripts/build-followup-templates.py'))['join_split_fields']
    for paragraph in root.xpath('//w:body//w:p', namespaces=NS): join_fields(paragraph)
    parts['word/document.xml'] = helper['serialize'](root)
    helper['scrub_metadata'](parts)
    if 'docProps/custom.xml' in parts:
        custom = E.fromstring(parts['docProps/custom.xml'])
        for child in list(custom): custom.remove(child)
        parts['docProps/custom.xml'] = helper['serialize'](custom)
    for name in parts:
        if name not in ['word/document.xml','docProps/core.xml','docProps/custom.xml']:
            assert parts[name] == original[name], name
    fields = list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}', ''.join(root.xpath('.//w:t/text()', namespaces=NS)))))
    fields.remove('patientPhone')
    fields.insert(fields.index('registeredAddress')+1, 'patientPhone')
    template = {
        'extension':'docx', 'entries':helper['entries'](parts), 'fields':fields,
        'preview':helper['preview'](root), 'checkboxes':{}, 'sourceSha256':SOURCE_SHA,
        'options':{
            'histologySex':['муж-1','жен-2'], 'residenceType':['городская – 1','сельская – 2'],
            'biopsyMethod':['эндоскопическая биопсия – 1','пункционная биопсия – 2','аспирационная биопсия – 3','инцизионная биопсия – 4','операционная биопсия – 5','операционный материал – 6','самопроизвольно отделившиеся фрагменты тканей – 7'],
            'formalin':['да','нет'], 'deliveryFormalin':['да','нет'], 'materialContaminated':['да','нет'],
            'histologyComplexity':['1','2','3','4','5'],
        },
        'labels':{
            'okudCode':'Код формы по ОКУД','okpoCode':'Код учреждения по ОКПО',
            'histologySex':'3. Пол пациента','residenceType':'8. Местность',
            'histologyPurpose':'11. Задача исследования','clinicalInfo':'12. Дополнительные клинические сведения',
            'previousHistology':'13. Предыдущие исследования','preoperativeTreatment':'14. Предоперационное лечение',
            'biopsyMethod':'15. Способ получения материала','materialDate':'16. Дата забора материала','materialTime':'16. Время забора материала',
            'formalin':'17. Помещён в 10%-ный раствор нейтрального формалина',
            'deliveryFormalin':'12. Доставлен в 10%-ном растворе нейтрального формалина','materialContaminated':'12. Загрязнение материала',
            'materialReceivedDate':'13. Дата поступления','materialReceivedTime':'13. Время поступления',
            'packagingCondition':'14. Сохранность упаковки','materialRegisteredDate':'15. Дата регистрации','materialRegisteredTime':'15. Время регистрации',
            'materialRegistrationNumber':'16. Регистрационный номер','histologyServiceCode':'17. Код медицинской услуги','histologyServiceCount':'17. Количество услуг',
            'histologyComplexity':'18. Категория сложности','cuttingDate':'19. Дата вырезки','cuttingTime':'19. Время вырезки','processedObjects':'20. Взято в проводку объектов',
            'histologyStains':'21. Назначенные окраски','macroDescription':'22. Макроскопическое описание','microDescription':'23. Микроскопическое описание',
            'histologyConclusion':'24. Заключение','histologyIcdCode':'25. Код МКБ в заключении','histologyRecommendations':'26. Комментарии и рекомендации',
            'pathologist':'27. Врач-патологоанатом','consultant':'27. Консультирующий специалист','histologyDate':'28. Дата исследования',
        },
        'multilineFields':['histologyPurpose','clinicalInfo','previousHistology','preoperativeTreatment','histologyStains','macroDescription','microDescription','histologyConclusion','histologyRecommendations'],
        'fieldSections':{'okudCode':'Учреждение и пациент','histologyPurpose':'Направление 014/у — сведения о материале','doctorName':'19–20. Врач и дата направления','deliveryFormalin':'Протокол 014-1/у — заполняет лаборатория'},
    }
    for row in range(1,6):
        for suffix,label in [('Number','Номер флакона'),('Location','Орган и локализация'),('Description','Характер процесса'),('Count','Количество объектов')]:
            template['labels'][f'vial{row}{suffix}']=label
        template['fieldSections'][f'vial{row}Number']=f'18. Маркировка материала — строка {row}'
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT/'blank-histology.docx','w') as archive:
        for name,data in parts.items(): archive.writestr(name,data)
    (ROOT/'histology-template.js').write_text('Object.assign(globalThis.__FillBARSMedicalTemplates__, '+json.dumps({'histology':template},ensure_ascii=False)+');\n',encoding='utf-8')
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_SHA
    print(json.dumps({'fields':len(fields),'blank':str(OUT/'blank-histology.docx')},ensure_ascii=False))

if __name__ == '__main__': main()
