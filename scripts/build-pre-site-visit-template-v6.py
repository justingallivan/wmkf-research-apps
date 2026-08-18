#!/usr/bin/env python3
"""Build Pre-Site Visit template v6 with a zero-inset left value column."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import re


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "shared/templates/pre-site-visit/phase-ii-pre-site-visit-v5.docx"
OUTPUT = ROOT / "shared/templates/pre-site-visit/phase-ii-pre-site-visit-v6.docx"
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
LEFT_VALUE_COLUMN = 1
LEFT_VALUE_MARGIN = 0
RIGHT_AMOUNT_MARGIN = 144  # Preserve the intentional 0.1-inch amount inset.


def cells_in(xml: str) -> list[re.Match[str]]:
    return list(re.finditer(r"<w:tc(?:\s[^>]*)?>[\s\S]*?</w:tc>", xml))


def rows_in(xml: str) -> list[re.Match[str]]:
    return list(re.finditer(r"<w:tr(?:\s[^>]*)?>[\s\S]*?</w:tr>", xml))


def cell_text(cell: str) -> str:
    return "".join(re.findall(r"<w:t(?:\s[^>]*)?>([\s\S]*?)</w:t>", cell))


def table_text(table: str) -> str:
    return "".join(cell_text(match.group(0)) for match in cells_in(table))


def metadata_table(xml: str) -> re.Match[str]:
    matches = [
        match
        for match in re.finditer(r"<w:tbl(?:\s[^>]*)?>[\s\S]*?</w:tbl>", xml)
        if "Project Title" in table_text(match.group(0))
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one Project Title metadata table; found {len(matches)}")
    return matches[0]


def set_left_cell_margin(cell: str, margin: int) -> str:
    tc_pr_match = re.search(r"<w:tcPr(?:\s[^>]*)?>[\s\S]*?</w:tcPr>", cell)
    if not tc_pr_match:
        raise RuntimeError("Metadata value cell is missing table-cell properties")
    tc_pr = tc_pr_match.group(0)
    replacement = f'<w:left w:w="{margin}" w:type="dxa"/>'

    tc_mar_match = re.search(r"<w:tcMar(?:\s[^>]*)?>[\s\S]*?</w:tcMar>", tc_pr)
    if tc_mar_match:
        tc_mar = tc_mar_match.group(0)
        if re.search(r"<w:left(?:\s[^>]*)?/>", tc_mar):
            tc_mar = re.sub(r"<w:left(?:\s[^>]*)?/>", replacement, tc_mar, count=1)
        else:
            tc_mar = tc_mar.replace("</w:tcMar>", f"{replacement}</w:tcMar>")
        tc_pr = (
            f"{tc_pr[:tc_mar_match.start()]}"
            f"{tc_mar}"
            f"{tc_pr[tc_mar_match.end():]}"
        )
    else:
        tc_mar = f"<w:tcMar>{replacement}</w:tcMar>"
        insertion = re.search(r"<w:(?:textDirection|tcFitText|vAlign|hideMark)\b", tc_pr)
        index = insertion.start() if insertion else tc_pr.rfind("</w:tcPr>")
        if index < 0:
            raise RuntimeError("Metadata value cell has malformed table-cell properties")
        tc_pr = f"{tc_pr[:index]}{tc_mar}{tc_pr[index:]}"

    return f"{cell[:tc_pr_match.start()]}{tc_pr}{cell[tc_pr_match.end():]}"


def set_zero_paragraph_indent(paragraph: str) -> str:
    p_pr_match = re.search(r"<w:pPr(?:\s[^>]*)?>[\s\S]*?</w:pPr>", paragraph)
    zero_indent = '<w:ind w:left="0" w:firstLine="0"/>'
    if not p_pr_match:
        opening_match = re.match(r"<w:p(?:\s[^>]*)?>", paragraph)
        if not opening_match:
            raise RuntimeError("Metadata value cell contains a malformed paragraph")
        return (
            f"{paragraph[:opening_match.end()]}"
            f"<w:pPr>{zero_indent}</w:pPr>"
            f"{paragraph[opening_match.end():]}"
        )

    p_pr = p_pr_match.group(0)
    if re.search(r"<w:ind(?:\s[^>]*)?/>", p_pr):
        p_pr = re.sub(r"<w:ind(?:\s[^>]*)?/>", zero_indent, p_pr, count=1)
    else:
        insertion = re.search(r"<w:(?:contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b", p_pr)
        index = insertion.start() if insertion else p_pr.rfind("</w:pPr>")
        if index < 0:
            raise RuntimeError("Metadata value cell contains malformed paragraph properties")
        p_pr = f"{p_pr[:index]}{zero_indent}{p_pr[index:]}"

    return f"{paragraph[:p_pr_match.start()]}{p_pr}{paragraph[p_pr_match.end():]}"


def normalize_value_cell(cell: str) -> str:
    cell = set_left_cell_margin(cell, LEFT_VALUE_MARGIN)
    paragraphs = list(re.finditer(r"<w:p(?:\s[^>]*)?>[\s\S]*?</w:p>", cell))
    if not paragraphs:
        raise RuntimeError("Metadata value cell contains no paragraphs")
    for paragraph_match in reversed(paragraphs):
        updated = set_zero_paragraph_indent(paragraph_match.group(0))
        cell = (
            f"{cell[:paragraph_match.start()]}"
            f"{updated}"
            f"{cell[paragraph_match.end():]}"
        )
    return cell


def patch_metadata_table(table: str) -> str:
    original_text = table_text(table)
    rows = rows_in(table)
    if len(rows) != len(ROW_WIDTHS):
        raise RuntimeError(f"Expected {len(ROW_WIDTHS)} metadata rows; found {len(rows)}")

    for row_match in reversed(rows):
        row = row_match.group(0)
        cells = cells_in(row)
        if len(cells) not in (2, 4):
            raise RuntimeError(f"Expected 2 or 4 metadata cells in row; found {len(cells)}")
        value_match = cells[LEFT_VALUE_COLUMN]
        updated_value = normalize_value_cell(value_match.group(0))
        updated_row = (
            f"{row[:value_match.start()]}"
            f"{updated_value}"
            f"{row[value_match.end():]}"
        )
        table = (
            f"{table[:row_match.start()]}"
            f"{updated_row}"
            f"{table[row_match.end():]}"
        )

    if table_text(table) != original_text:
        raise RuntimeError("Value-column patch unexpectedly changed table text")
    return table


def patch_document_xml(xml: str) -> str:
    match = metadata_table(xml)
    updated_table = patch_metadata_table(match.group(0))
    return f"{xml[:match.start()]}{updated_table}{xml[match.end():]}"


def cell_widths(row: str) -> tuple[tuple[int, str], ...]:
    widths = []
    for cell_match in cells_in(row):
        width = re.search(
            r'<w:tcW\b[^>]*w:w="(\d+)"[^>]*w:type="([^"]+)"[^>]*/>',
            cell_match.group(0),
        )
        if not width:
            raise RuntimeError("Built metadata cell is missing a canonical width")
        widths.append((int(width.group(1)), width.group(2)))
    return tuple(widths)


def left_cell_margin(cell: str) -> int | None:
    tc_mar = re.search(r"<w:tcMar(?:\s[^>]*)?>[\s\S]*?</w:tcMar>", cell)
    if not tc_mar:
        return None
    left = re.search(r'<w:left\b[^>]*w:w="(\d+)"[^>]*w:type="dxa"[^>]*/>', tc_mar.group(0))
    return int(left.group(1)) if left else None


def verify_document_xml(source_xml: str, built_xml: str) -> None:
    source_table = metadata_table(source_xml).group(0)
    built_table = metadata_table(built_xml).group(0)
    if table_text(built_table) != table_text(source_table):
        raise RuntimeError("Built template changed metadata table text")
    if f'<w:tblW w:w="{TABLE_WIDTH}" w:type="dxa"/>' not in built_table:
        raise RuntimeError("Built metadata table lost its fixed total width")
    if '<w:tblLayout w:type="fixed"/>' not in built_table:
        raise RuntimeError("Built metadata table lost its fixed layout")

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

    rows = [match.group(0) for match in rows_in(built_table)]
    actual_row_widths = tuple(
        tuple(width for width, width_type in cell_widths(row) if width_type == "dxa")
        for row in rows
    )
    if actual_row_widths != ROW_WIDTHS:
        raise RuntimeError(f"Unexpected metadata row widths: {actual_row_widths}")
    if any(width_type != "dxa" for row in rows for _width, width_type in cell_widths(row)):
        raise RuntimeError("Built metadata table retained a non-DXA cell width")

    for row in rows:
        cells = [match.group(0) for match in cells_in(row)]
        value_cell = cells[LEFT_VALUE_COLUMN]
        if left_cell_margin(value_cell) != LEFT_VALUE_MARGIN:
            raise RuntimeError("Built left value column retained a nonzero cell inset")
        paragraphs = re.findall(r"<w:p(?:\s[^>]*)?>[\s\S]*?</w:p>", value_cell)
        if not paragraphs or any(
            not re.search(r'<w:ind\b[^>]*w:left="0"[^>]*w:firstLine="0"[^>]*/>', paragraph)
            for paragraph in paragraphs
        ):
            raise RuntimeError("Built left value column retained a nonzero paragraph indent")

    cells = [match.group(0) for match in cells_in(built_table)]
    for placeholder in (
        "DV:RequestedAmount",
        "DV:InvitedAmount",
        "DV:TotalProjectBudget",
    ):
        matches = [cell for cell in cells if placeholder in cell]
        if len(matches) != 1 or left_cell_margin(matches[0]) != RIGHT_AMOUNT_MARGIN:
            raise RuntimeError(f"Built template changed the intentional inset for {placeholder}")

    recommendation_labels = [cell for cell in cells if cell_text(cell) == "Recommendation"]
    if len(recommendation_labels) != 1 or "<w:noWrap/>" not in recommendation_labels[0]:
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
