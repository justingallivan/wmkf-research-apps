/**
 * Grantee document HTML — presentation layer for chunk-8 outputs. Covers the
 * structural formatting (institution bold; location/investigators/title italic;
 * amount plain), empty-field omission, plain-text escaping, pre-sanitized body
 * inlining, the image-figure placeholder (no fabricated <img src>), and the
 * standalone cycle page.
 *
 * @jest-environment node
 */
const { esc, renderAwardBlock, renderCyclePage } = require('../../lib/services/grantee-document-html');

const MODEL = {
  requestId: 'r1',
  requestNumber: '1003100',
  institution: 'Oregon State University',
  location: 'Corvallis, OR',
  names: 'Kristen Buck and Mya Breitbart',
  amountFormatted: '$1,200,000',
  editedTitle: 'To determine whether marine viruses store iron in the surface ocean',
  bodyHtml: '<p>In nearly half of the global surface ocean…</p>',
  caption: 'A virus',
  captionHtml: 'A virus',
  hasImage: false,
};

describe('esc', () => {
  test('escapes HTML metacharacters', () => {
    expect(esc('A & B <c> "d" \'e\'')).toBe('A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;');
  });
  test('null/undefined → empty', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('renderAwardBlock', () => {
  test('renders the structural formatting per field', () => {
    const html = renderAwardBlock(MODEL);
    expect(html).toContain('<p class="institution"><strong>Oregon State University</strong></p>');
    expect(html).toContain('<p class="location"><em>Corvallis, OR</em></p>');
    expect(html).toContain('<p class="investigators"><em>Kristen Buck and Mya Breitbart</em></p>');
    expect(html).toContain('<p class="amount">$1,200,000</p>');
    expect(html).toContain('<p class="edited-title"><em>To determine whether marine viruses store iron in the surface ocean</em></p>');
    expect(html).toContain('<div class="abstract-body"><p>In nearly half of the global surface ocean…</p></div>');
  });

  test('omits empty fields entirely (no stray tags)', () => {
    const html = renderAwardBlock({ institution: 'X University' });
    expect(html).toContain('X University');
    expect(html).not.toContain('class="location"');
    expect(html).not.toContain('class="amount"');
    expect(html).not.toContain('class="edited-title"');
    expect(html).not.toContain('class="abstract-body"');
  });

  test('escapes plain-text fields but inlines pre-sanitized body as-is', () => {
    const html = renderAwardBlock({
      institution: 'A & B <Lab>',
      bodyHtml: '<p>ok <em>em</em></p>',
    });
    expect(html).toContain('<strong>A &amp; B &lt;Lab&gt;</strong>');
    expect(html).toContain('<p>ok <em>em</em></p>'); // body not double-escaped
  });

  test('image figure appears only when includeImage AND hasImage', () => {
    const withImg = { ...MODEL, hasImage: true, imageFileRef: 'sites/x/img.jpg', captionHtml: 'A <em>virus</em>' };
    const noFlag = renderAwardBlock(withImg, { includeImage: false });
    expect(noFlag).not.toContain('<figure');

    const yes = renderAwardBlock(withImg, { includeImage: true });
    expect(yes).toContain('<figure class="grantee-image">');
    expect(yes).toContain('<!-- image: sites/x/img.jpg');
    expect(yes).toContain('<figcaption>A <em>virus</em></figcaption>');
    expect(yes).not.toContain('<img'); // never a fabricated public <img src>
  });

  test('null model → empty string', () => {
    expect(renderAwardBlock(null)).toBe('');
  });
});

describe('renderCyclePage', () => {
  test('wraps blocks in a standalone document with heading + count', () => {
    const page = renderCyclePage([MODEL, { institution: 'Caltech' }], { cycleLabel: 'June 2026' });
    expect(page.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(page).toContain('<title>June 2026 — awarded research</title>');
    expect(page).toContain('<h1>June 2026 — awarded research</h1>');
    expect(page).toContain('2 awards');
    expect(page).toContain('Oregon State University');
    expect(page).toContain('Caltech');
  });

  test('singular count + default heading', () => {
    const page = renderCyclePage([MODEL]);
    expect(page).toContain('1 award<');
    expect(page).toContain('Awarded research');
  });

  test('empty list → valid page, zero awards', () => {
    const page = renderCyclePage([]);
    expect(page).toContain('0 awards');
  });
});
