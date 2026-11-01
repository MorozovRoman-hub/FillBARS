"""Extract editable, patient-free operation narrative drafts from local DOCX examples.

Only explicit description spans are included; headers, numbers, staff and signatures
are never copied into the extension. Every draft requires clinical review.
"""
import json
import re
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'РВ'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def extract(path):
    with ZipFile(path) as archive:
        root = etree.fromstring(archive.read('word/document.xml'))
    text = ' '.join(''.join(p.xpath('.//w:t/text()', namespaces=NS)) for p in root.xpath('//w:body//w:p', namespaces=NS))
    text = re.sub(r'\s+', ' ', text).strip()
    title = re.search(r'Название\s*:\s*(.+?)\s+Оператор\s*:', text, re.I)
    start = re.search(r'После обработки операционного поля\b', text, re.I)
    if not title or not start: return None
    body = text[start.start():]
    end = re.search(r'\s+(?:Оператор|Ассистент)\s*:', body, re.I)
    if end: body = body[:end.start()]
    repeated = re.search(r'\s+Операция\s*№', body, re.I)
    if repeated: body = body[:repeated.start()]
    title = title.group(1).strip(' .')
    body = body.strip()
    if not (25 <= len(title) <= 300 and 120 <= len(body) <= 7000): return None
    forbidden = [r'\b[А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.[А-ЯЁ]\.', r'\b\d{2}\.\d{2}\.\d{2,4}\b', r'\b(?:ФИО|пациент|история болезни)\b']
    if any(re.search(pattern, title+' '+body, re.I) for pattern in forbidden): return None
    return {'name': title, 'text': body}

def main():
    templates=[]; seen=set()
    for path in sorted(SOURCE.glob('*.docx')):
        item = extract(path)
        if not item or item['name'].casefold() in seen: continue
        seen.add(item['name'].casefold());templates.append(item)
    # Curated additions live outside the generated JS so rebuilding preserves them.
    additions = json.loads((ROOT / 'scripts' / 'operation-drafts.json').read_text(encoding='utf-8'))
    for item in additions:
        assert set(item) == {'name', 'text'} and len(item['text']) > 100, 'Invalid operation draft'
        if item['name'].casefold() in seen: continue
        seen.add(item['name'].casefold());templates.append(item)
    assert templates, 'No safe operation texts found'
    output = ROOT / 'operation-catalog.js'
    output.write_text('globalThis.__FillBARSOperationCatalog__ = '+json.dumps(templates,ensure_ascii=False)+';\n',encoding='utf-8')
    print(f'Built {len(templates)} operation drafts from {len(list(SOURCE.glob("*.docx")))} DOCX references')

if __name__ == '__main__': main()
