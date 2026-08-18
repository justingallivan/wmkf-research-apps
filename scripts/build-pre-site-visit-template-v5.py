#!/usr/bin/env python3
"""Build Pre-Site Visit template v5 with fixed first-page metadata columns."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import re


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "shared/templates/pre-site-visit/phase-ii-pre-site-visit-v4.docx"
OUTPUT = ROOT / "shared/templates/pre-site-visit/phase-ii-pre-site-visit-v5.docx"
DOCUMENT_XML = "word/document.xml"

TABLE_WIDTH = 10080  # 7 inches
COLUMN_WIDTHS = (2160, 4090, 2520, 1310)  # 1.5", 2.84", 1.75", 0.91"
ROW_WIDTHS = (
    (2160, 7920),
    COLUMN_WIDTHS,
    COLUMN_WIDTHS,
    COLUMN_WIDTHS,
    COLUMN_WIDTHS,
)


def cell_text(cell: str) -> str:
    return "".join(re.findall(r"<w:t(?:\s[^>]*)?>([\s\S]*?)</w:t>", cell))


def table_text(table: str) -> str:
    return "".join(cell_text(cell) for cell in re.findall(
        r"<w:tc(?:\s[^>]*)?>[\s\S]*?</w:tc>", table,
    ))


def metadata_table(xml: str) -> re.Match[str]:
    matches = [
        match
        for match in re.finditer(r"<w:tbl(?:\s[^>]*)?>[\s\S]*?</w:tbl>", xml)
        if "Project Title" in table_text(match.group(0))
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one Project Title metadata table; found {len(matches)}")
    return matches[0]


def set_cell_width(cell: str, width: int) -> str:
    replacement = f'<w:tcW w:w="{width}" w:type="dxa"/>'
    updated, count = re.subn(r"<w:tcW(?:\s[^>]*)?/>", replacement, cell, count=1)
    if count != 1:
        raise RuntimeError("Metadata cell is missing its width declaration")
    return updated


def set_row_widths(row: str, widths: tuple[int, ...]) -> str:
    cells = list(re.finditer(r"<w:tc(?:\s[^>]*)?>[\s\S]*?</w:tc>", row))
    if len(cells) != len(widths):
        raise RuntimeError(
            f"Expected {len(widths)} metadata cells in row; found {len(cells)}"
        )
    output = row
    for cell_match, width in reversed(list(zip(cells, widths))):
        updated_cell = set_cell_width(cell_match.group(0), width)
        output = (
            f"{output[:cell_match.start()]}"
            f"{updated_cell}"
            f"{output[cell_match.end():]}"
        )
    return output


def patch_metadata_table(table: str) -> str:
    original_text = table_text(table)

    table, count = re.subn(
        r"<w:tblW(?:\s[^>]*)?/>",
        f'<w:tblW w:w="{TABLE_WIDTH}" w:type="dxa"/>',
        table,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Metadata table is missing its width declaration")

    if re.search(r"<w:tblLayout(?:\s[^>]*)?/>", table):
        table = re.sub(
            r"<w:tblLayout(?:\s[^>]*)?/>",
            '<w:tblLayout w:type="fixed"/>',
            table,
            count=1,
        )
    else:
        table, count = re.subn(
            r"</w:tblPr>",
            '<w:tblLayout w:type="fixed"/></w:tblPr>',
            table,
            count=1,
        )
        if count != 1:
            raise RuntimeError("Metadata table is missing table properties")

    grid = "<w:tblGrid>" + "".join(
        f'<w:gridCol w:w="{width}"/>' for width in COLUMN_WIDTHS
    ) + "</w:tblGrid>"
    table, count = re.subn(
        r"<w:tblGrid(?:\s[^>]*)?>[\s\S]*?</w:tblGrid>",
        grid,
        table,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Metadata table is missing its column grid")

    rows = list(re.finditer(r"<w:tr(?:\s[^>]*)?>[\s\S]*?</w:tr>", table))
    if len(rows) != len(ROW_WIDTHS):
        raise RuntimeError(f"Expected {len(ROW_WIDTHS)} metadata rows; found {len(rows)}")
    for row_match, widths in reversed(list(zip(rows, ROW_WIDTHS))):
        updated_row = set_row_widths(row_match.group(0), widths)
        table = (
            f"{table[:row_match.start()]}"
            f"{updated_row}"
            f"{table[row_match.end():]}"
        )

    if table_text(table) != original_text:
        raise RuntimeError("Metadata geometry patch unexpectedly changed table text")
    return table


def patch_document_xml(xml: str) -> str:
    match = metadata_table(xml)
    updated_table = patch_metadata_table(match.group(0))
    return f"{xml[:match.start()]}{updated_table}{xml[match.end():]}"


def cell_widths(row: str) -> tuple[tuple[int, str], ...]:
    widths = []
    for cell in re.findall(r"<w:tc(?:\s[^>]*)?>[\s\S]*?</w:tc>", row):
        width = re.search(r'<w:tcW\b[^>]*w:w="(\d+)"[^>]*w:type="([^"]+)"[^>]*/>', cell)
        if not width:
            raise RuntimeError("Built metadata cell is missing a canonical width")
        widths.append((int(width.group(1)), width.group(2)))
    return tuple(widths)


def verify_document_xml(source_xml: str, built_xml: str) -> None:
    source_table = metadata_table(source_xml).group(0)
    built_table = metadata_table(built_xml).group(0)
    if table_text(built_table) != table_text(source_table):
        raise RuntimeError("Built template changed metadata table text")
    if f'<w:tblW w:w="{TABLE_WIDTH}" w:type="dxa"/>' not in built_table:
        raise RuntimeError("Built metadata table is missing its fixed total width")
    if '<w:tblLayout w:type="fixed"/>' not in built_table:
        raise RuntimeError("Built metadata table is not fixed-layout")

    grid_match = re.search(
        r"<w:tblGrid(?:\s[^>]*)?>([\s\S]*?)</w:tblGrid>", built_table,
    )
    if not grid_match:
        raise RuntimeError("Built metadata table is missing its column grid")
    grid_widths = tuple(
        int(width)
        for width in re.findall(r'<w:gridCol\b[^>]*w:w="(\d+)"[^>]*/>', grid_match.group(1))
    )
    if grid_widths != COLUMN_WIDTHS or sum(grid_widths) != TABLE_WIDTH:
        raise RuntimeError(f"Unexpected metadata column grid: {grid_widths}")

    rows = re.findall(r"<w:tr(?:\s[^>]*)?>[\s\S]*?</w:tr>", built_table)
    actual_row_widths = tuple(
        tuple(width for width, width_type in cell_widths(row) if width_type == "dxa")
        for row in rows
    )
    if actual_row_widths != ROW_WIDTHS:
        raise RuntimeError(f"Unexpected metadata row widths: {actual_row_widths}")
    if any(width_type != "dxa" for row in rows for _width, width_type in cell_widths(row)):
        raise RuntimeError("Built metadata table retained a non-DXA cell width")

    label_cells = [
        cell
        for cell in re.findall(r"<w:tc(?:\s[^>]*)?>[\s\S]*?</w:tc>", built_table)
        if cell_text(cell) == "Recommendation"
    ]
    if len(label_cells) != 1 or "<w:noWrap/>" not in label_cells[0]:
        raise RuntimeError("Built template lost Recommendation no-wrap formatting")
    if "[[STAFF:Recommendation]]" not in table_text(built_table):
        raise RuntimeError("Built template lost the Recommendation placeholder")


def main() -> None:
    with ZipFile(SOURCE, "r") as source:
        entries = [(info, source.read(info.filename)) for info in source.infolist()]
    names = [info.filename for info, _data in entries]
    if names.count(DOCUMENT_XML) != 1:
        raise RuntimeError("Template package must contain exactly one word/document.xml")

    source_xml = next(data for info, data in entries if info.filename == DOCUMENT_XML).decode("utf-8")
    built_xml = patch_document_xml(source_xml)
    verify_document_xml(source_xml, built_xml)

    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=9) as output:
        for info, data in entries:
            output.writestr(
                info,
                built_xml.encode("utf-8") if info.filename == DOCUMENT_XML else data,
            )

    with ZipFile(OUTPUT, "r") as built:
        built_entries = {info.filename: built.read(info.filename) for info in built.infolist()}
    for info, data in entries:
        if info.filename != DOCUMENT_XML and built_entries.get(info.filename) != data:
            raise RuntimeError(f"Built template changed unrelated package part: {info.filename}")
    verify_document_xml(source_xml, built_entries[DOCUMENT_XML].decode("utf-8"))

    print(f"Built {OUTPUT.relative_to(ROOT)} from {SOURCE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
