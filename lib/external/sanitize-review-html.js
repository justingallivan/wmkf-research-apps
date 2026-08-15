/**
 * Server-side sanitizer for reviewer-authored rich-text answers.
 *
 * Reviewer HTML is UNTRUSTED content that is later rendered to staff in the
 * Workbench → stored-XSS risk. This module is the security boundary: it runs
 * on EVERY write (autosave PUT and final submit), not just at render. The
 * Workbench render path re-sanitizes immediately before dangerouslySetInnerHTML
 * (defense in depth). The browser tiptap editor is convenience, never the
 * boundary.
 *
 * DOM-FREE BY DESIGN. Uses `sanitize-html` (a string→string sanitizer), never
 * DOMPurify+jsdom — jsdom does not load under Vercel/Turbopack serverless
 * (memory: project-jsdom-serverless-esm-incompat). Mirrors the same choice in
 * shared/utils/policy-markdown-server.js.
 *
 * Contract (docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §4):
 *   - sanitizeReviewHtml(html) → sanitized HTML string (the enumerated allowlist).
 *   - htmlToPlainText(html)    → clean plain-text rendition (for Connor's Excel
 *                                export and the wmkf_answertext column). Strips
 *                                tags, decodes entities, preserves block/list
 *                                breaks as newlines.
 *   - isEffectivelyEmptyHtml(html) → true when there is no visible text after
 *                                tag-strip (so "<p></p>"/"<p><br></p>" count as
 *                                empty for the required-field check, §9 #E).
 */

import sanitizeHtml from 'sanitize-html';

// Formatting accepted from current and historical reviewer editors. Both live
// authoring surfaces expose the compact inline set; structural tags remain
// accepted so previously saved reviews retain their formatting. Nothing else:
// no images, no tables, no spans/divs, no style/class.
const ALLOWED_TAGS = [
  'p', 'br',
  'strong', 'b', 'em', 'i', 'sub', 'sup',
  'ul', 'ol', 'li',
  'h2', 'h3',
  'blockquote',
  'a',
];

const SANITIZE_OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  // Only links carry attributes, and only the three we control. No attribute on
  // any other tag — this is what kills style="", class="", and every on* event
  // handler (onerror/onclick/onload/...).
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
  },
  // https + mailto only. Drops javascript:, data:, vbscript:, file:, etc.
  // sanitize-html decodes HTML entities before the scheme test, so an encoded
  // scheme like "&#106;avascript:" is caught too.
  allowedSchemes: ['https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // "//evil.example" would otherwise inherit the page scheme — forbid it.
  allowProtocolRelative: false,
  // Remove disallowed tags but keep their text (script/style contents are
  // always dropped — they live in sanitize-html's nonTextTags).
  disallowedTagsMode: 'discard',
  // Force safe rel/target on every surviving link. simpleTransform with the
  // merge flag adds these alongside any (already allowlisted) href.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    }, true),
  },
  // Drop a link that ends up with neither an href nor any text — pure noise
  // (e.g. an anchor whose javascript: href was stripped and that had no label).
  // An anchor that still has text is KEPT (we never silently delete content);
  // its dangerous href, if any, was already removed by the scheme allowlist.
  exclusiveFilter(frame) {
    return frame.tag === 'a' && !frame.attribs.href && !frame.text.trim();
  },
};

/**
 * Sanitize reviewer-authored HTML to the enumerated allowlist above.
 * Returns '' for non-string / empty input.
 *
 * @param {string} html
 * @returns {string} sanitized HTML
 */
export function sanitizeReviewHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return '';
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

// Minimal HTML entity decode for the plain-text rendition. We only need the
// handful sanitize-html emits in text nodes; a full decoder would pull in a DOM.
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const codePoint = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

/**
 * Derive a clean plain-text rendition of reviewer HTML for the
 * wmkf_answertext column / Excel export. Block-level boundaries and <br>
 * become newlines; all tags are stripped; entities decoded; whitespace
 * collapsed. Intended to run on ALREADY-SANITIZED html, but is safe on raw
 * input too (it only strips, never executes).
 *
 * @param {string} html
 * @returns {string} plain text
 */
export function htmlToPlainText(html) {
  if (typeof html !== 'string' || html.length === 0) return '';

  let text = html;
  // List items and <br> → single newline; close of block elements → newline.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|li|h2|h3|blockquote|ul|ol)>/gi, '\n');
  // Strip every remaining tag (opening, closing, self-closing).
  text = text.replace(/<[^>]*>/g, '');
  // Decode entities AFTER tag-strip so a decoded "<" can't reintroduce a tag.
  text = decodeEntities(text);
  // Normalize whitespace: tabs/spaces collapse; 3+ newlines → 2; trim edges.
  text = text.replace(/[ \t\f\v]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * True when the HTML has no visible text after tag-strip — i.e. the editor
 * emitted structural-only markup like "<p></p>" or "<p><br></p>". Used by the
 * required-field validator (§9 #E): emptiness is tested on content, not on the
 * raw string being non-empty.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function isEffectivelyEmptyHtml(html) {
  return htmlToPlainText(html).length === 0;
}
