"""Build clean palliative/CEC forms from the user's local references."""
import base64
import hashlib
import json
import re
import runpy
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/artifacts/commission-541'
PALLIATIVE=Path('O:/Хирургическое отделение/Наимзода/проток ВК на палиатив.docx')
CEC_DOC=Path('D:/работа/работа с историей/ЗАКЛЮЧЕНИЕ КЭК.doc')
HASHES={'palliative':'e904460ccfab91696a324f735fc2b8e966b383149332f8e2e6dba94d23f7ddd0','cec':'8433f88217b6857ffc9c48cd4dac362dfd59da64c7772ba0f7f268af574df3c9'}
helper=runpy.run_path(str(ROOT/'scripts/build-medical-templates.py'))
join_fields=runpy.run_path(str(ROOT/'scripts/build-followup-templates.py'))['join_split_fields']
NS=helper['NS']

def text(p):return ''.join(p.xpath('.//w:t/text()',namespaces=NS))
def patch(p,value):
    helper['patch_text'](p,value)
    join_fields(p)
    assert text(p)==value

def palliative(root):
    body=root.find('w:body',NS);ps=body.xpath('.//w:p',namespaces=NS)
    assert len(ps)==497
    private_names=[text(p).split(':',1)[1].strip() for p in ps if text(p).startswith('Ф.И.О.:')]
    # Retain only the first form, never the other five patient examples.
    end=ps[49]
    while end.getparent() is not body:end=end.getparent()
    for child in list(body)[list(body).index(end)+1:]:
        if child.tag!='{'+NS['w']+'}sectPr':body.remove(child)
    replacements={
        4:'{{agencyName}}',5:'{{medicalOrganization}}',6:'',7:'{{organizationAddress}}',8:'тел. {{organizationPhone}}',9:'ИНН/КПП {{taxRegistration}}',
        10:'{{documentDate}} г. № {{documentNumber}}',11:'На № {{responseNumber}} от {{responseDate}}',
        15:'Заключение врачебной комиссии {{medicalOrganization}}',16:'',
        20:'Ф.И.О.: {{fullName}}',21:'Дата рождения: {{birthDate}}',22:'Адрес: {{registeredAddress}}',23:'СНИЛС: {{snils}}',
        24:'Номер и серия страхового полиса ОМС, страховая компания: {{policyNumber}}, {{insurer}}',25:'Инвалидность: {{disability}}',
        26:'Диагноз: {{diagnosis}}. Код по МКБ-10: {{icdCode}}',
        29:'Жалобы: {{complaints}}',30:'Объективный статус: {{objectiveStatus}}',43:'Решение ВК: {{commissionDecision}}',45:'Рекомендации: {{commissionRecommendations}}',
        47:'Члены ВК: {{commissionMember1}} ___________________',48:'{{commissionMember2}} ___________________',49:'{{commissionMember3}} ___________________',
    }
    for i,value in replacements.items():patch(ps[i],value)
    for i in [27,28,*range(31,43)]:ps[i].getparent().remove(ps[i])
    visible=text(root)
    assert all(name not in visible for name in private_names if name)
    assert visible.count('(для оказания паллиативной помощи взрослым)')==1
    return {
        'fieldDefaults':{'commissionDecision':'Признать пациента нуждающимся в оказании паллиативной медицинской помощи.'},
        'labels':{'agencyName':'Учредитель / ведомство','organizationPhone':'Телефон учреждения','taxRegistration':'ИНН / КПП','responseNumber':'Ответ на документ №','responseDate':'Дата документа, на который даётся ответ','complaints':'Жалобы','objectiveStatus':'Объективный статус','commissionDecision':'Решение врачебной комиссии','commissionRecommendations':'Рекомендации','commissionMember1':'Первый член ВК','commissionMember2':'Второй член ВК','commissionMember3':'Третий член ВК'},
        'multilineFields':['complaints','objectiveStatus','commissionDecision','commissionRecommendations'],
        'fieldSections':{'agencyName':'Реквизиты учреждения','fullName':'Пациент','complaints':'Осмотр и решение комиссии','commissionMember1':'Состав комиссии'},
        'manualFields':['commissionRecommendations','commissionMember1','commissionMember2','commissionMember3','objectiveStatus','complaints','disability'],
    }

def cec(root):
    ps=root.xpath('//w:body//w:p',namespaces=NS);assert len(ps)==108
    for start in [0,25]:
        mapping={1:'Протокол № {{documentNumber}}',2:'От {{documentDate}} года',3:'Пациент: {{fullName}}, дата рождения: {{birthDate}}',
                 5:'Жалобы: {{complaints}}',7:'Данные объективного осмотра: {{cecObjectiveStatus}}',10:'Диагноз КЭК со степенью выраженности функциональных нарушений: {{cecDiagnosis}}',
                 11:'ЗАКЛЮЧЕНИЕ: {{cecDecision}}',12:'',13:'',14:'',16:'Признан нетрудоспособным: {{incapacityDetails}}',18:'Направлен на МСЭ: {{mseReferral}}',
                 21:'Подписи членов КЭК: {{commissionMember1}} ______________',22:'{{commissionMember2}} ______________',23:'{{commissionMember3}} ______________',24:'{{commissionMember4}} ______________'}
        for index,value in mapping.items():patch(ps[start+index],value)
    for start in [50,79]:
        mapping={1:'Пациент: {{fullName}}, дата рождения: {{birthDate}}',2:'Дата {{documentDate}}',
                 3:'Имеется листок нетрудоспособности в течение {{sickLeaveDays}} дней с диагнозом: {{diagnosis}}',
                 5:'Лечение стационарно: {{inpatientTreatment}}; амбулаторно: {{outpatientTreatment}}',6:'Жалобы: {{complaints}}',
                 8:'Анамнез: {{anamnesis}}',10:'Объективные данные: {{objectiveStatus}}',12:'Данные обследования в динамике: {{investigationDynamics}}',
                 14:'Трудовой прогноз: {{workPrognosis}}',18:'Цель направления на КЭК: {{cecPurpose}}',28:'Подпись лечащего врача {{doctorName}} __________________'}
        for index,value in mapping.items():patch(ps[start+index],value)
        for index in range(19,26):
            patch(ps[start+index],'')
            for prop in ps[start+index].xpath('./w:pPr/w:numPr',namespaces=NS):prop.getparent().remove(prop)
    # One portrait sheet: a single representation above a single conclusion.
    # Blank handwriting lines and duplicate copies are unnecessary in the editor.
    body=root.find('w:body',NS)
    section=body.find('w:sectPr',NS)
    selected=[ps[i] for i in [50,51,52,53,55,56,58,60,62,64,68,78,0,1,2,3,5,7,10,11,16,18,21,22,23,24]]
    for child in list(body):
        if child is not section:body.remove(child)
    for paragraph in selected:
        for br in paragraph.xpath('.//w:br[@w:type="page" or @w:type="column"]',namespaces=NS):br.getparent().remove(br)
        props=paragraph.find('w:pPr',NS)
        if props is None:
            props=E.Element('{'+NS['w']+'}pPr');paragraph.insert(0,props)
        for old in props.xpath('./w:pageBreakBefore|./w:spacing',namespaces=NS):props.remove(old)
        spacing=E.SubElement(props,'{'+NS['w']+'}spacing')
        for name,value in {'before':'200' if paragraph is ps[0] else '0','after':'60','line':'240','lineRule':'auto'}.items():spacing.set('{'+NS['w']+'}'+name,value)
        for run in paragraph.xpath('./w:r',namespaces=NS):
            run_props=run.find('w:rPr',NS)
            if run_props is None:run_props=E.Element('{'+NS['w']+'}rPr');run.insert(0,run_props)
            for size_name in ['sz','szCs']:
                size=run_props.find('w:'+size_name,NS)
                if size is None:size=E.SubElement(run_props,'{'+NS['w']+'}'+size_name)
                size.set('{'+NS['w']+'}val','24' if paragraph in [ps[50],ps[0]] else '22')
        body.insert(len(body)-1,paragraph)
    page=section.find('w:pgSz',NS)
    for name,value in {'w':'11906','h':'16838','orient':'portrait'}.items():page.set('{'+NS['w']+'}'+name,value)
    margins=section.find('w:pgMar',NS)
    for name,value in {'top':'567','right':'680','bottom':'567','left':'680'}.items():margins.set('{'+NS['w']+'}'+name,value)
    columns=section.find('w:cols',NS);columns.set('{'+NS['w']+'}num','1');columns.set('{'+NS['w']+'}space','0')
    return {
        'labels':{'documentNumber':'Номер протокола КЭК','complaints':'Жалобы','cecObjectiveStatus':'Объективный осмотр — заключение КЭК','cecDiagnosis':'Диагноз КЭК и выраженность функциональных нарушений','cecDecision':'Заключение КЭК','incapacityDetails':'Признан нетрудоспособным — решение и сроки','mseReferral':'Направление на МСЭ — решение и сведения','commissionMember1':'Первый член КЭК','commissionMember2':'Второй член КЭК','commissionMember3':'Третий член КЭК','commissionMember4':'Четвёртый член КЭК','sickLeaveDays':'Дней по листку нетрудоспособности','inpatientTreatment':'Лечение стационарно','outpatientTreatment':'Лечение амбулаторно','anamnesis':'Анамнез','objectiveStatus':'Объективные данные — представление','investigationDynamics':'Обследование в динамике','workPrognosis':'Трудовой прогноз','cecPurpose':'Цель направления на КЭК'},
        'multilineFields':['complaints','cecObjectiveStatus','cecDiagnosis','cecDecision','incapacityDetails','mseReferral','inpatientTreatment','outpatientTreatment','anamnesis','objectiveStatus','investigationDynamics','workPrognosis','cecPurpose'],
        'fieldSections':{'fullName':'Представление на КЭК','documentNumber':'Заключение КЭК','commissionMember1':'Состав комиссии'},
        'manualFields':['complaints','cecObjectiveStatus','cecDiagnosis','cecDecision','incapacityDetails','mseReferral','commissionMember1','commissionMember2','commissionMember3','commissionMember4','sickLeaveDays','inpatientTreatment','outpatientTreatment','anamnesis','objectiveStatus','investigationDynamics','workPrognosis','cecPurpose'],
    }

def main():
    for kind,source in [('palliative',PALLIATIVE),('cec',CEC_DOC)]:assert hashlib.sha256(source.read_bytes()).hexdigest()==HASHES[kind]
    templates={};OUT.mkdir(parents=True,exist_ok=True)
    for kind,source in [('palliative',PALLIATIVE),('cec',OUT/'cec-reference.docx')]:
        with ZipFile(source) as archive:parts={name:archive.read(name) for name in archive.namelist()}
        before=dict(parts);root=E.fromstring(parts['word/document.xml'])
        metadata=(palliative if kind=='palliative' else cec)(root)
        for paragraph in root.xpath('//w:p',namespaces=NS):join_fields(paragraph)
        for element in root.xpath('//w:del|//w:commentRangeStart|//w:commentRangeEnd|//w:commentReference',namespaces=NS):element.getparent().remove(element)
        parts['word/document.xml']=helper['serialize'](root)
        helper['scrub_metadata'](parts)
        # A source Word attached-template link points to another workstation.
        # Remove it so opening the reusable document never contacts that path.
        changed={'word/document.xml','docProps/core.xml'}
        for name in list(parts):
            if not name.endswith('.rels'):continue
            rels=E.fromstring(parts[name]);external=[r for r in rels if r.get('TargetMode')=='External']
            if external:
                assert all(r.get('Type','').endswith('/attachedTemplate') for r in external)
                for rel in external:rels.remove(rel)
                parts[name]=helper['serialize'](rels);changed.add(name)
                settings=E.fromstring(parts['word/settings.xml'])
                for element in settings.xpath('//w:attachedTemplate',namespaces=NS):element.getparent().remove(element)
                parts['word/settings.xml']=helper['serialize'](settings);changed.add('word/settings.xml')
        for name in parts:
            if name not in changed:assert parts[name]==before[name],name
        fields=list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}',text(root))))
        assert set(fields)==set(re.findall(r'\{\{(\w+)\}\}',parts['word/document.xml'].decode()))
        templates[kind]={'extension':'docx','entries':helper['entries'](parts),'fields':fields,'preview':helper['preview'](root),'checkboxes':{},'sourceSha256':HASHES[kind],**metadata}
        with ZipFile(OUT/f'blank-{kind}.docx','w') as archive:
            for name,data in parts.items():archive.writestr(name,data)
    (ROOT/'commission-templates.js').write_text('Object.assign(globalThis.__FillBARSMedicalTemplates__, '+json.dumps(templates,ensure_ascii=False)+');\n',encoding='utf-8')
    print(json.dumps({kind:len(t['fields']) for kind,t in templates.items()}))

if __name__=='__main__':main()
