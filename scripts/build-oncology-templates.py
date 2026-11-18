"""Build patient-free oncology forms from the user's two local Word references.

Run this first, export the blank QA documents to filtered HTML using Word,
then run with --layouts to package that HTML for the browser.
"""
import base64
import hashlib
import importlib.util
import json
import re
import runpy
import sys
from pathlib import Path
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/artifacts/oncology-564'
SOURCES = Path('C:/Users/styno/OneDrive/Desktop/бланки в барсук')
helper = runpy.run_path(str(ROOT / 'scripts/build-medical-templates.py'))
join_fields = runpy.run_path(str(ROOT / 'scripts/build-followup-templates.py'))['join_split_fields']
NS = helper['NS']
TOKEN = re.compile(r'\{\{(\w+)\}\}')

CHOICE_GROUPS = [
 (27,'05. Пол',[27]),(32,'08. Житель',[32]),(39,'13. Впервые установлен диагноз',[39]),
 (40,'14. Цель госпитализации',[42,44,46,48,50]),
 (59,'15.4. Стадия опухолевого процесса',[61,63,65,68]),
 (70,'15.5. Отдалённые метастазы',[72,74,76,78,80]),
 (82,'15.6. Подтверждение диагноза',[84,86,88]),
 (91,'17. Характер лечения',[93,95,97,99]),
 (101,'18. Причина незавершённости лечения',[103,105,107]),
 (114,'20.2. Способ облучения',[115,117,119,121,123,125]),
 (127,'20.3. Вид лучевой терапии',[129,131,133,135,137]),
 (139,'20.4. Методы лучевой терапии',[141,143,145,147,149,151,153,155]),
 (156,'20.5. Радиомодификаторы',[158,160,162,164,166,168,170]),
 (180,'21.2. Вид химиотерапии',[180]),(187,'22.2. Вид гормонотерапии',[189]),
]

def discharge_checkboxes(ps, mapping):
    """Replace source box artwork with real, independently editable checkbox fields."""
    original=[''.join(p.xpath('.//w:t/text()',namespaces=NS)) for p in ps]
    boxes={};sections={}
    # The original uses two text lines to draw each box. Remove the box tops.
    for i,text in enumerate(original):
        if '┌' in text:mapping[i]=''
    for heading,title,rows in CHOICE_GROUPS:
        for row in rows:
            text=original[row]
            chunks=re.split(r'└─+┘',text)
            assert len(chunks)>1,(row,text)
            prefix=row not in [119,129,131,133,135,137,141,143,145,147,149,151,153,155]
            options=chunks[1:] if prefix else chunks[:-1]
            rendered=[]
            for j,option in enumerate(options):
                label=re.sub(r'^\s*\d+\.\d*\.?\s*','',option).strip(' ;_\t')
                # The intracutaneous irradiation row has a box without a trailing label.
                if not label:label='внутритканевое'
                if row==141:label=['внутритканевая','внутриполостная','I-131','Au-198'][j]
                if row in [115,117]:label=('внешнее: ' if row==115 else 'внутриполостное: ')+label
                key=f'dischargeCheck{row}x{j}'
                boxes[key]=title+' — '+label
                if row==rows[0] and j==0:sections[key]=title
                rendered.append('{{'+key+'}} '+label)
            mapping[row]=('     '.join(rendered))
        if heading not in rows:
            mapping[heading]=title+':'
        else:
            mapping[heading]=title+': '+mapping[heading]
    return boxes,sections

# Paragraph numbers refer to the supplied originals, including table cells.
DISCHARGE = {
 21:'01. Название и адрес учреждения, выдавшего выписку {{medicalOrganization}}, {{organizationAddress}}',
 22:'02. Название и адрес учреждения, куда направляется выписка {{destination}}',
 23:'03. Фамилия Имя Отчество больного {{fullName}}',
 25:'04. Дата рождения: {{birthDate}}',
 26:'',27:'05. Пол: {{sex}}', 28:'06. Этническая группа {{ethnicGroup}}',
 29:'07. Адрес больного: {{registeredAddress}}', 30:'',
 31:'',32:'08. Житель: {{residence}}', 33:'09. Социально-профессиональная группа {{professionalGroup}}',
 34:'10. Дата поступления в стационар: {{startDate}}',
 35:'11. Дата выписки из стационара или смерти: {{endDate}}',
 36:'12. Длительность пребывания в стационаре в днях {{hospitalDays}}',
 37:'13. Диагноз данного злокачественного новообразования установлен впервые в жизни в период',
 38:'',39:'данной госпитализации: {{firstDiagnosisDuringStay}}',
 40:'14. Цель госпитализации: {{hospitalizationPurpose}}',
 52:'{{diagnosis}}',53:'15.1. Топография опухоли {{tumorLocation}}',
 56:'15.2. Морфологический тип опухоли {{morphology}}',
 58:'15.3. Стадия по системе TNM: {{tnm}}',59:'15.4. Стадия опухолевого процесса: {{tumorStage}}',
 70:'15.5. Локализация отдаленных метастазов (при IV стадии заболевания): {{metastasisSites}}',
 82:'15.6. Метод подтверждения диагноза: {{diagnosisConfirmation}}',
 89:'16. Сопутствующие заболевания: {{concomitantDiagnosis}}',
 91:'17. Характер проведенного за период данной госпитализации лечения: {{treatmentNature}}',
 101:'18. Причина незавершенности радикального лечения: {{incompleteTreatmentReason}}',
 109:'19.1. Дата операции и 19.2. Название операции: {{surgicalTreatment}}',
 110:'19.3. Осложнения хирургического лечения: {{surgicalComplications}}',
 113:'20.1. Дата начала курса лучевой терапии: {{radiationStartDate}}',
 114:'20.2. Способ облучения: {{radiationMethod}}',
 127:'20.3. Вид лучевой терапии: {{radiationType}}',
 139:'20.4. Методы лучевой терапии: {{radiationTechnique}}',
 156:'20.5. Радиомодификаторы, применявшиеся при проведении лучевой терапии: {{radiomodifiers}}',
 171:'20.6. Поля облучения {{radiationFields}}',
 173:'20.7. Суммарная доза на опухоль {{tumorRadiationDose}} (Гр)',174:'',
 175:'Суммарная доза на зоны регионарного метастазирования {{regionalRadiationDose}} (Гр)',
 176:'20.8. Осложнения лучевого лечения: {{radiationComplications}}',
 178:'21.1. Дата начала курса химиотерапии: {{chemotherapyStartDate}}',
 179:'',180:'21.2. Вид химиотерапии: {{chemotherapyType}}',
 181:'21.3. Препараты, суммарные дозы: {{chemotherapyDrugs}}',
 183:'21.4. Осложнения химиотерапевтического лечения: {{chemotherapyComplications}}',
 186:'22.1. Дата начала курса: {{hormoneStartDate}}',187:'22.2. Вид гормонотерапии: {{hormoneType}}',
 190:'22.3. Препараты, дозы {{hormoneDrugs}}',
 192:'22.4. Осложнения гормоноиммунотерапевтического лечения: {{hormoneComplications}}',
 194:'23. Другие виды специального лечения: {{otherTreatment}}',
 196:'24. Особенности случая: {{caseFeatures}}',
 198:'25. Лечебные и трудовые рекомендации: {{recommendations}}',
 200:'26. Фамилия и инициалы, телефон врача, заполнившего выписку {{doctorName}} {{doctorPhone}}',
 201:'Дата заполнения выписки {{documentDate}} Подпись врача ______________________',
}
LATE = {
 14:'N медицинской карты стационарного больного (амбулаторной карты) {{historyNumber}}',
 15:'01. Составлен лечебным учреждением (название, адрес): {{medicalOrganization}}, {{organizationAddress}}',
 16:'02. Фамилия {{surname}}',17:'Имя {{firstName}}',18:'Отчество {{patronymic}}',
 19:'03. Дата рождения: {{birthDate}}',20:'',21:'04. Пол: {{sex}}',
 22:'05. Домашний адрес: {{registeredAddress}}',23:'',24:'',
 25:'06. Основной диагноз: {{diagnosis}}',26:'06.1. Локализация опухоли: {{tumorLocation}}',
 29:'06.2. Морфологический тип опухоли {{morphology}}',
 31:'06.3. Стадия опухолевого процесса по системе TNM: {{tnm}}',32:'',
 34:'07. Локализация отдаленных метастазов (при IV стадии заболевания): {{metastasisSites}}',
 42:'08. Метод подтверждения диагноза: {{diagnosisConfirmation}}',
 47:'09. Дата установления запущенности рака: {{advancedDiagnosisDate}}',
 48:'10. Дата появления признаков заболевания: {{symptomDate}}',
 51:'Дата: {{firstVisitDate}} в какое лечебное учреждение (название,',52:'адрес): {{firstVisitOrganization}}',
 55:'Дата: {{diagnosisDate}}, учреждение, где',56:'впервые был установлен диагноз рака (название, адрес): {{diagnosisOrganization}}',
 66:'{{historyOrganization}}',67:'{{historyVisitDate}}',68:'',69:'{{historyStudies}}',70:'',71:'',
 72:'{{historyDiagnosis}}',73:'{{historyTreatment}}',
 79:'14. Причины поздней диагностики: {{lateDiagnosisReasons}}',
 87:'15. Данные клинического разбора настоящего случая: {{clinicalReview}}',
 92:'Наименование учреждения, где проведена конференция: {{conferenceOrganization}}',
 95:'Дата конференции: {{conferenceDate}}',97:'Организационные выводы: {{organizationalConclusions}}',
 105:'Подпись врача, составившего протокол: {{doctorName}} __________________',
 107:'Подпись главного врача {{organizationHead}} __________________',
 109:'Дата составления протокола: {{documentDate}}',
}
LABELS = dict(sex='Пол',residence='Житель города / села',hospitalDays='Длительность госпитализации, дней',
 firstDiagnosisDuringStay='Впервые в жизни установлен диагноз при этой госпитализации',
 hospitalizationPurpose='Цель госпитализации',tumorLocation='Локализация опухоли',tumorStage='Стадия опухолевого процесса',
 metastasisSites='Локализация отдалённых метастазов',diagnosisConfirmation='Метод подтверждения диагноза',
 treatmentNature='Характер проведённого лечения',incompleteTreatmentReason='Причина незавершённости радикального лечения',
 surgicalTreatment='Дата и название операции',surgicalComplications='Осложнения хирургического лечения',
 radiationStartDate='Дата начала лучевой терапии',radiationMethod='Способ облучения',radiationType='Вид лучевой терапии',
 radiationTechnique='Методы лучевой терапии',radiomodifiers='Радиомодификаторы',radiationFields='Поля облучения',
 tumorRadiationDose='Суммарная доза на опухоль, Гр',regionalRadiationDose='Доза на зоны регионарного метастазирования, Гр',
 radiationComplications='Осложнения лучевого лечения',chemotherapyStartDate='Дата начала химиотерапии',
 chemotherapyType='Вид химиотерапии',chemotherapyDrugs='Препараты химиотерапии и суммарные дозы',
 chemotherapyComplications='Осложнения химиотерапии',hormoneStartDate='Дата начала гормоноиммунотерапии',
 hormoneType='Вид гормонотерапии',hormoneDrugs='Препараты гормоноиммунотерапии и дозы',
 hormoneComplications='Осложнения гормоноиммунотерапии',otherTreatment='Другие виды специального лечения',
 caseFeatures='Особенности случая',recommendations='Лечебные и трудовые рекомендации',
 advancedDiagnosisDate='Дата установления запущенности рака',symptomDate='Дата появления признаков заболевания',
 firstVisitOrganization='Учреждение первого обращения и адрес',diagnosisOrganization='Учреждение установления диагноза и адрес',
 historyOrganization='Этапы обращений — учреждения',historyVisitDate='Этапы обращений — даты',
 historyStudies='Этапы обращений — исследования',historyDiagnosis='Этапы обращений — диагнозы',
 historyTreatment='Этапы обращений — лечение',lateDiagnosisReasons='Причины поздней диагностики',
 clinicalReview='Данные клинического разбора',conferenceOrganization='Учреждение проведения конференции',
 conferenceDate='Дата конференции',organizationalConclusions='Организационные выводы')

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if '--layouts' in sys.argv:
        spec=importlib.util.spec_from_file_location('print_layout_builder', ROOT/'scripts/build-print-layouts.py')
        layouts_helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(layouts_helper)
        layouts_helper.REFS=OUT
        templates=json.loads((ROOT/'oncology-templates.js').read_text('utf-8').split(', ',1)[1].rsplit(');',1)[0])
        layouts={}
        for kind,template in templates.items():
            from pypdf import PdfReader
            pages=len(PdfReader(OUT/f'blank-{kind}.pdf').pages)
            layouts_helper.PAGES[kind]=pages
            layouts[kind]=layouts_helper.clean_word_html(kind,template)
            # Medical narrative fields retain the user's paragraph breaks.
            layouts[kind]['html']=layouts[kind]['html'].replace('</head>','<style>[data-fillbars-field]{white-space:pre-wrap;overflow-wrap:anywhere}</style></head>')
        (ROOT/'oncology-print-layouts.js').write_text('Object.assign(globalThis.__FillBARSMedicalPrintLayouts__, '+json.dumps(layouts,ensure_ascii=False)+');\n','utf-8')
        print({k:v['pages'] for k,v in layouts.items()})
        return
    templates={}
    for kind,filename,mapping,count in [('oncologyDischarge','выписка ОНКО пациента.docx',DISCHARGE,205),('advancedOncology','поздняя стадия зно.docx',LATE,111)]:
        source=SOURCES/filename;source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
        with ZipFile(source) as z:parts={n:z.read(n) for n in z.namelist()}
        assert not any(n.startswith(('customXml/','word/comments')) for n in parts)
        root=E.fromstring(parts['word/document.xml']);ps=root.xpath('//w:body//w:p',namespaces=NS)
        # Keep source citation text while removing external Word hyperlinks.
        for link in root.xpath('//w:hyperlink',namespaces=NS):
            parent=link.getparent();at=parent.index(link)
            for child in list(link):parent.insert(at,child);at+=1
            parent.remove(link)
        for name in list(parts):
            if name.endswith('.rels'):
                rels=E.fromstring(parts[name])
                for rel in list(rels):
                    if rel.get('TargetMode')=='External':rels.remove(rel)
                parts[name]=helper['serialize'](rels)
        assert len(ps)==count,(kind,len(ps))
        mapping=dict(mapping)
        checkboxes,field_sections=discharge_checkboxes(ps,mapping) if kind=='oncologyDischarge' else ({},{})
        for index,value in mapping.items():
            helper['patch_text'](ps[index],value);join_fields(ps[index])
            assert ''.join(ps[index].xpath('.//w:t/text()',namespaces=NS))==value
        # Choices in the examples must not carry over emphasis as a clinical selection.
        for index,p in enumerate(ps):
            text=''.join(p.xpath('.//w:t/text()',namespaces=NS))
            if '┌' in text and '└' not in text:
                # Box tops and their labels must stay on the same printed sheet.
                props=p.find('w:pPr',NS)
                if props is None:props=E.Element('{'+NS['w']+'}pPr');p.insert(0,props)
                if props.find('w:keepNext',NS) is None:E.SubElement(props,'{'+NS['w']+'}keepNext')
            if index not in mapping or kind=='oncologyDischarge' and any(index in rows for _,_,rows in CHOICE_GROUPS):
                for prop in p.xpath('.//w:b|.//w:u|.//w:highlight|.//w:shd',namespaces=NS):prop.getparent().remove(prop)
        for el in root.xpath('//w:del|//w:commentRangeStart|//w:commentRangeEnd|//w:commentReference',namespaces=NS):el.getparent().remove(el)
        parts['word/document.xml']=helper['serialize'](root);helper['scrub_metadata'](parts)
        all_xml=' '.join(v.decode('utf-8',errors='ignore') for n,v in parts.items() if n.endswith('.xml'))
        for private in ['Козлов','Анатольевич','Агафонкина','1958','Клацкина','23а','21.10.26','14.10.26','подозрение на ЗНО']:
            assert private not in all_xml,(kind,private)
        fields=list(dict.fromkeys(TOKEN.findall(''.join(root.xpath('//w:t/text()',namespaces=NS)))))
        demographics={'medicalOrganization','organizationAddress','destination','fullName','surname','firstName','patronymic','birthDate','registeredAddress','startDate','endDate','diagnosis','concomitantDiagnosis','historyNumber','doctorName','doctorPhone','documentDate'}
        templates[kind]={'extension':'docx','entries':helper['entries'](parts),'fields':fields,'preview':helper['preview'](root),'checkboxes':checkboxes,'fieldSections':field_sections,'labels':LABELS,
          'manualFields':[f for f in fields if f not in demographics],
          'multilineFields':[f for f in fields if f not in demographics and f not in checkboxes and f not in ['sex','residence','hospitalDays'] and not f.endswith('Date')],
          'options':{'sex':['мужской','женский','неизвестен'],'residence':['города','села','неизвестно'],'firstDiagnosisDuringStay':['да','нет']},
          'sourceSha256':source_hash}
        with ZipFile(OUT/f'blank-{kind}.docx','w') as z:
            for n,v in parts.items():z.writestr(n,v)
        assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
    (ROOT/'oncology-templates.js').write_text('Object.assign(globalThis.__FillBARSMedicalTemplates__, '+json.dumps(templates,ensure_ascii=False)+');\n','utf-8')
    print({kind:len(t['fields']) for kind,t in templates.items()})

if __name__=='__main__':main()
