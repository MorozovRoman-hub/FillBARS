"""Regenerate only the oncology template's field styling from bundled OOXML."""
import base64
import importlib.util
import json
from pathlib import Path
from lxml import etree

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'medical-templates.js'
helper_path=ROOT/'scripts'/'build-medical-templates.py'
spec=importlib.util.spec_from_file_location('medical_template_builder',helper_path)
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
prefix='globalThis.__FillBARSMedicalTemplates__ = '
text=source.read_text(encoding='utf-8')
assert text.startswith(prefix)
templates=json.loads(text[len(prefix):].strip().rstrip(';'))
target=templates['oncology']
part=next(item for item in target['entries'] if item['name']=='word/document.xml')
root=etree.fromstring(base64.b64decode(part['data']))
helper.bold_placeholder_runs(root)
part['data']=base64.b64encode(helper.serialize(root)).decode('ascii')
target['preview']=helper.preview(root)
source.write_text(prefix+json.dumps(templates,ensure_ascii=False)+';\n',encoding='utf-8')
