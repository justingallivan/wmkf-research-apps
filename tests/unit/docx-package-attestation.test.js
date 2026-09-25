/**
 * @jest-environment node
 */
/**
 * docx-package-attestation.js: part-by-part attestation of a downloaded DOCX
 * against a fresh render, normalizing only SharePoint's characterized
 * property promotion (live-run 2026-09-24).
 */
import JSZip from 'jszip';
import { attestDocxPackageAgainstRender } from '../../lib/services/test-requests/docx-package-attestation.js';
import { renderInitialAssessmentDocx } from '../../lib/services/initial-assessment/template.js';
import { SYNTHETIC_GENERATED } from '../../lib/services/test-requests/fixtures/initial-assessment-synthetic.js';

const ARGS = { requestNumber: '1000342', title: 'TEST: attestation', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED };
async function withParts(bytes, mutate) {
  const zip = await JSZip.loadAsync(bytes);
  await mutate(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const SP_SCHEMA = '<?xml version="1.0" encoding="utf-8"?><ct:contentTypeSchema ct:_="" ma:_="" xmlns:ct="http://schemas.microsoft.com/office/2006/metadata/contentType"></ct:contentTypeSchema>';
const SP_FORMS = '<?mso-contentType?><FormTemplates xmlns="http://schemas.microsoft.com/sharepoint/v3/contenttype/forms"><Display>DocumentLibraryForm</Display></FormTemplates>';
const SP_DM = '<?xml version="1.0" encoding="utf-8"?><p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties"><documentManagement/></p:properties>';
const SP_PROPS = '<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{X}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>';
const SP_RELS = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>';

describe('attestDocxPackageAgainstRender', () => {
  let render;
  beforeAll(async () => { render = await renderInitialAssessmentDocx(ARGS); });

  it('accepts the render itself and an independent second render', async () => {
    await expect(attestDocxPackageAgainstRender(render, render)).resolves.toEqual({ normalizedParts: expect.arrayContaining(['docProps/core.xml']) });
    const again = await renderInitialAssessmentDocx(ARGS);
    await expect(attestDocxPackageAgainstRender(again, render)).resolves.toBeTruthy();
  });

  it('accepts the full SharePoint property-promotion shape observed live on 2026-09-24', async () => {
    const promoted = await withParts(render, async (zip) => {
      zip.file('customXml/item1.xml', SP_SCHEMA); zip.file('customXml/item2.xml', SP_FORMS); zip.file('customXml/item3.xml', SP_DM);
      for (const n of [1, 2, 3]) { zip.file(`customXml/itemProps${n}.xml`, SP_PROPS); zip.file(`customXml/_rels/item${n}.xml.rels`, SP_RELS.replace('itemProps1', `itemProps${n}`)); }
      zip.file('[trash]/0000.dat', Buffer.alloc(8)); zip.file('[trash]/0001.dat', Buffer.alloc(8));
      zip.file('docProps/custom.xml', '<Properties/>'); zip.file('docProps/core.xml', '<cp:coreProperties/>');
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId50" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>'));
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace('</Types>', '<Default Extension="dat" ContentType="application/octet-stream"/><Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'));
    });
    const result = await attestDocxPackageAgainstRender(promoted, render);
    expect(result.normalizedParts).toEqual(expect.arrayContaining(['customXml/item1.xml', '[trash]/0000.dat', 'word/_rels/document.xml.rels', '[Content_Types].xml']));
  });

  const rejects = async (mutate, pattern) => {
    const bytes = await withParts(render, mutate);
    await expect(attestDocxPackageAgainstRender(bytes, render)).rejects.toThrow(pattern);
  };

  it('rejects a foreign customXml item that is not a SharePoint root', () => rejects(async (zip) => { zip.file('customXml/item9.xml', '<payload xmlns="urn:foreign"/>'); }, /customXml\/item9\.xml is not a SharePoint property-promotion item/));
  it('rejects a customXml part outside the SharePoint naming pattern', () => rejects(async (zip) => { zip.file('customXml/foreign-payload.xml', '<x/>'); }, /unexpected part customXml\/foreign-payload\.xml/));
  it('rejects a customXml props part that is not a datastore item', () => rejects(async (zip) => { zip.file('customXml/itemProps4.xml', '<other/>'); }, /itemProps4\.xml is not a SharePoint datastore item/));
  it('rejects a customXml rels part carrying a non-customXmlProps relationship', () => rejects(async (zip) => { zip.file('customXml/_rels/item4.xml.rels', SP_RELS.replace('customXmlProps', 'hyperlink')); }, /non-customXmlProps relationship/));
  it('rejects an extra document relationship that is not customXml', () => rejects(async (zip) => {
    const rels = await zip.file('word/_rels/document.xml.rels').async('string');
    zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId77" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/x.bin"/></Relationships>'));
  }, /rId77 .* is not a SharePoint customXml relationship/));
  it('rejects a missing document relationship', () => rejects(async (zip) => { zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'); }, /is missing/));
  it('rejects an extra content-type override outside customXml', () => rejects(async (zip) => {
    const ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/word/embeddings/x.bin" ContentType="application/octet-stream"/></Types>'));
  }, /content-type override \/word\/embeddings\/x\.bin is not a SharePoint customXml part/));
  it('rejects a changed word/ part', () => rejects(async (zip) => { const d = await zip.file('word/document.xml').async('string'); zip.file('word/document.xml', d.replace('</w:body>', '<w:p/></w:body>')); }, /part word\/document\.xml differs from the render/));
  it('rejects a foreign part anywhere else', () => rejects(async (zip) => { zip.file('word/media/hidden.bin', Buffer.alloc(4)); }, /unexpected part word\/media\/hidden\.bin/));
  it('rejects a missing word/ part', () => rejects(async (zip) => { zip.remove('word/styles.xml'); }, /part word\/styles\.xml is missing/));
  it('rejects a changed docProps/app.xml (SharePoint promotion leaves it untouched)', () => rejects(async (zip) => { zip.file('docProps/app.xml', '<Properties/>'); }, /part docProps\/app\.xml differs from the render/));
});
