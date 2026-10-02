/**
 * A minimal XLSX-shaped OPC package built from scratch for the Test Request
 * Factory's package-integrity tests (no production bytes). It carries the
 * parts the package comparator inspects: content types, root relationships,
 * a workbook with its relationships, one worksheet and `docProps/custom.xml`.
 * Like a workbook that already lives in the SharePoint library, it also
 * carries `docProps/core.xml` and `app.xml`, one SharePoint customXml item
 * (item, props, rels, and the workbook relationship to it) and a
 * `[trash]/0000.dat` padding part; those are byte-identical on both sides of
 * a copy, so only `docProps/custom.xml` (and what a test changes) differs.
 */
import JSZip from 'jszip';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const customProperty = (name, pid, value) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid}" name="${name}"><vt:lpwstr>${value}</vt:lpwstr></property>`;

export const customPropertiesXml = (...properties) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${properties.join('')}</Properties>`;

export async function buildMinimalXlsx({ custom, sheet = '<worksheet><sheetData/></worksheet>' }) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="dat" ContentType="application/octet-stream"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>');
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/custom-properties" Target="docProps/custom.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId4" Type="${OFFICE_REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', '<workbook/>');
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/customXml" Target="../customXml/item1.xml"/></Relationships>`);
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Synthetic budget</dc:title><cp:lastModifiedBy>Un-named</cp:lastModifiedBy><dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-25T03:32:30Z</dcterms:modified></cp:coreProperties>');
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>');
  zip.file('customXml/item1.xml', '<?xml version="1.0" encoding="utf-8"?><ct:contentTypeSchema ct:_="" ma:_="" ma:contentTypeName="Document" xmlns:ct="http://schemas.microsoft.com/office/2006/metadata/contentType" xmlns:ma="http://schemas.microsoft.com/office/2006/metadata/properties/metaAttributes"></ct:contentTypeSchema>');
  zip.file('customXml/itemProps1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{11111111-2222-3333-4444-555555555555}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>');
  zip.file('customXml/_rels/item1.xml.rels', `<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OFFICE_REL}/customXmlProps" Target="itemProps1.xml"/></Relationships>`);
  zip.file('[trash]/0000.dat', Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.alloc(449)]));
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
