/** @jest-environment node */
import { validateSiteVisitMaterial, slotExtensions } from '../../lib/utils/site-visit-material-file';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');

function storeZip(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const [name, content = ''] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

const ZIP = storeZip([['notes.txt', 'generic archive']]);
const PPTX = storeZip([['[Content_Types].xml', '<Types/>'], ['ppt/presentation.xml', '<p/>']]);
const DOCX = storeZip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<w/>']]);
const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64, 1)]);

test('slot decides the extensions; bytes must match the extension signature', () => {
  expect(slotExtensions('presentation_pdf')).toEqual(['pdf']);
  expect(slotExtensions('nope')).toBeNull();
  expect(validateSiteVisitMaterial('deck.pdf', PDF, 'presentation_pdf')).toEqual({ ok: true, extension: 'pdf', contentType: 'application/pdf' });
  expect(validateSiteVisitMaterial('deck.pptx', PPTX, 'presentation_source').ok).toBe(true);
  expect(validateSiteVisitMaterial('deck.key', ZIP, 'presentation_source').contentType).toBe('application/vnd.apple.keynote');
  expect(validateSiteVisitMaterial('deck.ppt', OLE, 'presentation_source').ok).toBe(true);
  expect(validateSiteVisitMaterial('bios.docx', DOCX, 'participant_bios').ok).toBe(true);
  expect(validateSiteVisitMaterial('bios.doc', OLE, 'participant_bios').ok).toBe(true);
});

test('rejections name the reason: wrong slot, empty, disallowed extension, signature mismatch', () => {
  expect(validateSiteVisitMaterial('deck.pdf', PDF, 'unknown')).toEqual({ ok: false, reason: 'unknown_slot' });
  expect(validateSiteVisitMaterial('deck.pdf', Buffer.alloc(0), 'presentation_pdf')).toEqual({ ok: false, reason: 'empty_file' });
  expect(validateSiteVisitMaterial('deck.pptx', ZIP, 'presentation_pdf')).toEqual({ ok: false, reason: 'extension_not_allowed' });
  expect(validateSiteVisitMaterial('deck.exe', ZIP, 'other')).toEqual({ ok: false, reason: 'extension_not_allowed' });
  expect(validateSiteVisitMaterial('deck.pdf', ZIP, 'presentation_pdf')).toEqual({ ok: false, reason: 'signature_mismatch' });
  expect(validateSiteVisitMaterial('deck.pptx', PDF, 'presentation_source')).toEqual({ ok: false, reason: 'signature_mismatch' });
  // A renamed generic archive, or a Word package renamed .pptx, is not a presentation.
  expect(validateSiteVisitMaterial('deck.pptx', ZIP, 'presentation_source')).toEqual({ ok: false, reason: 'signature_mismatch' });
  expect(validateSiteVisitMaterial('deck.pptx', DOCX, 'presentation_source')).toEqual({ ok: false, reason: 'signature_mismatch' });
  expect(validateSiteVisitMaterial('bios.docx', PPTX, 'participant_bios')).toEqual({ ok: false, reason: 'signature_mismatch' });
  const markerTextOnly = storeZip([['notes.txt', '[Content_Types].xml ... ppt/presentation.xml']]);
  expect(validateSiteVisitMaterial('deck.pptx', markerTextOnly, 'presentation_source')).toEqual({ ok: false, reason: 'signature_mismatch' });
  const truncatedDirectory = Buffer.from(PPTX);
  const eocdOffset = truncatedDirectory.length - 22;
  truncatedDirectory.writeUInt32LE(truncatedDirectory.readUInt32LE(eocdOffset + 12) + 8, eocdOffset + 12);
  expect(validateSiteVisitMaterial('deck.pptx', truncatedDirectory, 'presentation_source')).toEqual({ ok: false, reason: 'signature_mismatch' });
  expect(validateSiteVisitMaterial('', PDF, 'presentation_pdf')).toEqual({ ok: false, reason: 'filename_required' });
});
