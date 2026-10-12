import { staffReaderHref } from '../../shared/utils/staff-reader.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const DOC = '99999999-9999-4999-8999-999999999999';
const txt = (over = {}) => ({ artifactId: DOC, artifactType: 100000007, backing: 'file', filename: 'summary.txt', contentType: 'text/plain; charset=utf-8', ...over });

test('links readable plain-text types to the reading page', () => {
  for (const artifactType of [100000006, 100000012, 100000013, 100000007, 100000010]) {
    expect(staffReaderHref(REQUEST_ID, txt({ artifactType }))).toBe(`/workbench/read?request=${REQUEST_ID}&document=${DOC}`);
  }
});

test('null for other types, non-TXT files, external backing, or missing ids', () => {
  for (const material of [
    txt({ artifactType: 100000005 }), txt({ artifactType: 100000011 }), txt({ contentType: 'application/pdf' }),
    txt({ filename: 'summary.docx' }), txt({ contentType: 'text/vtt', filename: 't.vtt' }), txt({ backing: 'external' }),
    txt({ artifactId: null }), null,
  ]) expect(staffReaderHref(REQUEST_ID, material)).toBeNull();
  expect(staffReaderHref(null, txt())).toBeNull();
});
