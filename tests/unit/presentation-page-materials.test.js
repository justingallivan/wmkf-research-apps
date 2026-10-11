import { arrangeMaterials, displayName } from '../../shared/utils/presentation-page-materials.js';

const m = (member, kind, contentType, extra = {}) => ({ member, kind, contentType, backing: 'file', filename: `${member}.bin`, ...extra });
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

test('display names drop the request number and extension', () => {
  expect(displayName('1003222 Site Visit Participant Bios.docx')).toBe('Site Visit Participant Bios');
  expect(displayName('1003222-Letters_of_support.pdf')).toBe('Letters of support');
  expect(displayName('Budget.xlsx')).toBe('Budget');
  expect(displayName('')).toBe('Additional material');
});

test('before the visit: slides pair into one item and bios stay separate; no video or summary', () => {
  const arranged = arrangeMaterials([m('bios', 'other', 'application/msword'), m('pptx', 'slides', PPTX), m('pdf', 'slides', 'application/pdf')]);
  expect(arranged).toMatchObject({ video: null, summary: null, slidesPdf: { member: 'pdf' }, slidesOriginal: { member: 'pptx' } });
  expect(arranged.others.map((x) => x.member)).toEqual(['bios']);
});

test('after the visit: video and summary are picked out regardless of arrival order', () => {
  const arranged = arrangeMaterials([m('pdf', 'slides', 'application/pdf'), m('sum', 'summary', 'text/plain'), m('vid', 'video', 'video/mp4')]);
  expect(arranged.video.member).toBe('vid');
  expect(arranged.summary.member).toBe('sum');
  expect(arranged.slidesOriginal).toBeNull();
});

test('a second PDF of slides is never labeled as the PowerPoint; extras list on their own', () => {
  const arranged = arrangeMaterials([m('a', 'slides', 'application/pdf'), m('b', 'slides', 'application/pdf; charset=binary')]);
  expect(arranged.slidesPdf.member).toBe('a');
  expect(arranged.slidesOriginal).toBeNull();
  expect(arranged.others.map((x) => x.member)).toEqual(['b']);
});

test('a video that is not file-backed is not offered for playback', () => {
  expect(arrangeMaterials([m('vid', 'video', 'video/mp4', { backing: 'external' })]).video).toBeNull();
});
