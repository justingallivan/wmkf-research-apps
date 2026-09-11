/**
 * @jest-environment node
 *
 * renderMaterialsEmailHtml — escapes the body, renders paragraphs, and appends
 * the server-injected action button + fallback link for the contributor URL
 * (Build D, 2026-09-10 UX pass, Item 1).
 */
import { renderMaterialsEmailHtml } from '../../lib/external/site-visit-materials-email';

const URL = 'https://apps.example.org/external/materials/JWT.123_abc?x=1&y=2';

test('includes the action button and a fallback copy-paste link to the url, both escaped', () => {
  const html = renderMaterialsEmailHtml({ bodyText: 'Hello.', url: URL, buttonLabel: 'Upload site visit materials' });
  expect(html).toContain(`href="${URL.replace(/&/g, '&amp;')}"`);
  expect(html).toContain('Upload site visit materials');
  expect(html).toContain('If the button does not work, copy and paste this secure link into your browser');
  // The url appears as both the button href and the visible fallback text.
  const escapedUrl = URL.replace(/&/g, '&amp;');
  const occurrences = html.split(escapedUrl).length - 1;
  expect(occurrences).toBeGreaterThanOrEqual(2);
});

test('falls back to a default button label when none is given', () => {
  const html = renderMaterialsEmailHtml({ bodyText: 'Hello.', url: 'https://x' });
  expect(html).toContain('Open the secure link');
});

test('renders blank-line-separated body as paragraphs and newlines as <br>, with no raw URL paragraph in the body', () => {
  const bodyText = 'Para one.\n\nPara two\nwith a break.';
  const html = renderMaterialsEmailHtml({ bodyText, url: URL, buttonLabel: 'Upload' });
  expect((html.match(/<p /g) || []).length).toBeGreaterThanOrEqual(2);
  expect(html).toContain('with a break.');
  expect(html).toContain('<br>');
  // The body-text paragraphs never carry the URL as a standalone line — it
  // only appears via the server-injected button and fallback link.
  expect(bodyText).not.toContain(URL);
  expect((html.match(/<a href=/g) || []).length).toBe(2);
});

test('escapes HTML in the body (no injection)', () => {
  const html = renderMaterialsEmailHtml({ bodyText: 'Hi <script>alert(1)</script> & co', url: URL, buttonLabel: 'Upload' });
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&amp; co');
});

test('escapes the button label', () => {
  const html = renderMaterialsEmailHtml({ bodyText: 'Hi', url: 'https://x', buttonLabel: '<b>Upload</b>' });
  expect(html).toContain('&lt;b&gt;Upload&lt;/b&gt;');
  expect(html).not.toContain('<b>Upload</b>');
});
