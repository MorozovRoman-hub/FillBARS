"""Build scrubbed templates from local references. Never ships the reference files."""
import argparse
import base64
import hashlib
import json
import re
from copy import deepcopy
from difflib import SequenceMatcher
from pathlib import Path
from html import escape
from zipfile import ZipFile
from lxml import etree as E

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
NS = {'w': W, 's': S}
ROOT = Path(__file__).resolve().parents[1]
MAPS = {
 'oncology': (1, None, {
 12: '    01. Адрес и название учреждения, в котором заполнено извещение {{medicalOrganization}}',
 13: '    02. Извещение направлено в {{destination}}',
 14: '    03. Фамилия {{surname}} Имя {{firstName}} Отчество {{patronymic}} больного',
 15: '    04. Дата рождения: {{birthDate}}',
 17: '    06. Этническая группа {{ethnicGroup}}',
 18: '    07. Домашний адрес: {{registeredAddress}}',
 19: '        {{addressExtra}}',
 20: '        почтовый индекс {{postalCode}} телефон {{patientPhone}}',
 22: '    09. Профессиональная группа: {{professionalGroup}}',
 25: '        {{firstVisitDate}}',
 26: '    11. Дата установления диагноза: {{diagnosisDate}}',
 27: '    12. Порядковый номер данной злокачественной опухоли у больного {{tumorNumber}}',
 28: '    13. Локализация опухоли {{diagnosis}}',
 29: '    14. Морфологический тип опухоли {{morphology}}',
 30: '    15. Стадия опухолевого процесса по системе TNM: {{tnm}}',
 51: '    20. В какое медицинское учреждение направлен больной {{destination}}',
 52: '    21. Дата заполнения извещения: {{documentDate}}',
 53: '    Фамилия, инициалы, телефон врача, заполнившего извещение {{doctorName}} {{doctorPhone}}'
 }),
 'military': (2, None, {
 2: 'Ф.И.О. - звание больного {{fullName}}, {{rank}}',
 4: 'Прошел (ла) медицинское лечение (обследование) с {{startDate}} по',
 6: '{{endDate}} г.',
 8: 'С диагнозом {{diagnosis}}',
 10: 'В {{department}} {{medicalOrganization}}',
 12: 'Группа состояния здоровья {{healthGroup}}',
 18: 'Врач____________________________({{doctorName}})                        М.П.'
 }),
 'commission': (3, 40, {
 9: 'от {{documentDate}} г. № {{documentNumber}}',
 11: '1. Учреждение здравоохранения края: {{medicalOrganization}}',
 13: '2. Ф.И.О. больного: {{fullName}}',
 15: '3. Дата рождения: {{birthDate}}',
 16: '4. Код категории льготы: {{benefitCode}}',
 17: '5. СНИЛС: {{snils}}',
 18: '6. Номер и серия страхового полиса ОМС: {{policyNumber}}',
 19: '7. Документ, удостоверяющий личность больного (название, серия и номер, кем, когда выдан): {{passport}}',
 20: '8. Адрес регистрации по месту жительства, почтовый индекс, телефон: {{registeredAddress}} {{patientPhone}}',
 21: '9. Социальный статус, в т.ч. занятость: {{socialStatus}}',
 22: '10. Инвалидность: {{disability}}',
 23: '11. Место работы и должность: {{workPlace}}',
 24: '12. Диагноз, Код по МКБ-10: {{diagnosis}} {{icdCode}}',
 25: '13. Код профиля и вида ВМП: {{vmpCode}}',
 26: '14. Цель направления: {{purpose}}',
 27: '15. Характер заболевания: {{diseaseCourse}}',
 29: '{{destination}}',
 30: '17. Направление: {{referralKind}}',
 31: '18. Нуждается ли больной в сопровождении: {{escortNeeded}}',
 32: '19. Фамилия, имя, отчество сопровождающего, данные паспорта: {{escort}}',
 33: '20. Вид транспортировки больного (обоснование): {{transport}}',
 35: 'Лечащий врач {{doctorName}}',
 37: 'Заведующий отделением {{departmentHead}}',
 39: 'Председатель врачебной комиссии {{commissionChair}}'
 }),
 'referral': (4, 54, {
 0: '{{medicalOrganization}}', 2: '', 4: '', 6: '', 8: '{{organizationAddress}}',
 13: 'Код ОГРН {{ogrn}}',
 17: 'на {{purpose}}',
 19: '{{destination}}',
 22: '1. Номер страхового полиса ОМС {{policyNumber}}',
 25: '2. Код льготы {{benefitCode}}',
 30: '3. Фамилия, имя, отчество {{fullName}}',
 31: '4. Дата рождения {{birthDate}}',
 32: '5. Адрес постоянного места жительства {{registeredAddress}}',
 33: '6. Место работы, должность: {{workPlace}}',
 34: '8. Обоснование направления: {{referralReason}}',
 35: 'Должность медицинского работника, направившего больного {{doctorPosition}}',
 36: '{{doctorName}}', 40: '{{departmentHead}}', 43: '{{documentDate}} г.',
 48: '7. Код диагноза по МКБ {{icdCode}}'
 })
}
CELLS = dict(zip([f'C{i}' for i in [3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,22,23,24,25,26,27,28,29,30]],
 ['medicalOrganization','organizationAddress','adminRepresentative','department','doctorName','doctorPhone','documentDate',
  'surname','firstName','patronymic','passport','birthDate','policyNumber','insurer','snils','registeredAddress',
  'careSetting','requestType','purpose','consultationKind','specialty','diagnosis','concomitantDiagnosis','icdCode','attachments']))

def patch_text(p, replacement):
    original = ''.join(p.xpath('.//w:t/text()', namespaces=NS))
    for tag, a, b, c, d in reversed(SequenceMatcher(None, original, replacement, autojunk=False).get_opcodes()):
        if tag == 'equal': continue
        nodes = p.xpath('.//w:t', namespaces=NS)
        if not nodes:
            run = E.SubElement(p, f'{{{W}}}r'); nodes = [E.SubElement(run, f'{{{W}}}t')]
        pos = 0; inserted = False
        for node in nodes:
            text = node.text or ''; end = pos + len(text)
            if not inserted and pos <= a <= end:
                node.text = text[:a-pos] + replacement[c:d] + text[max(0,b-pos):] if b <= end else text[:a-pos] + replacement[c:d]
                inserted = True
            elif pos < b and end > a:
                node.text = text[max(0,b-pos):]
            node.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
            pos = end

def serialize(root): return E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)

def bold_placeholder_runs(root):
    """Split mixed source/field runs so only filled values are bold in Word."""
    from copy import deepcopy
    token = re.compile(r'(\{\{[A-Za-z][A-Za-z0-9]*\}\})')
    for node in list(root.xpath('//w:t[contains(text(),"{{")]', namespaces=NS)):
        pieces = [piece for piece in token.split(node.text or '') if piece]
        if len(pieces) == 1 and not token.fullmatch(pieces[0]):
            continue
        run = node.getparent()
        assert E.QName(run).localname == 'r' and len(run.xpath('./w:t', namespaces=NS)) == 1
        assert all(E.QName(child).localname in ('rPr', 't') for child in run)
        parent = run.getparent(); at = parent.index(run)
        for piece in pieces:
            clone = deepcopy(run)
            clone.xpath('./w:t', namespaces=NS)[0].text = piece
            if token.fullmatch(piece):
                props = clone.find('w:rPr', NS)
                if props is None:
                    props = E.Element(f'{{{W}}}rPr'); clone.insert(0, props)
                for bold in props.findall('w:b', NS): props.remove(bold)
                E.SubElement(props, f'{{{W}}}b')
            parent.insert(at, clone); at += 1
        parent.remove(run)

def entries(parts):
    return [{'name':n,'data':base64.b64encode(v).decode()} for n,v in parts.items()]

def preview(root):
    """Source-derived readable preview; native Office file owns precise pagination."""
    def render(el):
        tag=E.QName(el).localname
        if tag=='p':
            props=el.find('w:pPr',NS); css=[]
            if props is not None:
                align=props.find('w:jc',NS)
                if align is not None: css.append('text-align:'+{'both':'justify'}.get(align.get(f'{{{W}}}val'),align.get(f'{{{W}}}val')))
                spacing=props.find('w:spacing',NS)
                if spacing is not None:
                    for attr,prop in [('before','margin-top'),('after','margin-bottom')]:
                        if spacing.get(f'{{{W}}}{attr}'): css.append(prop+':'+str(int(spacing.get(f'{{{W}}}{attr}'))/20)+'pt')
            return '<p style="'+ ';'.join(css)+'">'+''.join(render(c) for c in el if E.QName(c).localname!='pPr')+'</p>'
        if tag=='r':
            css=[];props=el.find('w:rPr',NS)
            if props is not None:
                for attr,rule in [('b','font-weight:bold'),('i','font-style:italic'),('u','text-decoration:underline')]:
                    if props.find('w:'+attr,NS) is not None: css.append(rule)
                sz=props.find('w:sz',NS)
                if sz is not None: css.append('font-size:'+str(int(sz.get(f'{{{W}}}val'))/2)+'pt')
            return '<span style="'+';'.join(css)+'">'+''.join(render(c) for c in el if E.QName(c).localname!='rPr')+'</span>'
        if tag=='t': return escape(el.text or '')
        if tag=='tab': return '    '
        if tag=='br': return '<br>' if el.get(f'{{{W}}}type')!='page' else ''
        if tag in ['tbl','tr','tc']:
            htmltag={'tbl':'table','tr':'tr','tc':'td'}[tag]
            return '<'+htmltag+'>'+''.join(render(c) for c in el)+'</'+htmltag+'>'
        if tag.endswith('Pr') or tag in ['sectPr','drawing','pict']: return ''
        return ''.join(render(c) for c in el)
    return render(root.find('w:body',NS))

def scrub_metadata(parts):
    for name in list(parts):
        if name == 'docProps/core.xml':
            tree=E.fromstring(parts[name])
            # Empty dcterms:created/modified are invalid typed dates and Office rejects the package.
            for child in list(tree): tree.remove(child)
            parts[name]=serialize(tree)
        if name.startswith('docProps/thumbnail'):
            # Keep relationship valid but replace cached source preview with a blank image.
            from PIL import Image
            import io
            out=io.BytesIO(); Image.new('RGB',(1,1),'white').save(out,format='JPEG')
            parts[name]=out.getvalue()

def normalize_referral_order(root):
    """Keep item 7 between workplace and referral reason in every representation."""
    body = root.find('w:body', NS)
    paragraphs = body.xpath('.//w:p', namespaces=NS)
    def paragraph_with(token):
        matches = [p for p in paragraphs if token in ''.join(p.xpath('.//w:t/text()', namespaces=NS))]
        assert len(matches) == 1, f'Expected one referral paragraph for {token}'
        return matches[0]
    diagnosis = paragraph_with('{{icdCode}}')
    reason = paragraph_with('{{referralReason}}')
    while reason.getparent() is not body:
        reason = reason.getparent()
    assert diagnosis.getparent() is body, 'Referral item 7 must be a body paragraph'
    reason.addprevious(diagnosis)


def build(refs, workbook):
    templates={}; inventory={}
    for key,(number,limit,mapping) in MAPS.items():
        source=refs/f'source-{number}.docx'
        before=hashlib.sha256(source.read_bytes()).hexdigest()
        with ZipFile(source) as z: parts={n:z.read(n) for n in z.namelist()}
        inventory[key]={'sourceSha256':before, 'parts':{n:hashlib.sha256(v).hexdigest() for n,v in parts.items()}}
        root=E.fromstring(parts['word/document.xml']); body=root.find('w:body',NS)
        paragraphs=body.xpath('.//w:p',namespaces=NS)
        if limit:
            boundary=paragraphs[limit]
            while boundary.getparent() is not body: boundary=boundary.getparent()
            index=list(body).index(boundary)
            for child in list(body)[index:]:
                if child.tag != f'{{{W}}}sectPr': body.remove(child)
        for i,text in mapping.items(): patch_text(paragraphs[i],text)
        if key=='oncology':
            for i in [16,21,*range(31,51)]:
                for prop in paragraphs[i].xpath('.//w:b|.//w:u',namespaces=NS): prop.getparent().remove(prop)
        # Word keeps proofing/bookmark metadata; remove comments/revision text rather than exporting old PHI.
        for el in root.xpath('//w:del|//w:commentRangeStart|//w:commentRangeEnd|//w:commentReference',namespaces=NS): el.getparent().remove(el)
        assert not any(n.startswith(('customXml/','word/comments')) for n in parts), 'Private parts need explicit review'
        checkboxes={}
        if key=='oncology':
            for i,p in enumerate(paragraphs):
                options=''.join(p.xpath('.//w:t/text()',namespaces=NS)).split('□')[1:]
                for j,node in enumerate(p.xpath('.//w:t[contains(text(),"□")]',namespaces=NS)):
                    field=f'check{i}x{j}'; node.text=node.text.replace('□','{{'+field+'}}')
                    checkboxes[field]=options[j].strip(' -;,') if j<len(options) else field
            bold_placeholder_runs(root)
        if key=='referral':
            normalize_referral_order(root)
        parts['word/document.xml']=serialize(root);scrub_metadata(parts)
        html=preview(root)
        templates[key]={'extension':'docx','entries':entries(parts),'fields':list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}',E.tostring(root).decode()))),'preview':html,'checkboxes':checkboxes}
        with ZipFile(refs/f'blank-{key}.docx','w') as z:
            for n,v in parts.items(): z.writestr(n,v)
        assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    with ZipFile(workbook) as z: parts={n:z.read(n) for n in z.namelist()}
    original=dict(parts); strings=E.fromstring(parts['xl/sharedStrings.xml'])
    sheet=E.fromstring(parts['xl/worksheets/sheet1.xml'])
    formula_before=sheet.xpath('//s:f/text()|//s:formula1/text()|//s:formula2/text()',namespaces=NS)
    replaced_strings=set()
    for cell in sheet.xpath('//s:c',namespaces=NS):
        field=CELLS.get(cell.get('r'))
        if not field: continue
        assert cell.find('s:f',NS) is None, 'Never overwrite a formula cell'
        value=cell.find('s:v',NS)
        if cell.get('t')=='s' and value is not None: replaced_strings.add(int(value.text))
        for child in list(cell): cell.remove(child)
        cell.set('t','inlineStr'); inline=E.SubElement(cell,f'{{{S}}}is')
        E.SubElement(inline,f'{{{S}}}t').text='{{'+field+'}}'
    used={int(c.find('s:v',NS).text) for c in sheet.xpath('//s:c[@t="s"]',namespaces=NS)}
    for index in replaced_strings-used:
        for child in list(strings[index]): strings[index].remove(child)
        E.SubElement(strings[index],f'{{{S}}}t').text=''
    parts['xl/sharedStrings.xml']=serialize(strings);parts['xl/worksheets/sheet1.xml']=serialize(sheet)
    wb=E.fromstring(parts['xl/workbook.xml'])
    for el in wb.xpath('//*[local-name()="absPath"]'): el.getparent().remove(el)
    parts['xl/workbook.xml']=serialize(wb);scrub_metadata(parts)
    assert formula_before==sheet.xpath('//s:f/text()|//s:formula1/text()|//s:formula2/text()',namespaces=NS)
    options={}
    for validation in sheet.xpath('//s:dataValidation[@type="list"]',namespaces=NS):
        formula=validation.find('s:formula1',NS)
        field=CELLS.get(validation.get('sqref'))
        if field and formula is not None and (formula.text or '').startswith('"'):
            options[field]=formula.text.strip('"').split(',')
    templates['tmk']={'extension':'xlsx','entries':entries(parts),'fields':list(CELLS.values()),'dateCells':{'C9':'documentDate','C15':'birthDate'},'options':options}
    inventory['tmk']={'sourceSha256':hashlib.sha256(workbook.read_bytes()).hexdigest(),'formulas':formula_before,
        'preservedParts':[n for n in parts if parts[n]==original[n]]}
    (refs/'package-inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'medical-templates.js').write_text('globalThis.__FillBARSMedicalTemplates__ = '+json.dumps(templates,ensure_ascii=False)+';\n',encoding='utf-8')
    print('Built:', ', '.join(templates))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('references',type=Path);parser.add_argument('workbook',type=Path)
    args=parser.parse_args();build(args.references,args.workbook)
