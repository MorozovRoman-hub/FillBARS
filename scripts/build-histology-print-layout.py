"""Package Word's filtered HTML export of the blank histology DOCX."""
import json
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/artifacts/histology-540'
helpers = runpy.run_path(str(ROOT / 'scripts/build-print-layouts.py'))
clean = helpers['clean_word_html']
clean.__globals__['REFS'] = OUT
clean.__globals__['PAGES']['histology'] = 2
template_source = (ROOT/'histology-template.js').read_text(encoding='utf-8')
template = json.loads(template_source[template_source.index('{'):template_source.rindex('}')+1])['histology']
layout = clean('histology', template)
layout['html'] = layout['html'].replace('</head>', '<style>table tr:not(:first-child){height:4.5mm}table td p{min-height:1em}[data-fillbars-field]{white-space:pre-wrap}</style></head>', 1)
(ROOT/'histology-print-layout.js').write_text('Object.assign(globalThis.__FillBARSMedicalPrintLayouts__, '+json.dumps({'histology':layout},ensure_ascii=False)+');\n',encoding='utf-8')
print('Histology source layout packaged:',len(layout['html']),'characters')
