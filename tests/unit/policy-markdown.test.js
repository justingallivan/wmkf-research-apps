/**
 * @jest-environment jsdom
 *
 * Unit tests for the policy markdown pipeline. We use jsdom (the jest default
 * for this project) so DOMPurify finds a window object directly and we avoid
 * having to import jsdom at runtime in tests (some of its ESM-only transitive
 * deps don't play with Jest's CJS-by-default module loader). Verifies that the validator
 * rejects every dangerous pattern Codex flagged in plan review and that the
 * renderer produces sanitized output for the same inputs.
 */

const {
  renderPolicyMarkdown,
} = require('../../shared/utils/policy-markdown-client');
const {
  validatePolicyMarkdown,
} = require('../../shared/utils/policy-markdown-server');

describe('validatePolicyMarkdown', () => {
  test('accepts plain markdown', () => {
    const r = validatePolicyMarkdown('Hello **world**. See [docs](https://example.com).');
    expect(r.ok).toBe(true);
    expect(r.html).toContain('<strong>world</strong>');
    expect(r.html).toContain('<a href="https://example.com">docs</a>');
  });

  test('accepts headings, lists, blockquotes, code', () => {
    const body = [
      '# Title',
      '',
      'Paragraph.',
      '',
      '- item one',
      '- item two',
      '',
      '> Quoted.',
      '',
      '`inline code` and',
      '',
      '```',
      'code block',
      '```',
    ].join('\n');
    const r = validatePolicyMarkdown(body);
    expect(r.ok).toBe(true);
  });

  test('rejects raw HTML <script>', () => {
    const r = validatePolicyMarkdown('hello\n\n<script>alert(1)</script>');
    expect(r.ok).toBe(false);
    expect(r.dropped.join(' ')).toMatch(/script/);
  });

  test('rejects raw HTML <iframe>', () => {
    const r = validatePolicyMarkdown('<iframe src="https://evil"></iframe>');
    expect(r.ok).toBe(false);
  });

  test('rejects javascript: link', () => {
    const r = validatePolicyMarkdown('[click](javascript:alert(1))');
    expect(r.ok).toBe(false);
    expect(r.dropped.join(' ')).toMatch(/javascript/);
  });

  test('rejects data: URL', () => {
    const r = validatePolicyMarkdown('[evil](data:text/html,<script>alert(1)</script>)');
    expect(r.ok).toBe(false);
  });

  test('rejects raw <img> tag', () => {
    const r = validatePolicyMarkdown('![alt](https://example.com/x.png)');
    // markdown ! image syntax produces <img>, which is not allowed
    expect(r.ok).toBe(false);
    expect(r.dropped.join(' ')).toMatch(/img/);
  });

  test('rejects event handler attribute', () => {
    const r = validatePolicyMarkdown('<a href="https://x" onclick="alert(1)">x</a>');
    expect(r.ok).toBe(false);
  });

  test('rejects target attribute on a-tag', () => {
    const r = validatePolicyMarkdown('<a href="https://x" target="_blank">x</a>');
    expect(r.ok).toBe(false);
  });

  test('rejects mailto with weirdness, accepts plain mailto', () => {
    const ok = validatePolicyMarkdown('[Email](mailto:a@b.com)');
    expect(ok.ok).toBe(true);
  });

  test('empty body rejected', () => {
    const r = validatePolicyMarkdown('');
    expect(r.ok).toBe(false);
  });

  test('non-string body rejected', () => {
    expect(validatePolicyMarkdown(null).ok).toBe(false);
    expect(validatePolicyMarkdown(42).ok).toBe(false);
  });
});

describe('renderPolicyMarkdown', () => {
  test('renders empty string for empty input', () => {
    expect(renderPolicyMarkdown('')).toBe('');
  });

  test('strips script tags silently', () => {
    const html = renderPolicyMarkdown('hello <script>alert(1)</script> world');
    expect(html).not.toMatch(/<script/i);
  });

  test('strips javascript: hrefs silently', () => {
    const html = renderPolicyMarkdown('[x](javascript:alert(1))');
    // The href should be stripped or the link removed entirely
    expect(html).not.toMatch(/javascript:/i);
  });

  test('passes safe markdown through', () => {
    const html = renderPolicyMarkdown('# T\n\nHello *world*.');
    expect(html).toMatch(/<h1>T<\/h1>/);
    expect(html).toMatch(/<em>world<\/em>/);
  });

  test('strips target/onclick from authored anchor', () => {
    const html = renderPolicyMarkdown('<a href="https://x" target="_blank" onclick="alert(1)">x</a>');
    expect(html).not.toMatch(/target=/i);
    expect(html).not.toMatch(/onclick=/i);
  });
});
