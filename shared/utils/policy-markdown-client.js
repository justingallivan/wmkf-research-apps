/**
 * Browser markdown renderer for policy bodies.
 *
 * Safety contract:
 *   - Storage format is markdown UTF-8.
 *   - Rendered output is HTML produced by `marked`, then sanitized by
 *     DOMPurify with a strict allowlist.
 *   - Allowed tags: p, h1-h6, ul, ol, li, blockquote, code, pre, strong,
 *     em, a, hr, br. Anything else is dropped.
 *   - Allowed <a> attribute: href only. http / https / mailto schemes.
 */

const { marked } = require('marked');
const createDOMPurify = require('dompurify');

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote',
  'code', 'pre',
  'strong', 'em',
  'a',
  'hr', 'br',
];

const ALLOWED_ATTR = ['href'];
const ALLOWED_URI_REGEXP = /^(https?:|mailto:)/i;

const markedOptions = {
  gfm: true,
  breaks: false,
  pedantic: false,
};

let _purifier = null;
function purifier() {
  if (!_purifier) {
    if (typeof window === 'undefined' || typeof window.document === 'undefined') {
      throw new Error('renderPolicyMarkdown requires a browser window');
    }
    _purifier = createDOMPurify(window);
  }
  return _purifier;
}

function renderPolicyMarkdown(body) {
  if (typeof body !== 'string' || body.length === 0) return '';
  const rawHtml = marked.parse(body, markedOptions);
  return purifier().sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  });
}

module.exports = {
  renderPolicyMarkdown,
};
