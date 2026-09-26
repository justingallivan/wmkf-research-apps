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
      zip.file('customXml/item2.xml', SP_SCHEMA);
      zip.file('customXml/itemProps2.xml', SP_PROPS);
      zip.file('customXml/_rels/item2.xml.rels', SP_RELS.replace('itemProps1', 'itemProps2'));
      zip.file('docProps/core.xml', '<cp:coreProperties/>');
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId50" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item2.xml"/></Relationships>'));
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/customXml/itemProps2.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'));
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

  it('rejects an added [Content_Types].xml <Default> entry (P3-a, Opus round 1)', async () => {
    const mutated = await withParts(sourceWithOwnCustomXml, async (zip) => {
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace('</Types>', '<Default Extension="webp" ContentType="image/webp"/></Types>'));
    });
    await expect(attestDocxPackageAgainstSource(mutated, sourceWithOwnCustomXml))
      .rejects.toThrow(/content-type default for extension webp was added/);
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
