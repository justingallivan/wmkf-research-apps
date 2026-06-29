/**
 * Tests for the reviewer rich-text sanitizer (stored-XSS boundary).
 *
 * Every known bypass vector from the build plan §4/§10 is a case here, asserting
 * the dangerous construct is stripped while legitimate formatting survives. Plus
 * plain-text rendition correctness and the emptiness check.
 *
 * @jest-environment node
 */

import {
  sanitizeReviewHtml,
  htmlToPlainText,
  isEffectivelyEmptyHtml,
} from '../../lib/external/sanitize-review-html.js';

describe('sanitizeReviewHtml — XSS bypass vectors are stripped', () => {
  test('<script> tag and its contents are removed entirely', () => {
    const out = sanitizeReviewHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert\(1\)/);
    expect(out).toContain('<p>hi</p>');
  });

  test('javascript: href is stripped (text preserved)', () => {
    const out = sanitizeReviewHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/href=/i);
    expect(out).toContain('click');
  });

  test('data: href is stripped', () => {
    const out = sanitizeReviewHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toMatch(/data:/i);
    expect(out).not.toMatch(/<script/i);
  });

  test('vbscript: href is stripped', () => {
    const out = sanitizeReviewHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(out).not.toMatch(/vbscript:/i);
  });

  test('protocol-relative //evil href is stripped', () => {
    const out = sanitizeReviewHtml('<a href="//evil.example/phish">x</a>');
    expect(out).not.toMatch(/evil\.example/);
    expect(out).not.toMatch(/href=/i);
  });

  test('entity-encoded javascript scheme is decoded then stripped', () => {
    const out = sanitizeReviewHtml('<a href="&#106;avascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toMatch(/javascript:/);
    expect(out).not.toMatch(/href=/i);
    expect(out).not.toMatch(/alert/);
  });

  test('<img onerror> is removed (img not allowed)', () => {
    const out = sanitizeReviewHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/onerror/i);
  });

  test('on* event attributes on allowed tags are stripped', () => {
    const out = sanitizeReviewHtml('<p onclick="alert(1)">text</p>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('text');
    expect(out).toMatch(/<p>/);
  });

  test('style attribute is stripped', () => {
    const out = sanitizeReviewHtml('<p style="position:fixed;top:0">x</p>');
    expect(out).not.toMatch(/style=/i);
    expect(out).toContain('x');
  });

  test('class attribute is stripped', () => {
    const out = sanitizeReviewHtml('<p class="evil">x</p>');
    expect(out).not.toMatch(/class=/i);
  });

  test('disallowed structural tags (div/span/table/iframe) are unwrapped, text kept', () => {
    const out = sanitizeReviewHtml('<div><span>keep</span> <iframe src="//evil"></iframe>this</div>');
    expect(out).not.toMatch(/<div|<span|<iframe/i);
    expect(out).toContain('keep');
    expect(out).toContain('this');
  });

  test('pasted raw HTML with mixed event handlers is neutralized', () => {
    const dirty = '<a href="https://ok.example" onmouseover="steal()">ok</a><svg onload="x()"></svg>';
    const out = sanitizeReviewHtml(dirty);
    expect(out).not.toMatch(/onmouseover|onload|<svg/i);
    expect(out).toContain('ok');
  });
});

describe('sanitizeReviewHtml — legitimate formatting survives', () => {
  test('standard formatting tags are preserved', () => {
    const html = '<p><strong>bold</strong> <em>it</em></p><ul><li>a</li></ul><h2>H</h2><blockquote>q</blockquote>';
    const out = sanitizeReviewHtml(html);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>it</em>');
    expect(out).toContain('<ul><li>a</li></ul>');
    expect(out).toContain('<h2>H</h2>');
    expect(out).toContain('<blockquote>q</blockquote>');
  });

  test('https link is kept and forced to safe rel/target', () => {
    const out = sanitizeReviewHtml('<a href="https://example.org">site</a>');
    expect(out).toMatch(/href="https:\/\/example\.org"/);
    expect(out).toMatch(/rel="noopener noreferrer nofollow"/);
    expect(out).toMatch(/target="_blank"/);
    expect(out).toContain('site');
  });

  test('mailto link is kept', () => {
    const out = sanitizeReviewHtml('<a href="mailto:a@b.org">mail</a>');
    expect(out).toMatch(/href="mailto:a@b\.org"/);
  });

  test('an empty href-less anchor is dropped as noise', () => {
    const out = sanitizeReviewHtml('<p>before<a></a>after</p>');
    expect(out).not.toMatch(/<a/i);
    expect(out).toContain('before');
    expect(out).toContain('after');
  });
});

describe('sanitizeReviewHtml — input guards', () => {
  test.each([null, undefined, '', 123, {}, []])('non-string/empty input %p returns empty string', (input) => {
    expect(sanitizeReviewHtml(input)).toBe('');
  });
});

describe('htmlToPlainText', () => {
  test('block boundaries and <br> become newlines', () => {
    const out = htmlToPlainText('<p>one</p><p>two<br>three</p>');
    expect(out).toBe('one\ntwo\nthree');
  });

  test('list items render on separate lines', () => {
    const out = htmlToPlainText('<ul><li>a</li><li>b</li></ul>');
    expect(out).toBe('a\nb');
  });

  test('entities are decoded after tag-strip', () => {
    expect(htmlToPlainText('<p>a &amp; b &lt;c&gt; &#39;d&#39;</p>')).toBe("a & b <c> 'd'");
  });

  test('a decoded angle bracket cannot reintroduce a tag', () => {
    const out = htmlToPlainText('<p>x &lt;script&gt;evil&lt;/script&gt; y</p>');
    expect(out).toContain('<script>evil</script>');
    expect(out).not.toMatch(/^<script/);
  });

  test('whitespace runs collapse and edges trim', () => {
    expect(htmlToPlainText('<p>  a    b  </p>')).toBe('a b');
  });

  test('non-string/empty returns empty string', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText('')).toBe('');
  });
});

describe('isEffectivelyEmptyHtml', () => {
  test.each(['', '<p></p>', '<p><br></p>', '<p>   </p>', '<ul><li></li></ul>'])(
    'structural-only markup %p is empty',
    (html) => {
      expect(isEffectivelyEmptyHtml(html)).toBe(true);
    },
  );

  test.each(['<p>real</p>', '<ul><li>x</li></ul>', '<p>&amp;</p>'])(
    'markup with visible text %p is not empty',
    (html) => {
      expect(isEffectivelyEmptyHtml(html)).toBe(false);
    },
  );
});
