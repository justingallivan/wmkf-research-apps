/** @jest-environment node */
import { validateSiteVisitMaterial, slotExtensions } from '../../lib/utils/site-visit-material-file';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]);
const office = (root) => Buffer.concat([ZIP, Buffer.from(`[Content_Types].xml ... ${root}document.xml`)]);
const PPTX = office('ppt/');
const DOCX = office('word/');
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
  expect(validateSiteVisitMaterial('', PDF, 'presentation_pdf')).toEqual({ ok: false, reason: 'filename_required' });
});
