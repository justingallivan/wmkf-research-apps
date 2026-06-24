/**
 * Server markdown validator for policy bodies.
 *
 * The browser renderer uses DOMPurify, but this server path intentionally avoids
 * jsdom and DOM APIs so Vercel does not need to bundle or require jsdom.
 */

const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote',
  'code', 'pre',
  'strong', 'em',
  'a',
  'hr', 'br',
];

const markedOptions = {
  gfm: true,
  breaks: false,
  pedantic: false,
};

const sanitizeOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  disallowedTagsMode: 'discard',
};

function findDroppedContent(rawHtml, sanitizedHtml) {
  if (rawHtml === sanitizedHtml) return [];

  const dropped = [];
  const rawTagMatches = rawHtml.match(/<\s*\/?\s*([a-zA-Z][\w-]*)\b[^>]*>/g) || [];
  for (const tag of rawTagMatches) {
    const tagNameMatch = tag.match(/^<\s*\/?\s*([a-zA-Z][\w-]*)/);
    const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : null;
    if (tagName && !ALLOWED_TAGS.includes(tagName)) {
      dropped.push(tag.trim());
    }
  }

  const hrefMatches = rawHtml.match(/\shref\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/gi) || [];
  for (const attr of hrefMatches) {
    const valueMatch = attr.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = valueMatch ? (valueMatch[1] || valueMatch[2] || valueMatch[3] || '') : '';
    if (href && !/^(https?:|mailto:)/i.test(href)) {
      dropped.push(`@href="${href}"`);
    }
  }

  if (dropped.length === 0) dropped.push('sanitized_output_changed');
  return Array.from(new Set(dropped)).slice(0, 20);
}

function validatePolicyMarkdown(body) {
  if (typeof body !== 'string') return { ok: false, reason: 'not_a_string' };
  if (body.length === 0) return { ok: false, reason: 'empty' };

  const rawTagMatches = body.match(/<\s*\/?\s*([a-zA-Z][\w-]*)\b[^>]*>/g);
  if (rawTagMatches && rawTagMatches.length > 0) {
    const uniq = Array.from(new Set(rawTagMatches.map(t => t.trim()))).slice(0, 20);
    return { ok: false, reason: 'disallowed_content', dropped: uniq };
  }

  const rawHtml = marked.parse(body, markedOptions);
  const html = sanitizeHtml(rawHtml, sanitizeOptions);
  const dropped = findDroppedContent(rawHtml, html);

  if (dropped.length > 0) {
    return { ok: false, reason: 'disallowed_content', dropped };
  }
  return { ok: true, html };
}

module.exports = {
  validatePolicyMarkdown,
};
