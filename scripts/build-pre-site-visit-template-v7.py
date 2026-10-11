#!/usr/bin/env python3
"""Build v7 from v6: remove the title, move PAGE, and add request footers.

Patch only the body/header/footer XML, preserving every other package part.
Consolidate existing split tokens so each placeholder occupies one text run.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from collections import Counter
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'shared/templates/pre-site-visit/phase-ii-pre-site-visit-v6.docx'
OUTPUT = ROOT / 'shared/templates/pre-site-visit/phase-ii-pre-site-visit-v7.docx'
PARAGRAPH = r'<w:p(?:\s[^>]*)?>[\s\S]*?</w:p>'
TEXT = r'<w:t(?:\s[^>]*)?>([\s\S]*?)</w:t>'
TOKEN = r'\[\[(?:AI|DV|STAFF):[^\]]+\]\]'


def text(xml):
    return ''.join(re.findall(TEXT, xml))


def consolidate_tokens(paragraph):
    # Retain the first run's formatting and all non-token text/markup.
    for token in re.findall(TOKEN, text(paragraph)):
        nodes = list(re.finditer(TEXT, paragraph))
        logical = text(paragraph)
        start = logical.index(token)
        end = start + len(token)
        offset = 0
        edits = []
        for node in nodes:
            value = node.group(1)
            node_end = offset + len(value)
            if offset < end and node_end > start:
                before = value[:max(0, start - offset)]
                after = value[max(0, end - offset):]
                replacement = before + (token if offset <= start else '') + after
                edits.append((node.start(1), node.end(1), replacement))
            offset = node_end
        for start, end, replacement in reversed(edits):
            paragraph = paragraph[:start] + replacement + paragraph[end:]
    return paragraph


def patch(name, xml):
    if name == 'word/document.xml':
        matches = [p for p in re.finditer(PARAGRAPH, xml)
                   if text(p.group()) == '[[DV:InternalProgram]] - Phase II Review']
        if len(matches) != 1:
            raise RuntimeError('Expected exactly one program/title paragraph')
        p = matches[0]
        xml = xml[:p.start()] + xml[p.end():]
    elif name == 'word/header2.xml':
        paragraphs = list(re.finditer(PARAGRAPH, xml))
        title = next(p.group() for p in paragraphs if text(p.group()) == 'Phase II Review')
        page = next(p.group() for p in paragraphs if '<w:instrText>PAGE</w:instrText>' in p.group())
        page_runs = page[page.index('</w:pPr>') + len('</w:pPr>'):page.rindex('</w:p>')]
        title_prefix = title[:title.index('</w:pPr>') + len('</w:pPr>')]
        xml = xml.replace(title, title_prefix + page_runs + '</w:p>', 1)
        xml = xml.replace(page, '', 1)
    elif re.fullmatch(r'word/footer\d+\.xml', name):
        paragraphs = re.findall(PARAGRAPH, xml)
        if len(paragraphs) != 1 or text(paragraphs[0]):
            raise RuntimeError(f'Expected an empty footer: {name}')
        footer = ('<w:p><w:pPr><w:pStyle w:val="Footer"/>'
                  '<w:jc w:val="right"/></w:pPr><w:r><w:rPr>'
                  '<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>'
                  '<w:t>[[DV:InternalProgram]]: Request #[[DV:RequestNumber]]</w:t>'
                  '</w:r></w:p>')
        xml = xml.replace(paragraphs[0], footer, 1)
    return re.sub(PARAGRAPH, lambda m: consolidate_tokens(m.group()), xml)


def main():
    with ZipFile(SOURCE) as source:
        entries = [(info, source.read(info.filename)) for info in source.infolist()]
    original_tokens = Counter()
    built_tokens = Counter()
    patched = {}
    for info, data in entries:
        name = info.filename
        if name == 'word/document.xml' or re.fullmatch(r'word/(?:header|footer)\d+\.xml', name):
            xml = data.decode('utf-8')
            original_tokens.update(re.findall(TOKEN, text(xml)))
            xml = patch(name, xml)
            ET.fromstring(xml)
            logical_tokens = re.findall(TOKEN, text(xml))
            run_tokens = [token for run in re.findall(r'<w:r(?:\s[^>]*)?>[\s\S]*?</w:r>', xml)
                          for token in re.findall(TOKEN, text(run))]
            if Counter(logical_tokens) != Counter(run_tokens):
                raise RuntimeError(f'Split placeholder in {name}')
            if 'Phase II Review' in text(xml):
                raise RuntimeError(f'Title survived in {name}')
            built_tokens.update(logical_tokens)
            patched[name] = xml.encode('utf-8')
    expected = original_tokens.copy()
    expected['[[DV:InternalProgram]]'] += 2  # Removed body occurrence; three footers.
    expected['[[DV:RequestNumber]]'] = 3
    if built_tokens != expected:
        raise RuntimeError(f'Placeholder mismatch: {built_tokens - expected}, {expected - built_tokens}')
    with ZipFile(OUTPUT, 'w', compression=ZIP_DEFLATED, compresslevel=9) as output:
        for info, data in entries:
            output.writestr(info, patched.get(info.filename, data))
    with ZipFile(OUTPUT) as output:
        for info, data in entries:
            if output.read(info.filename) != patched.get(info.filename, data):
                raise RuntimeError(f'Package part changed unexpectedly: {info.filename}')
    print(f'Built {OUTPUT.relative_to(ROOT)} from {SOURCE.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
