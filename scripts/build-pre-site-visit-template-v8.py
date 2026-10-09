#!/usr/bin/env python3
"""Build v8 from v7 with the owner's 12pt space after the city/state line."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'shared/templates/pre-site-visit/phase-ii-pre-site-visit-v7.docx'
OUTPUT = ROOT / 'shared/templates/pre-site-visit/phase-ii-pre-site-visit-v8.docx'
DOCUMENT_XML = 'word/document.xml'


def main():
    with ZipFile(SOURCE) as source:
        entries = [(info, source.read(info.filename)) for info in source.infolist()]
    xml = next(data for info, data in entries if info.filename == DOCUMENT_XML).decode('utf-8')
    paragraphs = [p for p in re.finditer(r'<w:p(?:\s[^>]*)?>[\s\S]*?</w:p>', xml)
                  if '[[DV:CityState]]' in p.group()]
    if len(paragraphs) != 1:
        raise RuntimeError('Expected one intact city/state placeholder paragraph')
    match = paragraphs[0]
    paragraph = match.group()
    if '<w:spacing' in paragraph or '<w:pPr>' not in paragraph:
        raise RuntimeError('Unexpected v7 city/state paragraph properties')
    updated = paragraph.replace('<w:pPr>', '<w:pPr><w:spacing w:after="240"/>', 1)
    built = (xml[:match.start()] + updated + xml[match.end():]).encode('utf-8')
    with ZipFile(OUTPUT, 'w', compression=ZIP_DEFLATED, compresslevel=9) as output:
        for info, data in entries:
            output.writestr(info, built if info.filename == DOCUMENT_XML else data)
    with ZipFile(OUTPUT) as output:
        for info, data in entries:
            expected = built if info.filename == DOCUMENT_XML else data
            if output.read(info.filename) != expected:
                raise RuntimeError(f'Unexpected change in {info.filename}')
    print(f'Built {OUTPUT.relative_to(ROOT)} from {SOURCE.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
