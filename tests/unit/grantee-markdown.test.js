/**
 * Grantee document markdown — the ONE shared renderer for chunk-8 assembly.
 * Covers the inline subset (bold/italic via CommonMark, super/subscript via the
 * pandoc convention), the block-vs-inline split (body wraps <p>, caption does
 * not), the tight allowlist (links/headings/raw-HTML dropped, content kept), and
 * XSS sanitization.
 *
 * @jest-environment jsdom
 *
 * jsdom (project default) so DOMPurify finds `window` directly — avoids importing
 * jsdom at runtime in tests (its ESM-only transitive deps don't play with Jest's
 * CJS loader). The renderer itself runs fine server-side in Next.js. Same pattern
 * as policy-markdown.test.js / app-markdown.test.js.
 */
import { renderGranteeBody, renderGranteeCaption } from '../../shared/utils/grantee-markdown';

describe('renderGranteeBody', () => {
  test('plain prose becomes a paragraph', () => {
    expect(renderGranteeBody('Hello world.').trim()).toBe('<p>Hello world.</p>');
  });

  test('bold and italic render to strong/em', () => {
    const html = renderGranteeBody('A **bold** and *italic* line.');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  test('literal raw HTML is escaped to text, not rendered as allowed tags', () => {
    const html = renderGranteeBody('Typed <strong>raw</strong> HTML.');
    expect(html).toContain('&lt;strong&gt;raw&lt;/strong&gt;');
    expect(html).not.toContain('<strong>raw</strong>');
  });

  test('markdown bold still renders to strong', () => {
    const html = renderGranteeBody('Typed **md** markup.');
    expect(html).toContain('<strong>md</strong>');
  });

  test('pandoc superscript ^x^ and subscript ~x~', () => {
    expect(renderGranteeBody('x^2^')).toContain('<sup>2</sup>');
    expect(renderGranteeBody('H~2~O')).toContain('<sub>2</sub>');
  });

  test('superscript can wrap nested emphasis', () => {
    expect(renderGranteeBody('x^*n*^')).toContain('<sup><em>n</em></sup>');
  });

  test('a lone ~ with a space is left literal (not subscript)', () => {
    const html = renderGranteeBody('pH 7 ~ 8 range');
    expect(html).not.toContain('<sub>');
  });

  test('links are dropped but their text is kept', () => {
    const html = renderGranteeBody('see [the site](https://example.com) now');
    expect(html).not.toContain('<a');
    expect(html).toContain('the site');
  });

  test('headings are dropped to plain text', () => {
    const html = renderGranteeBody('# Big Heading');
    expect(html).not.toContain('<h1');
    expect(html).toContain('Big Heading');
  });

  test('raw HTML / script is escaped to inert text', () => {
    const html = renderGranteeBody('safe <script>alert(1)</script> text');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('safe');
  });

  test('img with onerror is escaped to inert text', () => {
    const html = renderGranteeBody('x <img src=x onerror=alert(1)> y');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('empty / non-string → empty string', () => {
    expect(renderGranteeBody('')).toBe('');
    expect(renderGranteeBody(null)).toBe('');
    expect(renderGranteeBody(undefined)).toBe('');
    expect(renderGranteeBody(42)).toBe('');
  });
});

describe('renderGranteeCaption', () => {
  test('inline render does not wrap in <p>', () => {
    const html = renderGranteeCaption('A *italic* caption');
    expect(html).not.toContain('<p>');
    expect(html).toContain('<em>italic</em>');
  });

  test('subscript works inline', () => {
    expect(renderGranteeCaption('CO~2~ flux')).toContain('<sub>2</sub>');
  });

  test('empty → empty string', () => {
    expect(renderGranteeCaption('')).toBe('');
    expect(renderGranteeCaption(null)).toBe('');
  });
});
