/**
 * Grantee document markdown — the ONE shared inline renderer for chunk-8
 * document assembly (spec D8; build-plan chunk 8 "one markdown subset + render
 * policy"). Every assembled output (portal preview, website HTML, cycle export)
 * renders the abstract body + image caption through THIS module, so no surface
 * can drift on which markup it honors or how it sanitizes.
 *
 * Canonical inline subset (D8): **bold**, *italic*, super/subscript. Bold and
 * italic use the CommonMark markers (`**` / `*`); super/subscript use the
 * pandoc convention — `^text^` (superscript) and `~text~` (subscript), e.g.
 * `H~2~O`, `x^2^`. Nothing else is honored.
 *
 * Safety contract (mirrors shared/utils/policy-markdown-server.js):
 *   - Storage is plain UTF-8 markdown in the Dataverse memo (NO RichText flip).
 *   - Rendered HTML is produced by `marked` (a private Marked instance so the
 *     sub/sup extensions never leak into the global `marked` that policy-markdown
 *     uses), then sanitized by `sanitize-html` to a tight allowlist. This module
 *     is server-only (all consumers are lib/services/*), so it deliberately uses
 *     a DOM-free sanitizer rather than DOMPurify+jsdom — jsdom can't load in the
 *     Vercel/Turbopack serverless runtime (ESM-require). See policy-markdown-server.js.
 *   - Body allowlist:    p, br, strong, em, sub, sup
 *   - Caption allowlist:    strong, em, sub, sup, br   (inline; no <p>)
 *   - No attributes, no links, no raw HTML pass-through. Anything else is
 *     dropped (KEEP_CONTENT keeps the text).
 *
 * The edited title (`wmkf_wmkfprojectdescription`) is deliberately NOT rendered
 * here — it is plain text, italicized *structurally* by each consumer, so no raw
 * markdown can reach the Board Book (its only external consumer). See the
 * assembly service (lib/services/grantee-document-assembly.js).
 */

const { Marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const BODY_TAGS = ['p', 'br', 'strong', 'em', 'sub', 'sup'];
const CAPTION_TAGS = ['strong', 'em', 'sub', 'sup', 'br'];
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

// Pandoc-style superscript: ^text^ (no spaces, single line, starts non-space).
const supExtension = {
  name: 'gsup',
  level: 'inline',
  start(src) { const i = src.indexOf('^'); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\^(?=\S)([^\^\n]+?)\^/.exec(src);
    if (!m) return undefined;
    return { type: 'gsup', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
  },
  renderer(token) { return `<sup>${this.parser.parseInline(token.tokens)}</sup>`; },
};

// Pandoc-style subscript: ~text~ (no spaces, single line, starts non-space).
const subExtension = {
  name: 'gsub',
  level: 'inline',
  start(src) { const i = src.indexOf('~'); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^~(?=\S)([^~\n]+?)~/.exec(src);
    if (!m) return undefined;
    return { type: 'gsub', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
  },
  renderer(token) { return `<sub>${this.parser.parseInline(token.tokens)}</sub>`; },
};

// Private instance: gfm:false so `~`/`~~` is NOT strikethrough (we own `~` for
// subscript); no HTML pass-through; no smart autolinks.
let _marked = null;
function getMarked() {
  if (!_marked) {
    _marked = new Marked({
      gfm: false,
      breaks: false,
      pedantic: false,
      renderer: {
        html(src) {
          return escapeHtml(src);
        },
      },
    });
    _marked.use({ extensions: [supExtension, subExtension] });
  }
  return _marked;
}

// DOM-free sanitization via `sanitize-html`. disallowedTagsMode 'discard' drops
// any tag outside the allowlist while keeping its text content (the old DOMPurify
// KEEP_CONTENT behavior), and an empty allowedAttributes map strips every
// attribute (the old NO_ATTR allowlist).
function sanitize(rawHtml, tags) {
  return sanitizeHtml(rawHtml, {
    allowedTags: tags,
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
}

/**
 * Render an abstract body (block markdown → paragraphs) to sanitized HTML safe
 * for dangerouslySetInnerHTML / direct emission. Plain prose becomes <p> blocks.
 */
function renderGranteeBody(body) {
  if (typeof body !== 'string' || body.length === 0) return '';
  return sanitize(getMarked().parse(body), BODY_TAGS);
}

/**
 * Render a caption (inline markdown, no paragraph wrapping) to sanitized HTML.
 */
function renderGranteeCaption(caption) {
  if (typeof caption !== 'string' || caption.length === 0) return '';
  return sanitize(getMarked().parseInline(caption), CAPTION_TAGS);
}

module.exports = {
  BODY_TAGS,
  CAPTION_TAGS,
  renderGranteeBody,
  renderGranteeCaption,
};
