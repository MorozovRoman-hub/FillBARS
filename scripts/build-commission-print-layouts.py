"""Package source Word HTML with CEC representation above conclusion on portrait A4."""
import json
import re
import runpy
from pathlib import Path
from lxml import html

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/artifacts/commission-541'
helpers=runpy.run_path(str(ROOT/'scripts/build-print-layouts.py'))
clean=helpers['clean_word_html']
clean.__globals__['REFS']=OUT
clean.__globals__['PAGES'].update({'palliative':1,'cec':1})
source=(ROOT/'commission-templates.js').read_text(encoding='utf-8')
templates=json.loads(source[source.index('{'):source.rindex('}')+1])
layouts={kind:clean(kind,t) for kind,t in templates.items()}
for layout in layouts.values():layout['html']=layout['html'].replace('</head>','<style>[data-fillbars-field]{white-space:pre-wrap}</style></head>',1)

doc=html.fromstring(layouts['cec']['html'])
section=doc.xpath('//div[@class="WordSection1"]')[0]
groups=[]
for child in list(section):
    if child.tag!='p':continue
    title=re.sub(r'\s+',' ',child.text_content()).strip()
    if title in ['ЗАКЛЮЧЕНИЕ КЭК','ПРЕДСТАВЛЕНИЕ НА КЭК']:groups.append([])
    assert groups
    for element in child.iter():
        if 'style' in element.attrib:
            element.attrib['style']=re.sub(r'(?:page|column)-break-before\s*:[^;]+;?','',element.attrib['style'],flags=re.I)
    groups[-1].append(child)
assert len(groups)==2
for child in list(section):section.remove(child)
sheet=html.Element('div',{'class':'cec-sheet'})
for group in groups:
    block=html.Element('section',{'class':'cec-section'})
    for child in group:block.append(child)
    sheet.append(block)
section.append(sheet)
style=html.Element('style')
style.text='''@page{size:A4 portrait;margin:10mm 12mm}
.WordSection1{width:auto!important;min-height:0!important;margin:0!important;padding:0!important;background:transparent!important;box-shadow:none!important}
.cec-sheet{box-sizing:border-box;display:block;width:210mm;min-height:297mm;padding:10mm 12mm;margin:0 auto 12mm;background:white;box-shadow:0 3px 15px #0002}
.cec-section{min-width:0}.cec-section p{overflow-wrap:anywhere}.cec-section+.cec-section{margin-top:4mm}
@media print{.cec-sheet{width:auto;min-height:0;padding:0;margin:0;box-shadow:none}}
'''
doc.find('head').append(style)
layouts['cec']['html']=html.tostring(doc,encoding='unicode')
assert set(re.findall(r'\{\{(\w+)\}\}',layouts['cec']['html']))==set(templates['cec']['fields'])
(ROOT/'commission-print-layouts.js').write_text('Object.assign(globalThis.__FillBARSMedicalPrintLayouts__, '+json.dumps(layouts,ensure_ascii=False)+');\n',encoding='utf-8')
print('Commission print layouts built:',{kind:len(layout['html']) for kind,layout in layouts.items()})
