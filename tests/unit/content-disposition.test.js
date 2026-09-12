/** @jest-environment node */

import { contentDisposition } from '../../lib/utils/content-disposition';

test('rejects a type other than inline/attachment', () => {
  expect(() => contentDisposition('bogus', 'a.pdf')).toThrow(/inline.*attachment/);
});

test('quotes and backslashes are stripped from the ASCII fallback', () => {
  const header = contentDisposition('attachment', 'a "quoted" \\name\\.docx');
  expect(header).toContain('filename="a quoted name.docx"');
  expect(header).not.toMatch(/[\\]/);
});

test('CR/LF cannot be injected into either filename value', () => {
  const header = contentDisposition('attachment', 'evil.docx\r\nX-Evil: 1');
  expect(header).not.toMatch(/[\r\n]/);
});

test('non-ASCII characters are replaced in the fallback but preserved via filename*', () => {
  const header = contentDisposition('attachment', 'Rapport Résumé.docx');
  expect(header).toContain('filename="Rapport R_sum_.docx"');
  expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('Rapport Résumé.docx')}`);
});

test('an empty/unusable name falls back to "download"', () => {
  const header = contentDisposition('inline', '');
  expect(header).toBe(`inline; filename="download"; filename*=UTF-8''download`);
});
