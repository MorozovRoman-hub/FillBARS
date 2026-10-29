"""Measure black content bounding margins in A4 browser-print PDF fixtures."""
from pathlib import Path
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parent / 'artifacts' / 'medical-all-print-519'
MM_PER_PT = 25.4 / 72
expected_one_page = {'skt', 'military', 'oncology', 'operationProtocol'}
expected_centered = {'skt', 'military', 'oncology', 'operationProtocol'}
files = sorted(ROOT.glob('*.pdf'))
assert len(files) == 17, f'Expected 17 print fixtures, found {len(files)}'

for file in files:
    pdf = pdfium.PdfDocument(str(file))
    bounds = []
    for page in pdf:
        image = page.render(scale=1).to_pil().convert('L')
        box = image.point(lambda value: 255 if value < 160 else 0).getbbox()
        bounds.append(None if box is None else (
            round(box[0] * MM_PER_PT, 1),
            round((image.width - box[2]) * MM_PER_PT, 1),
            round(box[1] * MM_PER_PT, 1),
            round((image.height - box[3]) * MM_PER_PT, 1),
        ))
    print(file.stem, len(pdf), bounds[:3])
    assert all(bound is not None for bound in bounds), f'{file.stem}: blank print page'
    if file.stem in expected_one_page:
        assert len(pdf) == 1, f'{file.stem}: should fit one A4 page'
    if file.stem in expected_centered:
        left, right, *_ = bounds[0]
        assert min(left, right) >= 14, f'{file.stem}: content too near paper edge'
        assert abs(left - right) <= 3, f'{file.stem}: unequal side margins {left}/{right} mm'
