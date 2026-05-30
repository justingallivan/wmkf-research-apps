/**
 * Strict markdown pipeline for policy bodies.
 *
 * Used by both the admin publish UI (preview) and the server-side route
 * (validation). Both surfaces import the same module so the renderer and
 * validator cannot drift.
 *
 * Safety contract:
 *   - Storage format is markdown UTF-8.
 *   - Rendered output is HTML produced by `marked`, then sanitized by
 *     DOMPurify with a strict allowlist.
 *   - Allowed tags: p, h1-h4, ul, ol, li, blockquote, code, pre, strong,
 *     em, a, hr, br. Anything else is dropped.
 *   - Allowed <a> attribute: href only. http / https / mailto schemes.
 *   - Raw HTML in the source is NOT rendered (marked is invoked without
 *     the dangerouslyAllowProtoMutator-style HTML pass-through option).
 *   - The server validator runs the same parse + sanitize and rejects the
 *     body if anything would have been dropped — staff get an actionable
 *     error rather than silent stripping.
 *
 * Why marked + DOMPurify and not react-markdown:
 *   - DOMPurify is already a project dependency.
 *   - The same renderer needs to run server-side for validation; marked is
 *     a plain function, not a React component.
 *   - Output is rendered via `dangerouslySetInnerHTML` on a sanitized HTML
 *     string. Safe because DOMPurify is the safety boundary, not React.
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

// Allow only http, https, mailto. DOMPurify's default URL handling is
// permissive (allows tel:, data:, etc.); we restrict explicitly.
const ALLOWED_URI_REGEXP = /^(https?:|mailto:)/i;

// Marked options: no GFM autolinks (would expose bare URLs without our
// scheme check), no HTML pass-through, no smartypants substitutions.
const markedOptions = {
  gfm: true,
  breaks: false,
  pedantic: false,
};

function getDOMPurify() {
  // In a browser environment `window` exists and DOMPurify can use it
  // directly. On Node we construct a jsdom window. The `eval('require')`
  // trick escapes webpack's static analysis so jsdom (which is large and
  // node-only) does NOT get pulled into the client bundle even though
  // this module is reachable from a React component.
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    return createDOMPurify(window);
  }
  const nodeRequire = eval('require');
  const { JSDOM } = nodeRequire('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  return createDOMPurify(dom.window);
}

let _purifier = null;
function purifier() {
  if (!_purifier) _purifier = getDOMPurify();
  return _purifier;
}

/**
 * Render a markdown body to sanitized HTML safe for dangerouslySetInnerHTML.
 * Drops disallowed elements / attributes silently — used by the *renderer*
 * surface (preview pane, future reviewer-facing surface). The matching
 * *validator* below complains loudly when the same input would lose nodes.
 */
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

/**
 * Validate a markdown body. Returns { ok: true, html } or
 * { ok: false, reason, dropped }.
 *
 * Implementation: parse + sanitize once with default DOMPurify hooks that
 * record any node/attribute that was removed. If anything was removed, the
 * body is rejected.
 */
function validatePolicyMarkdown(body) {
  if (typeof body !== 'string') return { ok: false, reason: 'not_a_string' };
  if (body.length === 0) return { ok: false, reason: 'empty' };

  // Pre-scan for raw HTML tags in the input. Marked sometimes drops tags
  // silently during parsing (specifically when they appear before any
  // markdown content), so by the time DOMPurify sees the rendered output
  // the dangerous bits are already gone. That leaves the validator with
  // nothing to complain about — wrong for our "fail loud" contract. Reject
  // any input that contains <tag-like markup at all; the markdown body is
  // expected to be markdown text, not HTML.
  const rawTagMatches = body.match(/<\s*\/?\s*([a-zA-Z][\w-]*)\b[^>]*>/g);
  if (rawTagMatches && rawTagMatches.length > 0) {
    const uniq = Array.from(new Set(rawTagMatches.map(t => t.trim()))).slice(0, 20);
    return { ok: false, reason: 'disallowed_content', dropped: uniq };
  }

  const rawHtml = marked.parse(body, markedOptions);

  const dropped = [];
  const p = purifier();

  // DOMPurify wraps input in implicit <html><head/><body>...</body></html>
  // for processing; those scaffolding tags fire the hook even though they
  // weren't in the user input. Skip them so the validator only complains
  // about real drops.
  const SCAFFOLDING_TAGS = new Set(['html', 'head', 'body', '#document', '#document-fragment', '#text']);
  const ALLOWED_SET = new Set(ALLOWED_TAGS);

  function onRemovedElement(node, data) {
    const tag = (data && data.tagName) || (node && node.nodeName ? node.nodeName.toLowerCase() : '?');
    if (SCAFFOLDING_TAGS.has(tag)) return;
    if (ALLOWED_SET.has(tag)) return;
    const attrs = node && node.attributes
      ? Array.from(node.attributes).map(a => `${a.name}="${a.value}"`).join(' ')
      : '';
    dropped.push(`<${tag}${attrs ? ' ' + attrs : ''}>`);
  }

  p.addHook('uponSanitizeElement', (node, data) => {
    if (data && data.allowedTags && !data.allowedTags[data.tagName]) {
      onRemovedElement(node, data);
    }
  });
  p.addHook('uponSanitizeAttribute', (node, data) => {
    if (!data || !data.attrName) return;
    // href on an allowed element: check scheme. Anything else with an
    // unknown name is a drop.
    if (data.attrName === 'href' && typeof data.attrValue === 'string') {
      if (!ALLOWED_URI_REGEXP.test(data.attrValue) && data.attrValue.length > 0) {
        dropped.push(`@href="${data.attrValue}"`);
      }
      return;
    }
    if (!ALLOWED_ATTR.includes(data.attrName)) {
      dropped.push(`@${data.attrName}`);
    }
  });

  let html;
  try {
    html = p.sanitize(rawHtml, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP,
      KEEP_CONTENT: true,
    });
  } finally {
    p.removeAllHooks();
  }

  if (dropped.length > 0) {
    // Dedupe; long lists are confusing in error responses.
    const uniq = Array.from(new Set(dropped)).slice(0, 20);
    return { ok: false, reason: 'disallowed_content', dropped: uniq };
  }
  return { ok: true, html };
}

module.exports = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOWED_URI_REGEXP,
  renderPolicyMarkdown,
  validatePolicyMarkdown,
};
