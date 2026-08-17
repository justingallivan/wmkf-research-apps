#!/usr/bin/env python3
"""Build Pre-Site Visit template v2 from v1 with Recommendation-cell padding."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import re


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "shared/templates/pre-site-visit/phase-ii-pre-site-visit-v1.docx"
OUTPUT = ROOT / "shared/templates/pre-site-visit/phase-ii-pre-site-visit-v2.docx"
DOCUMENT_XML = "word/document.xml"
LEFT_PADDING = '<w:tcMar><w:left w:w="144" w:type="dxa"/></w:tcMar>'


def patch_document_xml(xml: str) -> str:
    cells = list(re.finditer(r"<w:tc(?:\s[^>]*)?>[\s\S]*?</w:tc>", xml))
    matches = [cell for cell in cells if "STAFF:Recommendation" in cell.group(0)]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one Recommendation value cell; found {len(matches)}")

    match = matches[0]
    cell = match.group(0)
    if LEFT_PADDING in cell:
        raise RuntimeError("Recommendation value cell already has the v2 padding")
    if "<w:tcMar>" in cell:
        raise RuntimeError("Recommendation value cell has unexpected existing cell margins")
    updated_cell, count = re.subn(
        r"(<w:tcW(?:\s[^>]*)?/>)",
        rf"\1{LEFT_PADDING}",
        cell,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Recommendation value cell is missing its width declaration")
    return f"{xml[:match.start()]}{updated_cell}{xml[match.end():]}"


def main() -> None:
    with ZipFile(SOURCE, "r") as source:
        entries = [(info, source.read(info.filename)) for info in source.infolist()]
    names = [info.filename for info, _data in entries]
    if names.count(DOCUMENT_XML) != 1:
        raise RuntimeError("Template package must contain exactly one word/document.xml")

    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=9) as output:
        for info, data in entries:
            if info.filename == DOCUMENT_XML:
                data = patch_document_xml(data.decode("utf-8")).encode("utf-8")
            output.writestr(info, data)

    with ZipFile(OUTPUT, "r") as built:
        xml = built.read(DOCUMENT_XML).decode("utf-8")
        if xml.count(LEFT_PADDING) < 4:
            raise RuntimeError("Built template is missing expected metadata-value padding")
        if "[[STAFF:Recommendation]]" not in "".join(
            re.findall(r"<w:t(?:\s[^>]*)?>([\s\S]*?)</w:t>", xml)
        ):
            raise RuntimeError("Built template lost the Recommendation placeholder")

    print(f"Built {OUTPUT.relative_to(ROOT)} from {SOURCE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
