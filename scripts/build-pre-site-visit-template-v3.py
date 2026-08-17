#!/usr/bin/env python3
"""Build Pre-Site Visit template v3 with a non-wrapping Recommendation label."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import re


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "shared/templates/pre-site-visit/phase-ii-pre-site-visit-v2.docx"
OUTPUT = ROOT / "shared/templates/pre-site-visit/phase-ii-pre-site-visit-v3.docx"
DOCUMENT_XML = "word/document.xml"
NO_WRAP = "<w:noWrap/>"


def cell_text(cell: str) -> str:
    return "".join(re.findall(r"<w:t(?:\s[^>]*)?>([\s\S]*?)</w:t>", cell))


def patch_document_xml(xml: str) -> str:
    cells = list(re.finditer(r"<w:tc(?:\s[^>]*)?>[\s\S]*?</w:tc>", xml))
    matches = [cell for cell in cells if cell_text(cell.group(0)) == "Recommendation"]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one Recommendation label cell; found {len(matches)}")

    match = matches[0]
    cell = match.group(0)
    if NO_WRAP in cell:
        raise RuntimeError("Recommendation label cell already has no-wrap formatting")
    updated_cell, count = re.subn(
        r"(<w:tcW(?:\s[^>]*)?/>)",
        rf"\1{NO_WRAP}",
        cell,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Recommendation label cell is missing its width declaration")
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
        cells = re.findall(r"<w:tc(?:\s[^>]*)?>[\s\S]*?</w:tc>", xml)
        label_cells = [cell for cell in cells if cell_text(cell) == "Recommendation"]
        if len(label_cells) != 1 or NO_WRAP not in label_cells[0]:
            raise RuntimeError("Built template is missing Recommendation no-wrap formatting")
        if "[[STAFF:Recommendation]]" not in cell_text("".join(cells)):
            raise RuntimeError("Built template lost the Recommendation placeholder")

    print(f"Built {OUTPUT.relative_to(ROOT)} from {SOURCE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
