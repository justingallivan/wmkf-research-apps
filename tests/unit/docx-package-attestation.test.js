/**
 * @jest-environment node
 */
/**
 * docx-package-attestation.js: part-by-part attestation of a downloaded DOCX
 * against a fresh render, normalizing only SharePoint's characterized
 * property promotion (live-run 2026-09-24).
 */
import JSZip from 'jszip';
import {
  attestDocxPackageAgainstRender, attestDocxPackageAgainstSource,
  validateZipCentralDirectory, packagePartsBudgeted, DOCX_PACKAGE_BUDGET,
} from '../../lib/services/test-requests/docx-package-attestation.js';
import { renderInitialAssessmentDocx } from '../../lib/services/initial-assessment/template.js';
import { SYNTHETIC_GENERATED } from '../../lib/services/test-requests/fixtures/initial-assessment-synthetic.js';

const ARGS = { requestNumber: '1000342', title: 'TEST: attestation', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED };
async function withParts(bytes, mutate) {
  const zip = await JSZip.loadAsync(bytes);
  await mutate(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
// The live shape (matches tests/unit/test-request-run-runner-verify-initial-assessment.test.js): every prefix is declared.
const SP_SCHEMA = '<?xml version="1.0" encoding="utf-8"?><ct:contentTypeSchema ct:_="" ma:_="" ma:contentTypeName="Document" xmlns:ct="http://schemas.microsoft.com/office/2006/metadata/contentType" xmlns:ma="http://schemas.microsoft.com/office/2006/metadata/properties/metaAttributes"></ct:contentTypeSchema>';
const SP_FORMS = '<?mso-contentType?><FormTemplates xmlns="http://schemas.microsoft.com/sharepoint/v3/contenttype/forms"><Display>DocumentLibraryForm</Display><Edit>DocumentLibraryForm</Edit><New>DocumentLibraryForm</New></FormTemplates>';
const SP_DM = '<?xml version="1.0" encoding="utf-8"?><p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties"><documentManagement/></p:properties>';
const SP_PROPS = '<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{X}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>';
const SP_RELS = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>';

// Live docProps shapes (sandbox Request 1000342, 2026-09-25): SharePoint rewrites both on promotion.
const CORE_OK = (title = 'TITLE') => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>TITLE</dc:title><cp:lastModifiedBy>Un-named</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-25T03:32:30Z</dcterms:modified></cp:coreProperties>'.replace('TITLE', title);
const CUSTOM_OK = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ContentTypeId"><vt:lpwstr>0x0101003CC1047D46B85E46831D0019F23BD8E1</vt:lpwstr></property></Properties>';
/**
 * Add SharePoint-shaped customXml items N with their itemProps, rels, the
 * document relationship and the content-type override -- the closed graph
 * the attestor requires (Codex reviewer-differs-from-author re-review).
 */
async function promoteItems(zip, entries) {
  let rels = await zip.file('word/_rels/document.xml.rels').async('string');
  let ct = await zip.file('[Content_Types].xml').async('string');
  for (const [n, xml] of entries) {
    zip.file(`customXml/item${n}.xml`, xml);
    zip.file(`customXml/itemProps${n}.xml`, SP_PROPS);
    zip.file(`customXml/_rels/item${n}.xml.rels`, SP_RELS.replace('itemProps1', `itemProps${n}`));
    rels = rels.replace('</Relationships>', `<Relationship Id="rId5${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item${n}.xml"/></Relationships>`);
    ct = ct.replace('</Types>', `<Override PartName="/customXml/itemProps${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`);
  }
  zip.file('word/_rels/document.xml.rels', rels);
  zip.file('[Content_Types].xml', ct);
}
/** SharePoint's live `[trash]` padding shape (2026-09-25): four 0xFF bytes then zeros. */
const spTrash = (n) => Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.alloc(n - 4)]);

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
      await promoteItems(zip, [[1, SP_SCHEMA], [2, SP_FORMS], [3, SP_DM]]);
      zip.file('[trash]/0000.dat', spTrash(453)); zip.file('[trash]/0001.dat', spTrash(149));
      zip.file('docProps/custom.xml', CUSTOM_OK); zip.file('docProps/core.xml', CORE_OK('rewritten'));
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

describe('attestDocxPackageAgainstSource', () => {
  let render;
  let sourceWithOwnCustomXml;
  beforeAll(async () => {
    render = await renderInitialAssessmentDocx(ARGS);
    // An uploader-accepted source DOCX carrying its OWN, pre-existing custom
    // XML that is NOT one of SharePoint's characterized additions -- this is
    // exactly the case attestDocxPackageAgainstRender cannot handle (it would
    // root-match this part as if SharePoint had added it).
    sourceWithOwnCustomXml = await withParts(render, async (zip) => {
      zip.file('customXml/item1.xml', '<foreignTemplate xmlns="urn:example:uploader-tool">payload</foreignTemplate>');
    });
  });

  it('accepts an unchanged copy of a source carrying its own pre-existing custom XML', async () => {
    const result = await attestDocxPackageAgainstSource(sourceWithOwnCustomXml, sourceWithOwnCustomXml);
    expect(result.normalizedParts).toEqual(expect.arrayContaining(['customXml/item1.xml']));
  });

  it('accepts SharePoint property promotion layered on top of the source', async () => {
    const promoted = await withParts(sourceWithOwnCustomXml, async (zip) => {
      await promoteItems(zip, [[2, SP_SCHEMA]]);
      zip.file('docProps/core.xml', CORE_OK('rewritten'));
    });
    const result = await attestDocxPackageAgainstSource(promoted, sourceWithOwnCustomXml);
    expect(result.normalizedParts).toEqual(expect.arrayContaining(['customXml/item1.xml', 'customXml/item2.xml']));
  });

  it('rejects a mutation of the source\'s own pre-existing custom XML (never root-matched)', async () => {
    const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => {
      zip.file('customXml/item1.xml', '<foreignTemplate xmlns="urn:example:uploader-tool">TAMPERED</foreignTemplate>');
    });
    await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml))
      .rejects.toThrow(/part customXml\/item1\.xml differs from the source/);
  });

  it('rejects removal of the source\'s own pre-existing custom XML', async () => {
    const removed = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.remove('customXml/item1.xml'); });
    await expect(attestDocxPackageAgainstSource(removed, sourceWithOwnCustomXml))
      .rejects.toThrow(/part customXml\/item1\.xml is missing/);
  });

  it('rejects a changed word/ part relative to the source', async () => {
    const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => {
      const d = await zip.file('word/document.xml').async('string');
      zip.file('word/document.xml', d.replace('</w:body>', '<w:p/></w:body>'));
    });
    await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml))
      .rejects.toThrow(/part word\/document\.xml differs from the source/);
  });

  it('rejects a genuinely foreign new customXml part not shaped like a SharePoint addition', async () => {
    const bad = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/item9.xml', '<payload xmlns="urn:foreign"/>'); });
    await expect(attestDocxPackageAgainstSource(bad, sourceWithOwnCustomXml))
      .rejects.toThrow(/item9\.xml is not a SharePoint property-promotion item/);
  });

  it('rejects a changed ContentType on an existing [Content_Types].xml Override (P3-a, Opus round 1)', async () => {
    const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => {
      const ct = await zip.file('[Content_Types].xml').async('string');
      // word/document.xml's own Override must already be present in the
      // render's content types; swap its ContentType to something else.
      const changed = ct.replace(
        /(<Override ContentType=")[^"]+(" PartName="\/word\/document\.xml"\s*\/?>)/,
        '$1application/x-tampered$2',
      );
      expect(changed).not.toBe(ct); // the fixture assumption must hold
      zip.file('[Content_Types].xml', changed);
    });
    await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml))
      .rejects.toThrow(/content-type override \/word\/document\.xml changed ContentType/);
  });

  it('rejects a duplicated [Content_Types].xml Override where a rogue entry precedes the original (P3-4, Opus round 2)', async () => {
    const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => {
      const ct = await zip.file('[Content_Types].xml').async('string');
      // A Map keyed by PartName would keep the LAST (original) entry and pass;
      // the comparator must refuse the repeat itself.
      const rogue = '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>';
      zip.file('[Content_Types].xml', ct.replace('<Override', `${rogue}<Override`));
    });
    await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml))
      .rejects.toThrow(/repeats override \/word\/document\.xml/);
  });

  it('treats [Content_Types].xml Default extensions case-insensitively: a duplicate that differs only by case is refused (P3-4, Opus round 2)', async () => {
    const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => {
      const ct = await zip.file('[Content_Types].xml').async('string');
      // Attribute order is not fixed (the render writes ContentType first).
      const tag = ct.match(/<Default\b[^>]*>/)?.[0];
      expect(tag).toBeTruthy(); // the render must declare at least one Default
      const ext = tag.match(/Extension="([^"]+)"/)[1];
      const contentType = tag.match(/ContentType="([^"]+)"/)[1];
      const upper = `<Default Extension="${ext.toUpperCase()}" ContentType="${contentType}"/>`;
      zip.file('[Content_Types].xml', ct.replace('</Types>', `${upper}</Types>`));
    });
    await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml))
      .rejects.toThrow(/repeats default extension/);
  });

  it('rejects an added [Content_Types].xml <Default> entry (P3-a, Opus round 1)', async () => {
    const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => {
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace('</Types>', '<Default Extension="webp" ContentType="image/webp"/></Types>'));
    });
    await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml))
      .rejects.toThrow(/content-type default for extension webp was added/);
  });

  // Codex slice review round 1, F1: the former regex parser matched only the
  // literal `<Relationship` / `<Override` / `<Default` spellings with
  // double-quoted attributes. Namespace-prefixed or single-quoted forms were
  // invisible to it, so an added external relationship could attest as
  // unchanged. Every case below must now be refused.
  describe('namespace-aware OPC parsing (Codex F1)', () => {
    const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const withRels = (edit) => withParts(sourceWithOwnCustomXml, async (zip) => {
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      zip.file('word/_rels/document.xml.rels', edit(rels));
    });
    const withCt = (edit) => withParts(sourceWithOwnCustomXml, async (zip) => {
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', edit(ct));
    });
    const prefixed = (xml, tag, ns) => xml.replace(/<Relationships\b([^>]*)>/, `<${tag}:Relationships xmlns:${tag}="${ns}"$1>`).replace(/<Relationship\b/g, `<${tag}:Relationship`).replace('</Relationships>', `</${tag}:Relationships>`);

    it('a prefixed <r:Relationship TargetMode="External"> hidden in a prefixed rels part is still seen and refused', async () => {
      const mutated = await withRels((rels) => prefixed(rels, 'r', RELS_NS).replace('</r:Relationships>', '<r:Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://attacker.example/" TargetMode="External"/></r:Relationships>'));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/rId99 .* is not a SharePoint customXml relationship/);
    });

    it('an added relationship written with single-quoted attributes is refused', async () => {
      const mutated = await withRels((rels) => rels.replace('</Relationships>', "<Relationship Id='rId98' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject' Target='embeddings/x.bin'/></Relationships>"));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/rId98 .* is not a SharePoint customXml relationship/);
    });

    it('an added customXml relationship whose TargetMode is External is refused', async () => {
      const mutated = await withRels((rels) => rels.replace('</Relationships>', '<Relationship Id="rId97" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="https://attacker.example/item.xml" TargetMode="External"/></Relationships>'));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/rId97 .* is an external customXml relationship/);
    });

    it('a foreign-namespace element inside the rels part is refused', async () => {
      const mutated = await withRels((rels) => rels.replace('</Relationships>', '<x:Relationship xmlns:x="urn:foreign" Id="rId96" Target="a"/></Relationships>'));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/unexpected element urn:foreign:Relationship/);
    });

    it('a duplicated relationship Id is refused', async () => {
      const mutated = await withRels((rels) => {
        const first = rels.match(/<Relationship\b[^>]*\/>/)[0];
        return rels.replace(first, `${first}${first}`);
      });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/repeats relationship rId/);
    });

    it('a rels part whose root is not Relationships in the package namespace is refused', async () => {
      const mutated = await withRels((rels) => rels.replace(RELS_NS, 'urn:not-opc'));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/root element is not Relationships in the package namespace/);
    });

    it('a malformed rels part fails closed instead of parsing as empty', async () => {
      const mutated = await withRels((rels) => rels.replace('</Relationships>', '<Relationship Id="rId95"'));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/is not well-formed XML/);
    });

    it('a prefixed <ct:Override> added to a prefixed [Content_Types].xml is still seen and refused', async () => {
      const mutated = await withCt((ct) => ct
        .replace(/<Types\b([^>]*)>/, '<ct:Types xmlns:ct="' + CT_NS + '"$1>')
        .replace(/<(Default|Override)\b/g, '<ct:$1')
        .replace('</Types>', '<ct:Override PartName="/word/embeddings/x.bin" ContentType="application/octet-stream"/></ct:Types>'));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/x\.bin/);
    });

    it('a foreign-namespace element inside [Content_Types].xml is refused', async () => {
      const mutated = await withCt((ct) => ct.replace('</Types>', '<x:Override xmlns:x="urn:foreign" PartName="/a" ContentType="b"/></Types>'));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/unexpected element urn:foreign:Override/);
    });

    it('the render attestor applies the same parser: a prefixed external relationship is refused there too', async () => {
      const mutated = await withParts(render, async (zip) => {
        const rels = await zip.file('word/_rels/document.xml.rels').async('string');
        zip.file('word/_rels/document.xml.rels', prefixed(rels, 'r', RELS_NS).replace('</r:Relationships>', '<r:Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://attacker.example/" TargetMode="External"/></r:Relationships>'));
      });
      await expect(attestDocxPackageAgainstRender(mutated, render)).rejects.toThrow(/rId99 .* is not a SharePoint customXml relationship/);
    });

    it('a prefixed shadow attribute (x:Type="…/customXml" beside Type="…/oleObject") cannot make a rogue relationship read as tolerated', async () => {
      const mutated = await withRels((rels) => rels.replace('</Relationships>', '<Relationship xmlns:x="urn:foreign" Id="rId94" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" x:Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="embeddings/x.bin"/></Relationships>'));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/namespaced attribute x:Type/);
    });

    it('a prefixed shadow attribute on a [Content_Types].xml Override is refused', async () => {
      const mutated = await withCt((ct) => ct.replace(/<Override\b/, '<Override xmlns:x="urn:foreign" x:PartName="/shadow" '));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/namespaced attribute x:PartName/);
    });

    it('a known relationship flipped to TargetMode="External" on the destination is no longer "known"', async () => {
      const mutated = await withRels((rels) => rels.replace(/<Relationship\b/, '<Relationship TargetMode="External" '));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/is missing/);
    });

    it('a customXml rels part whose customXmlProps relationship is External is refused', async () => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/_rels/item4.xml.rels', SP_RELS.replace('Target=', 'TargetMode="External" Target=')); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/non-customXmlProps relationship/);
    });

    it('the render attestor refuses a prefixed shadow attribute too', async () => {
      const mutated = await withParts(render, async (zip) => {
        const rels = await zip.file('word/_rels/document.xml.rels').async('string');
        zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship xmlns:x="urn:foreign" Id="rId94" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" x:Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="embeddings/x.bin"/></Relationships>'));
      });
      await expect(attestDocxPackageAgainstRender(mutated, render)).rejects.toThrow(/namespaced attribute x:Type/);
    });

    // Codex slice review round 2: root recognition by PARSED root, not by a
    // regex over a text head. Each bait below contains a permitted-looking
    // tag somewhere other than the document root.
    const CT_SCHEMA_NS = 'http://schemas.microsoft.com/office/2006/metadata/contentType';
    const itemBaits = [
      ['comment bait', `<evil xmlns="urn:foreign"><ct:contentTypeSchema xmlns:ct="${CT_SCHEMA_NS}"/><!-- bait --></evil>`],
      ['nested permitted child', `<evil xmlns="urn:foreign"><ct:contentTypeSchema xmlns:ct="${CT_SCHEMA_NS}"/></evil>`],
      ['permitted local name in a foreign namespace', '<ct:contentTypeSchema xmlns:ct="urn:foreign"/>'],
      ['permitted namespace, wrong local name', `<ct:other xmlns:ct="${CT_SCHEMA_NS}"/>`],
      ['not XML at all', 'ct:contentTypeSchema <ct:contentTypeSchema'],
    ];
    it.each(itemBaits)('a customXml item whose real root is foreign is refused by the source attestor (%s)', async (_label, xml) => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/item7.xml', xml); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/item7\.xml (is not a SharePoint property-promotion item|carries an XML comment)/);
    });
    it.each(itemBaits)('a customXml item whose real root is foreign is refused by the render attestor (%s)', async (_label, xml) => {
      const mutated = await withParts(render, async (zip) => { zip.file('customXml/item7.xml', xml); });
      await expect(attestDocxPackageAgainstRender(mutated, render)).rejects.toThrow(/item7\.xml (is not a SharePoint property-promotion item|carries an XML comment)/);
    });
    it('a customXml itemProps part whose real root is foreign (datastoreItem nested inside) is refused', async () => {
      const bait = '<evil xmlns="urn:foreign"><ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/></evil>';
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/itemProps7.xml', bait); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/itemProps7\.xml is not a SharePoint datastore item/);
    });
    it('a datastoreItem root in the wrong namespace is refused', async () => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/itemProps7.xml', '<ds:datastoreItem xmlns:ds="urn:foreign"/>'); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/itemProps7\.xml is not a SharePoint datastore item/);
    });
    it('the live SharePoint item shapes (processing instruction, declared prefixes) still pass root recognition', async () => {
      const promoted = await withParts(sourceWithOwnCustomXml, async (zip) => { await promoteItems(zip, [[2, SP_SCHEMA], [3, SP_FORMS], [4, SP_DM]]); });
      await expect(attestDocxPackageAgainstSource(promoted, sourceWithOwnCustomXml)).resolves.toBeTruthy();
    });

    // Codex slice review round 3: `[trash]` entries were exempted wholesale.
    it('an added [trash] entry carrying non-zero bytes is refused by the source attestor (the round-3 counterexample)', async () => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('[trash]/foreign-payload.dat', Buffer.from('hidden payload')); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/trash entry \[trash\]\/foreign-payload\.dat is not a canonical/);
    });
    it.each([
      ['a payload after the 0xFF header', Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('hidden payload')])],
      ['all zeros (the round-3 fixture guess the live bytes refuted)', Buffer.alloc(64)],
      ['a header of three 0xFF bytes', Buffer.from([0xff, 0xff, 0xff, 0, 0, 0])],
      ['a payload beyond the 4 KiB ceiling', Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.alloc(5000)])],
    ])('a canonically named [trash] entry that is not SharePoint padding is refused (%s)', async (_label, bytes) => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('[trash]/0000.dat', bytes); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/\[trash\]\/0000\.dat (is not SharePoint's 0xFFFFFFFF-then-zeros padding|exceeds 4096 bytes)/);
    });
    it('the live [trash] padding shape (0xFFFFFFFF then zeros; 453 and 149 bytes observed) is normalized on either side', async () => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('[trash]/0000.dat', spTrash(453)); zip.file('[trash]/0001.dat', spTrash(149)); });
      const result = await attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml);
      expect(result.normalizedParts).toEqual(expect.arrayContaining(['[trash]/0000.dat', '[trash]/0001.dat']));
      await expect(attestDocxPackageAgainstSource(mutated, mutated)).resolves.toBeTruthy();
    });
    it('the render attestor applies the same [trash] rule', async () => {
      const mutated = await withParts(render, async (zip) => { zip.file('[trash]/0000.dat', Buffer.from('payload')); });
      await expect(attestDocxPackageAgainstRender(mutated, render)).rejects.toThrow(/\[trash\]\/0000\.dat is not SharePoint's 0xFFFFFFFF-then-zeros padding/);
    });

    // Codex reviewer-differs-from-author round: an allowed root carrying a
    // foreign-namespace payload, oversize parts, DOCTYPE, and UTF-16 parts.
    const P_NS = 'http://schemas.microsoft.com/office/2006/metadata/properties';
    it('an allowed p:properties root carrying a 4 KiB foreign-namespace child is refused by both attestors (the counterexample)', async () => {
      const payload = `<p:properties xmlns:p="${P_NS}"><documentManagement/><x:payload xmlns:x="urn:foreign">${'A'.repeat(4096)}</x:payload></p:properties>`;
      const mutatedSource = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/item99.xml', payload); });
      await expect(attestDocxPackageAgainstSource(mutatedSource, sourceWithOwnCustomXml)).rejects.toThrow(/item99\.xml carries element urn:foreign:payload outside the characterized shape/);
      const mutatedRender = await withParts(render, async (zip) => { zip.file('customXml/item99.xml', payload); });
      await expect(attestDocxPackageAgainstRender(mutatedRender, render)).rejects.toThrow(/item99\.xml carries element urn:foreign:payload/);
    });
    it('a foreign-namespace attribute inside an allowed item is refused', async () => {
      const payload = `<p:properties xmlns:p="${P_NS}" xmlns:x="urn:foreign"><documentManagement x:data="${'B'.repeat(64)}"/></p:properties>`;
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/item98.xml', payload); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/item98\.xml carries attribute x:data outside the characterized shape/);
    });
    it('a datastoreItem carrying a foreign child is refused', async () => {
      const payload = '<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><x:p xmlns:x="urn:foreign">hidden</x:p></ds:datastoreItem>';
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/itemProps9.xml', payload); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/itemProps9\.xml carries element urn:foreign:p/);
    });
    it('an allowed item larger than the SharePoint-part ceiling is refused even when every namespace is allowed', async () => {
      const payload = `<p:properties xmlns:p="${P_NS}"><documentManagement/><!-- ${'C'.repeat(70 * 1024)} --></p:properties>`;
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/item97.xml', payload); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/item97\.xml exceeds the 65536-byte ceiling/);
    });
    it('a DOCTYPE in any parsed part is refused', async () => {
      const mutated = await withRels((rels) => `<!DOCTYPE Relationships [<!ENTITY e "x">]>${rels}`);
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/carries a DOCTYPE/);
    });
    it('the live SharePoint properties item with a site-column (GUID) namespace child and xsi attributes passes', async () => {
      const payload = `<?xml version="1.0" encoding="utf-8"?><p:properties xmlns:p="${P_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><documentManagement><ns2:Column xmlns:ns2="1f0c4b4e-7d43-4c66-9b0f-3d2d6d5f0a11" xsi:nil="true"/></documentManagement></p:properties>`;
      const promoted = await withParts(sourceWithOwnCustomXml, async (zip) => { await promoteItems(zip, [[5, payload]]); });
      await expect(attestDocxPackageAgainstSource(promoted, sourceWithOwnCustomXml)).resolves.toBeTruthy();
    });
    // Codex re-review of the namespace allowlist: shapes, not namespaces.
    const LIVE_ITEM2 = '<?mso-contentType?><FormTemplates xmlns="http://schemas.microsoft.com/sharepoint/v3/contenttype/forms"><Display>DocumentLibraryForm</Display><Edit>DocumentLibraryForm</Edit><New>DocumentLibraryForm</New></FormTemplates>';
    const LIVE_ITEM3 = '<?xml version="1.0" encoding="utf-8"?><p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:pc="http://schemas.microsoft.com/office/infopath/2007/PartnerControls"><documentManagement><lcf76f155ced4ddcb4097134ff3c332f xmlns="fd037f0b-8df4-41f5-8fed-c3984d351918"><Terms xmlns="http://schemas.microsoft.com/office/infopath/2007/PartnerControls"></Terms></lcf76f155ced4ddcb4097134ff3c332f><TaxCatchAll xmlns="270ae82a-6903-42ec-99d1-4079863f002d" xsi:nil="true"/><TaxKeywordTaxHTField xmlns="270ae82a-6903-42ec-99d1-4079863f002d"><Terms xmlns="http://schemas.microsoft.com/office/infopath/2007/PartnerControls"></Terms></TaxKeywordTaxHTField></documentManagement></p:properties>';
    const LIVE_ITEM1_EXCERPT = '<?xml version="1.0" encoding="utf-8"?><ct:contentTypeSchema ct:_="" ma:_="" ma:contentTypeName="Document" ma:contentTypeID="0x0101003CC1047D46B85E46831D0019F23BD8E1" ma:contentTypeVersion="18" ma:contentTypeDescription="Create a new document." ma:contentTypeScope="" ma:versionID="b059a517a4eadd1ecb3e593ffd9fe262" xmlns:ct="http://schemas.microsoft.com/office/2006/metadata/contentType" xmlns:ma="http://schemas.microsoft.com/office/2006/metadata/properties/metaAttributes"><xsd:schema targetNamespace="http://schemas.microsoft.com/office/2006/metadata/properties" ma:root="true" ma:fieldsID="fd1d941250e2eace808565d0c537d78d" ns2:_="" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:ns2="270ae82a-6903-42ec-99d1-4079863f002d"><xsd:import namespace="270ae82a-6903-42ec-99d1-4079863f002d"/><xsd:element name="properties"><xsd:complexType><xsd:sequence><xsd:element name="documentManagement"><xsd:complexType><xsd:all><xsd:element ref="ns2:TaxCatchAll" minOccurs="0"/></xsd:all></xsd:complexType></xsd:element></xsd:sequence></xsd:complexType></xsd:element></xsd:schema><xsd:schema targetNamespace="270ae82a-6903-42ec-99d1-4079863f002d" elementFormDefault="qualified" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:ma="http://schemas.microsoft.com/office/2006/metadata/properties/metaAttributes"><xsd:element name="TaxCatchAll" ma:index="10" nillable="true" ma:displayName="Taxonomy Catch All Column" ma:hidden="true" ma:list="{d86ba6b7-e28e-4a16-8290-c05c5a8f8d9f}" ma:internalName="TaxCatchAll" ma:readOnly="false"><xsd:annotation><xsd:documentation>hidden taxonomy column</xsd:documentation></xsd:annotation></xsd:element></xsd:schema></ct:contentTypeSchema>';
    it('the three live SharePoint items (read back from sandbox Request 1000342 on 2026-09-25) pass their shapes', async () => {
      const promoted = await withParts(sourceWithOwnCustomXml, async (zip) => { await promoteItems(zip, [[2, LIVE_ITEM1_EXCERPT], [3, LIVE_ITEM2], [4, LIVE_ITEM3]]); });
      await expect(attestDocxPackageAgainstSource(promoted, sourceWithOwnCustomXml)).resolves.toBeTruthy();
      const promotedRender = await withParts(render, async (zip) => { await promoteItems(zip, [[1, LIVE_ITEM1_EXCERPT], [2, LIVE_ITEM2], [3, LIVE_ITEM3]]); });
      await expect(attestDocxPackageAgainstRender(promotedRender, render)).resolves.toBeTruthy();
    });
    it.each([
      ['an unqualified <payload> under documentManagement', LIVE_ITEM3.replace('<documentManagement>', `<documentManagement><payload>${'D'.repeat(3000)}</payload>`), /carries element :payload outside the characterized shape/],
      ['a GUID-namespaced element directly under the root', LIVE_ITEM3.replace('<documentManagement>', `<x:payload xmlns:x="11111111-2222-4333-8444-555555555555">${'E'.repeat(3000)}</x:payload><documentManagement>`), /carries element 11111111-2222-4333-8444-555555555555:payload outside the characterized shape/],
      ['a site-column value longer than the column-value ceiling', LIVE_ITEM3.replace('<TaxCatchAll xmlns="270ae82a-6903-42ec-99d1-4079863f002d" xsi:nil="true"/>', `<TaxCatchAll xmlns="270ae82a-6903-42ec-99d1-4079863f002d">${'F'.repeat(2000)}</TaxCatchAll>`), /element TaxCatchAll carries 2000 characters of text, above its ceiling/],
      ['a PartnerControls element that is not a Terms node', LIVE_ITEM3.replace('<Terms xmlns="http://schemas.microsoft.com/office/infopath/2007/PartnerControls"></Terms></TaxKeyword', '<Terms xmlns="http://schemas.microsoft.com/office/infopath/2007/PartnerControls"><Other>x</Other></Terms></TaxKeyword'), /carries element http:\/\/schemas\.microsoft\.com\/office\/infopath\/2007\/PartnerControls:Other outside/],
      ['text directly under documentManagement', LIVE_ITEM3.replace('<documentManagement>', '<documentManagement>hidden'), /element documentManagement carries 6 characters of text, above its ceiling/],
      ['a non-XSD element inside contentTypeSchema', LIVE_ITEM1_EXCERPT.replace('</ct:contentTypeSchema>', '<x:payload xmlns:x="urn:foreign">hidden</x:payload></ct:contentTypeSchema>'), /carries element urn:foreign:payload outside the characterized shape/],
      ['an xsd:documentation longer than the text ceiling', LIVE_ITEM1_EXCERPT.replace('hidden taxonomy column', 'G'.repeat(300)), /element documentation carries 300 characters of text, above its ceiling/],
      ['an attribute longer than the attribute ceiling', LIVE_ITEM1_EXCERPT.replace('ma:contentTypeDescription="Create a new document."', `ma:contentTypeDescription="${'H'.repeat(300)}"`), /attribute ma:contentTypeDescription exceeds 256 characters/],
      ['a fourth FormTemplates child', LIVE_ITEM2.replace('</FormTemplates>', '<Extra>x</Extra></FormTemplates>'), /carries element http:\/\/schemas\.microsoft\.com\/sharepoint\/v3\/contenttype\/forms:Extra outside/],
      ['a FormTemplates token that is not a token', LIVE_ITEM2.replace('<Display>DocumentLibraryForm</Display>', `<Display>${'I'.repeat(100)}</Display>`), /element Display carries 100 characters of text, above its ceiling/],
    ])('a customXml item deviating from the live shape is refused (%s)', async (_label, xml, pattern) => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/item6.xml', xml); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(pattern);
    });
    it('a customXml rels part padded past the rels ceiling with a comment is refused', async () => {
      const padded = SP_RELS.replace('<Relationship ', `<!-- ${'J'.repeat(40 * 1024)} --><Relationship `);
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/_rels/item4.xml.rels', padded); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/item4\.xml\.rels exceeds the 4096-byte ceiling/);
    });
    it('a customXml rels part with a second relationship or a non-itemProps target is refused', async () => {
      const two = SP_RELS.replace('</Relationships>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>');
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/_rels/item4.xml.rels', two); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/non-customXmlProps relationship/);
      const elsewhere = SP_RELS.replace('Target="itemProps1.xml"', 'Target="../word/document.xml"');
      const mutated2 = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/_rels/item4.xml.rels', elsewhere); });
      await expect(attestDocxPackageAgainstSource(mutated2, sourceWithOwnCustomXml)).rejects.toThrow(/non-customXmlProps relationship/);
    });
    it('an itemProps part larger than its ceiling is refused', async () => {
      const big = SP_PROPS.replace('/>', `><!-- ${'K'.repeat(5000)} --></ds:datastoreItem>`);
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/itemProps8.xml', big); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/itemProps8\.xml exceeds the 4096-byte ceiling/);
    });

    // Codex re-review of the shape rules: every probe that passed then.
    const probes = [
      ['an empty <FormTemplates/>', [[6, '<FormTemplates xmlns="http://schemas.microsoft.com/sharepoint/v3/contenttype/forms"/>']], /FormTemplates has 0 Display child\(ren\); expected 1\.\.1/],
      ['a duplicated FormTemplates token', [[6, LIVE_ITEM2.replace('<Edit>', '<Edit>DocumentLibraryForm</Edit><Edit>')]], /FormTemplates has 2 Edit child\(ren\); expected 1\.\.1/],
      ['a duplicated documentManagement', [[6, LIVE_ITEM3.replace('</documentManagement>', '</documentManagement><documentManagement/>')]], /properties has 2 documentManagement child\(ren\); expected 1\.\.1/],
      ['a 62,000-character attribute name', [[6, LIVE_ITEM3.replace('<documentManagement>', `<documentManagement ${'a'.repeat(62000)}="">`)]], /carries an attribute whose name is not a bounded token|carries more than|exceeds the 65536-byte ceiling/],
      ['a 60,000-byte comment inside an item', [[6, LIVE_ITEM3.replace('</p:properties>', `<!-- ${'x'.repeat(60000)} --></p:properties>`)]], /carries an XML comment/],
      ['a 60,000-byte processing instruction inside an item', [[6, LIVE_ITEM3.replace('</p:properties>', `<?pi ${'x'.repeat(60000)}?></p:properties>`)]], /carries a processing instruction/],
      ['a short comment inside an item', [[6, LIVE_ITEM3.replace('</p:properties>', '<!-- x --></p:properties>')]], /item6\.xml carries an XML comment/],
      ['four added items', [[6, LIVE_ITEM2], [7, LIVE_ITEM2], [8, LIVE_ITEM2], [9, LIVE_ITEM2]], /added 4 customXml items; at most 3 are characterized/],
    ];
    it.each(probes)('%s is refused', async (_label, entries, pattern) => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { await promoteItems(zip, entries); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(pattern);
    });
    it('added customXml parts must exceed neither the per-part nor the aggregate ceiling (three near-limit items)', async () => {
      const big = LIVE_ITEM3.replace('<TaxCatchAll xmlns="270ae82a-6903-42ec-99d1-4079863f002d" xsi:nil="true"/>', Array.from({ length: 60 }, (_, i) => `<C${i} xmlns="270ae82a-6903-42ec-99d1-4079863f002d">${'v'.repeat(1000)}</C${i}>`).join(''));
      expect(big.length).toBeLessThan(64 * 1024);
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { await promoteItems(zip, [[6, big], [7, big], [8, big]]); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/added \d+ bytes of customXml parts, above the 131072-byte ceiling/);
    });
    it.each([
      ['an orphan itemProps part', async (zip) => { zip.file('customXml/itemProps6.xml', SP_PROPS); }],
      ['an orphan rels part', async (zip) => { zip.file('customXml/_rels/item6.xml.rels', SP_RELS.replace('itemProps1', 'itemProps6')); }],
      ['an item with no itemProps, rels, relationship or override', async (zip) => { zip.file('customXml/item6.xml', LIVE_ITEM2); }],
      ['a tolerated customXml document relationship with no item behind it', async (zip) => {
        const rels = await zip.file('word/_rels/document.xml.rels').async('string');
        zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId66" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item6.xml"/></Relationships>'));
      }],
      ['an added itemProps override with no item behind it', async (zip) => {
        const ct = await zip.file('[Content_Types].xml').async('string');
        zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/customXml/itemProps6.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'));
      }],
    ])('the promotion graph must be closed: %s is refused', async (_label, mutate) => {
      const mutated = await withParts(sourceWithOwnCustomXml, mutate);
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/do not form matching sets|target nothing; expected|targets? \.\.\/customXml\/item6\.xml; expected nothing|overrides name \/customXml\/itemProps6\.xml; expected nothing|is missing/);
    });
    it.each([
      ['a 1 MiB non-XML docProps/core.xml', 'docProps/core.xml', 'x'.repeat(1024 * 1024), /core\.xml exceeds its 8192-byte ceiling/],
      ['a small non-XML docProps/core.xml', 'docProps/core.xml', 'not xml', /core\.xml is not a core-properties document/],
      ['a core.xml with a foreign child', 'docProps/core.xml', CORE_OK().replace('</cp:coreProperties>', '<x:p xmlns:x="urn:foreign">hidden</x:p></cp:coreProperties>'), /carries element urn:foreign:p outside the core-properties shape/],
      ['a core.xml with a nested child', 'docProps/core.xml', CORE_OK().replace('<dc:title>TITLE</dc:title>', '<dc:title><dc:title>x</dc:title></dc:title>'), /element title carries child elements/],
      ['a core.xml with a comment', 'docProps/core.xml', CORE_OK().replace('</cp:coreProperties>', '<!-- x --></cp:coreProperties>'), /core\.xml carries an XML comment/],
      ['a custom.xml property with no vt scalar', 'docProps/custom.xml', CUSTOM_OK.replace('<vt:lpwstr>0x0101003CC1047D46B85E46831D0019F23BD8E1</vt:lpwstr>', ''), /does not hold exactly one vt scalar/],
      ['a custom.xml with a foreign element', 'docProps/custom.xml', CUSTOM_OK.replace('</Properties>', '<x:p xmlns:x="urn:foreign">hidden</x:p></Properties>'), /outside the custom-properties shape/],
      ['a custom.xml value above the ceiling', 'docProps/custom.xml', CUSTOM_OK.replace('0x0101003CC1047D46B85E46831D0019F23BD8E1', 'v'.repeat(2000)), /property ContentTypeId exceeds 1024 characters/],
    ])('docProps parts are shaped and bounded: %s is refused', async (_label, part, content, pattern) => {
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file(part, content); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(pattern);
    });
    it.each([
      ['60,000 characters of text inside document relationships', (rels) => rels.replace('</Relationships>', `${'t'.repeat(60000)}</Relationships>`), /relationships carries text|exceeds its 32768-byte ceiling/],
      ['a 60,000-character comment inside document relationships', (rels) => rels.replace('</Relationships>', `<!-- ${'c'.repeat(60000)} --></Relationships>`), /carries an XML comment|exceeds its 32768-byte ceiling/],
      ['a short comment inside document relationships', (rels) => rels.replace('</Relationships>', '<!-- c --></Relationships>'), /document relationships carries an XML comment/],
      ['a relationship with a child element', (rels) => rels.replace(/<Relationship\b([^>]*)\/>/, '<Relationship$1><x/></Relationship>'), /relationship carries child elements|unexpected element/],
      ['a relationship with an unexpected attribute', (rels) => rels.replace(/<Relationship\b/, '<Relationship Extra="1" '), /relationship carries an unexpected attribute Extra/],
    ])('document relationships are shaped and bounded: %s is refused', async (_label, edit, pattern) => {
      const mutated = await withRels(edit);
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(pattern);
    });
    it.each([
      ['60,000 characters of text inside [Content_Types].xml', (ct) => ct.replace('</Types>', `${'t'.repeat(60000)}</Types>`), /carries text|exceeds its 32768-byte ceiling/],
      ['a short comment inside [Content_Types].xml', (ct) => ct.replace('</Types>', '<!-- c --></Types>'), /\[Content_Types\]\.xml carries an XML comment/],
      ['an Override with an unexpected attribute', (ct) => ct.replace(/<Override\b/, '<Override Extra="1" '), /Override carries an unexpected attribute Extra/],
      ['an Override with text', (ct) => ct.replace(/<Override\b([^>]*)\/>/, '<Override$1>text</Override>'), /Override carries text/],
    ])('[Content_Types].xml is shaped and bounded: %s is refused', async (_label, edit, pattern) => {
      const mutated = await withCt(edit);
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(pattern);
    });

    it.each(['docProps/core.xml', 'docProps/custom.xml'])('a baseline %s deleted from the destination is refused (Codex final re-review)', async (part) => {
      const withCustom = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('docProps/custom.xml', CUSTOM_OK); });
      const mutated = await withParts(withCustom, async (zip) => { zip.remove(part); });
      await expect(attestDocxPackageAgainstSource(mutated, withCustom)).rejects.toThrow(new RegExp(`part ${part.replace('.', '\\.')} is missing`));
    });

    const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    it('a byte-identical package whose rels and content-types parts are UTF-16 with a BOM is accepted', async () => {
      const utf16Package = await withParts(sourceWithOwnCustomXml, async (zip) => {
        for (const part of ['word/_rels/document.xml.rels', '[Content_Types].xml']) zip.file(part, utf16(await zip.file(part).async('string')));
      });
      await expect(attestDocxPackageAgainstSource(utf16Package, utf16Package)).resolves.toBeTruthy();
    });
    it('a UTF-16 rels part carrying an added external relationship is still refused', async () => {
      const mutated = await withRels((rels) => utf16(rels.replace('</Relationships>', '<Relationship Id="rId93" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://attacker.example/" TargetMode="External"/></Relationships>')));
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/rId93 .* is not a SharePoint customXml relationship/);
    });

    it('a customXml rels part beyond the old 2 KB head window is parsed in full: a trailing hyperlink relationship is refused', async () => {
      const padding = `<!-- ${'x'.repeat(2500)} -->`;
      const bad = SP_RELS.replace('<Relationship ', `${padding}<Relationship `).replace('</Relationships>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://attacker.example/" TargetMode="External"/></Relationships>');
      const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => { zip.file('customXml/_rels/item4.xml.rels', bad); });
      await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml)).rejects.toThrow(/non-customXmlProps relationship/);
    });
  });
});

describe('ZIP central-directory budget (fail-closed, Codex plan rounds 13-14)', () => {
  const TINY_BUDGET = Object.freeze({ maxEntries: 10, maxPartUncompressedBytes: 2000, maxTotalUncompressedBytes: 4000 });

  function findCentralDirectoryOffset(buf, name) {
    const CD_SIG = 0x02014b50;
    for (let i = 0; i < buf.length - 46; i++) {
      if (buf.readUInt32LE(i) === CD_SIG) {
        const nameLen = buf.readUInt16LE(i + 28);
        const found = buf.toString('utf8', i + 46, i + 46 + nameLen);
        if (found === name) return i;
      }
    }
    throw new Error(`central directory entry for ${name} not found`);
  }

  /** Craft a package whose central directory LIES about one part's declared uncompressed size (small, under budget) while the real deflate stream produces far more -- the case the CD check alone cannot catch. */
  async function buildCentralDirectoryLyingBomb() {
    const zip = new JSZip();
    // Highly compressible so the ZIP stays small while still inflating well
    // past TINY_BUDGET.maxPartUncompressedBytes when read honestly.
    zip.file('word/document.xml', Buffer.alloc(3000, 0x41));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const buf = Buffer.from(bytes);
    const offset = findCentralDirectoryOffset(buf, 'word/document.xml');
    buf.writeUInt32LE(10, offset + 24); // lie: declare 10 uncompressed bytes
    return buf;
  }

  it('parses a well-formed package and returns its entries', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'hello');
    zip.file('b.txt', 'world');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const entries = validateZipCentralDirectory(bytes, DOCX_PACKAGE_BUDGET);
    expect(entries.map((e) => e.name).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('rejects an exact duplicate entry name', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'one');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const buf = Buffer.from(bytes);
    // Duplicate the central-directory header for a.txt by appending a
    // second, byte-identical copy of it just before the EOCD, and bump the
    // EOCD's declared entry count/size to match.
    const offset = findCentralDirectoryOffset(buf, 'a.txt');
    const nextSigIndex = buf.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]), offset + 4);
    const header = buf.subarray(offset, nextSigIndex);
    const eocdOffset = nextSigIndex;
    const newEocdOffset = eocdOffset + header.length;
    const patched = Buffer.concat([buf.subarray(0, eocdOffset), header, header, buf.subarray(eocdOffset)]);
    const eocd = newEocdOffset + header.length;
    patched.writeUInt16LE(2, eocd + 8);
    patched.writeUInt16LE(2, eocd + 10);
    patched.writeUInt32LE(header.length * 2, eocd + 12);
    expect(() => validateZipCentralDirectory(patched, DOCX_PACKAGE_BUDGET)).toThrow(/duplicate entry name/);
  });

  it('rejects a normalized path-alias duplicate (leading slash)', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'one');
    zip.file('/a.txt', 'two');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    expect(() => validateZipCentralDirectory(bytes, DOCX_PACKAGE_BUDGET)).toThrow(/path-alias duplicates/);
  });

  it('rejects word/./document.xml as a path-alias duplicate of word/document.xml (P3-b, Opus round 1)', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', 'one');
    zip.file('word/./document.xml', 'two');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    expect(() => validateZipCentralDirectory(bytes, DOCX_PACKAGE_BUDGET)).toThrow(/path-alias duplicates/);
  });

  it('packagePartsBudgeted (the reader) also rejects a duplicate entry name, not just the validator called directly (P2-4, Opus round 1)', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'one');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const buf = Buffer.from(bytes);
    const offset = findCentralDirectoryOffset(buf, 'a.txt');
    const nextSigIndex = buf.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]), offset + 4);
    const header = buf.subarray(offset, nextSigIndex);
    const eocdOffset = nextSigIndex;
    const newEocdOffset = eocdOffset + header.length;
    const patched = Buffer.concat([buf.subarray(0, eocdOffset), header, header, buf.subarray(eocdOffset)]);
    const eocd = newEocdOffset + header.length;
    patched.writeUInt16LE(2, eocd + 8);
    patched.writeUInt16LE(2, eocd + 10);
    patched.writeUInt32LE(header.length * 2, eocd + 12);
    await expect(packagePartsBudgeted(patched, DOCX_PACKAGE_BUDGET)).rejects.toThrow(/duplicate entry name/);
  });

  it('packagePartsBudgeted (the reader) also rejects a path-alias duplicate, not just the validator called directly (P2-4, Opus round 1)', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'one');
    zip.file('/a.txt', 'two');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(packagePartsBudgeted(bytes, DOCX_PACKAGE_BUDGET)).rejects.toThrow(/path-alias duplicates/);
  });

  it('packagePartsBudgeted (the reader) also rejects an over-ceiling declared per-part size, not just the validator called directly (P2-4, Opus round 1)', async () => {
    const zip = new JSZip();
    zip.file('a.txt', Buffer.alloc(TINY_BUDGET.maxPartUncompressedBytes + 1, 0x41));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await expect(packagePartsBudgeted(bytes, TINY_BUDGET)).rejects.toThrow(/exceeding the per-part ceiling/);
  });

  it('rejects a declared per-part uncompressed size over the ceiling', async () => {
    const zip = new JSZip();
    zip.file('a.txt', Buffer.alloc(TINY_BUDGET.maxPartUncompressedBytes + 1, 0x41));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(() => validateZipCentralDirectory(bytes, TINY_BUDGET)).toThrow(/exceeding the per-part ceiling/);
  });

  it('rejects a ZIP64 end-of-central-directory locator (fails closed on ZIP64)', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'hello');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const buf = Buffer.from(bytes);
    const eocdSearchStart = buf.length - 22;
    // Splice a fake ZIP64 EOCD locator (20 bytes) directly before the EOCD.
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    const patched = Buffer.concat([buf.subarray(0, eocdSearchStart), locator, buf.subarray(eocdSearchStart)]);
    expect(() => validateZipCentralDirectory(patched, DOCX_PACKAGE_BUDGET)).toThrow(/ZIP64 end-of-central-directory locator/);
  });

  it('CD-check alone would pass the lying bomb (proves the fixture is honest)', async () => {
    const bomb = await buildCentralDirectoryLyingBomb();
    expect(() => validateZipCentralDirectory(bomb, TINY_BUDGET)).not.toThrow();
  });

  it('the streaming reader aborts a package whose central directory lies about its size', async () => {
    const bomb = await buildCentralDirectoryLyingBomb();
    await expect(packagePartsBudgeted(bomb, TINY_BUDGET)).rejects.toThrow(/exceeded its inflate byte ceiling/);
  });

  it('mutation guard: our own per-chunk ceiling fires before JSZip\'s own end-of-stream size check', async () => {
    // The REJECTED pattern (file.async('nodebuffer') then a length check)
    // only discovers a problem at the 'end' event, after the ENTIRE
    // decompressed content has already been buffered in memory -- JSZip
    // itself then throws its own "uncompressed data size mismatch" (it
    // cross-checks the declared size against the actual decompressed
    // length), but only after full materialization. Our streaming reader's
    // per-`data`-event check aborts DURING decompression, well before that
    // end-of-stream point, so the failure it raises is always OUR ceiling
    // message, never JSZip's -- proving the check runs on the way in, not
    // after the fact.
    const bomb = await buildCentralDirectoryLyingBomb();
    await expect(packagePartsBudgeted(bomb, TINY_BUDGET)).rejects.toThrow(/exceeded its inflate byte ceiling/);
    await expect(packagePartsBudgeted(bomb, TINY_BUDGET)).rejects.not.toThrow(/uncompressed data size mismatch/);
  });
});
