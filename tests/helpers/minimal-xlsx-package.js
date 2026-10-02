/**
 * A minimal XLSX-shaped OPC package built from scratch for the Test Request
 * Factory's package-integrity tests (no production bytes). It carries the
 * parts the package comparator inspects: content types, root relationships,
 * a workbook with its relationships, one worksheet and `docProps/custom.xml`.
 */
import JSZip from 'jszip';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const customProperty = (name, pid, value) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid}" name="${name}"><vt:lpwstr>${value}</vt:lpwstr></property>`;

export const customPropertiesXml = (...properties) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${properties.join('')}</Properties>`;

export async function buildMinimalXlsx({ custom, sheet = '<worksheet><sheetData/></worksheet>' }) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>');
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/custom-properties" Target="docProps/custom.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', '<workbook/>');
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', sheet);
  zip.file('docProps/custom.xml', custom);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** The source workbook, the same workbook after SharePoint adds one custom property, and a worksheet-tampered copy of that. */
export async function buildXlsxCopyFixtures() {
  const base = customPropertiesXml(customProperty('ContentTypeId', 2, '0x0101'));
  const promoted = customPropertiesXml(customProperty('ContentTypeId', 2, '0x0101'), customProperty('TaxKeyword', 3, 'sample'));
  return {
    source: await buildMinimalXlsx({ custom: base }),
    promoted: await buildMinimalXlsx({ custom: promoted }),
    tampered: await buildMinimalXlsx({ custom: promoted, sheet: '<worksheet><sheetData><row r="1"/></sheetData></worksheet>' }),
  };
}
