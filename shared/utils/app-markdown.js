/**
 * Lenient markdown pipeline for app-facing content (QA responses,
 * refinement feedback, etc.). Sibling to `shared/utils/policy-markdown.js`,
 * which uses a stricter allowlist and adds a `validate*` companion for
 * policy bodies.
 *
 * Trust model:
 *   - Inputs are LLM-generated assistant messages from `/api/qa`. The
 *     model receives proposal text, summary text, staff question text,
 *     and prior QA messages — any of which could carry adversarial
 *     content (prompt injection inside an uploaded proposal, a
 *     malicious staff question, etc.) that the model then reflects
 *     back as raw HTML, classes, or links. We do NOT assume the
 *     input is safe; the renderer + DOMPurify + the per-attribute
 *     hooks installed below are the safety boundary.
 *
 * Difference from policy-markdown.js:
 *   - Allows `class` attributes, but ONLY for the Tailwind class
 *     strings our marked renderer emits (allowlist enforced via the
 *     `uponSanitizeAttribute` hook). User-injected class values are
 *     stripped — closes the "raw HTML uses existing bundle utilities
 *     for UI redress" attack vector.
 *   - No validator companion — there is no "fail loud" surface here;
 *     disallowed nodes/attrs are stripped silently.
 *   - `<a href>` enforced to http(s)/mailto schemes regardless of
 *     source. The custom renderer's link function drops the wrapper
 *     on disallowed schemes for marked-emitted links; the DOMPurify
 *     hook catches raw HTML links that bypass the renderer
 *     (DOMPurify's defaults allow tel/ftp/callto/sms/cid/xmpp/matrix,
 *     so we cannot rely on default behavior).
 *
 * Safety contract:
 *   - Storage format is markdown UTF-8.
 *   - Rendered output is HTML produced by `marked`, then sanitized by
 *     DOMPurify with the allowlist below + per-attribute hooks.
 *   - Allowed tags: p, h1-h6, ul, ol, li, blockquote, code, pre, strong,
 *     em, a, hr, br. Anything else dropped.
 *   - Allowed attributes: href (scheme-allowlist hook), class
 *     (value-allowlist hook), target+rel via ADD_ATTR (only emitted
 *     by our renderer alongside http(s) hrefs).
 */

const { Marked, Renderer } = require('marked');
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

const ALLOWED_ATTR = ['href', 'class'];

// DOMPurify special-cases `target` and `rel` (tabnabbing concerns) and
// strips them even when present in ALLOWED_ATTR. ADD_ATTR is the
// documented escape hatch — these are safe here because our link
// renderer always emits `rel="noopener noreferrer"` alongside
// `target="_blank"`, and the surface only renders LLM output passing
// through the same scheme-allowlist hook applied to all hrefs.
const ADD_ATTR = ['target', 'rel'];

// Scheme allowlist enforced on every href the sanitizer sees — both
// renderer-emitted links and raw HTML that survives the marked pass.
const ALLOWED_HREF_REGEXP = /^(https?:|mailto:)/i;

const markedOptions = {
  gfm: true,
  breaks: true, // QA responses use single-newline line breaks; mirror the
                // visual behavior of the regex renderer this replaces.
  pedantic: false,
};

// Tailwind utility classes reproduce the inline styling the regex
// renderer applied per-tag. Kept in one place so visual tweaks land
// here, not buried in regex literals. The set is ALSO the allowlist
// the `uponSanitizeAttribute` hook checks below — any class value
// not exactly matching one of these strings is stripped, even on
// otherwise-allowed elements.
const TAILWIND = {
  h1: 'font-bold text-base mt-3 mb-1',
  h2: 'font-semibold text-base mt-3 mb-1',
  h3: 'font-semibold text-sm mt-3 mb-1',
  h4: 'font-semibold text-sm mt-2 mb-1',
  code: 'bg-gray-200 px-1 py-0.5 rounded text-xs',
  ul: 'my-1 ml-4 list-disc',
  ol: 'my-1 ml-4 list-decimal',
  hr: 'my-2 border-gray-300',
};

const ALLOWED_CLASS_VALUES = new Set(Object.values(TAILWIND));

function buildRenderer() {
  const r = new Renderer();

  r.heading = (text, level) => {
    const cls = TAILWIND[`h${level}`] || TAILWIND.h4;
    return `<h${level} class="${cls}">${text}</h${level}>`;
  };

  r.codespan = (text) =>
    `<code class="${TAILWIND.code}">${text}</code>`;

  r.list = (body, ordered) => {
    const tag = ordered ? 'ol' : 'ul';
    const cls = ordered ? TAILWIND.ol : TAILWIND.ul;
    return `<${tag} class="${cls}">${body}</${tag}>`;
  };

  r.hr = () =>
    `<hr class="${TAILWIND.hr}" />`;

  r.link = (href, title, text) => {
    // Defensive: marked has already run, but the sanitizer hook also
    // enforces the scheme allowlist. If href fails the scheme test,
    // drop the link wrapper and render text alone — sanitizer can't
    // always recover a clean visible string from a dropped <a>.
    if (typeof href !== 'string' || !ALLOWED_HREF_REGEXP.test(href)) {
      return text;
    }
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
  };

  return r;
}

function getDOMPurify() {
  // Browser-only. This module's sole consumer (Phase2QAModal) renders strictly
  // client-side, so there is no server code path here. We deliberately do NOT
  // ship a Node/jsdom fallback: jsdom can't load in the Vercel/Turbopack
  // serverless runtime (ESM-only transitive deps — see
  // shared/utils/policy-markdown-server.js), so a server caller must use a
  // DOM-free sanitizer instead of silently waking a broken jsdom branch. Fail
  // loud rather than mislead. Mirrors policy-markdown-client.js.
  if (typeof window === 'undefined' || typeof window.document === 'undefined') {
    throw new Error('renderAppMarkdown requires a browser window (client-only)');
  }
  return installHooks(createDOMPurify(window));
}

/**
 * Install the per-attribute hooks that enforce the href scheme
 * allowlist and the class value allowlist. Both run for every
 * sanitize() call on this purifier instance.
 */
function installHooks(p) {
  p.addHook('uponSanitizeAttribute', (node, data) => {
    if (!data || !data.attrName) return;

    // Scheme allowlist for href on anchors.
    if (data.attrName === 'href') {
      const value = typeof data.attrValue === 'string' ? data.attrValue : '';
      if (!ALLOWED_HREF_REGEXP.test(value)) {
        data.keepAttr = false;
      }
      return;
    }

    // Value allowlist for class. Only renderer-emitted Tailwind
    // strings survive; user-injected classes are stripped even if
    // their value happens to be a real Tailwind utility.
    if (data.attrName === 'class') {
      if (!ALLOWED_CLASS_VALUES.has(data.attrValue)) {
        data.keepAttr = false;
      }
      return;
    }
  });
  return p;
}

let _purifier = null;
function purifier() {
  if (!_purifier) _purifier = getDOMPurify();
  return _purifier;
}

// One-shot Marked instance with our renderer. Reusable across calls.
let _marked = null;
function markedInstance() {
  if (!_marked) {
    _marked = new Marked({ ...markedOptions, renderer: buildRenderer() });
  }
  return _marked;
}

/**
 * Render an app markdown body (QA response, refinement feedback, etc.)
 * to sanitized HTML safe for `dangerouslySetInnerHTML`.
 *
 * Empty / non-string input returns an empty string.
 */
function renderAppMarkdown(body) {
  if (typeof body !== 'string' || body.length === 0) return '';
  const rawHtml = markedInstance().parse(body);
  return purifier().sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR,
    // Note: `ALLOWED_URI_REGEXP` is intentionally NOT set. Setting it
    // triggers DOMPurify's internal anchor-attribute handling, which
    // strips target/rel even when they're in ADD_ATTR (reproduced
    // 2026-05-12). The `uponSanitizeAttribute` hook installed in
    // `installHooks` is the canonical scheme-allowlist for hrefs;
    // it covers both renderer-emitted links and raw HTML links.
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  });
}

/**
 * Public helper for scheme-checking ad-hoc URLs that don't go through
 * the markdown pipeline (e.g., source links rendered directly in JSX
 * from API event payloads). Returns true if the URL uses http, https,
 * or mailto. Use this anywhere an attacker-influenced URL is about to
 * end up in an `href` attribute outside `renderAppMarkdown()`.
 */
function isSafeAppUrl(url) {
  return typeof url === 'string' && ALLOWED_HREF_REGEXP.test(url);
}

module.exports = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ADD_ATTR,
  ALLOWED_HREF_REGEXP,
  TAILWIND,
  renderAppMarkdown,
  isSafeAppUrl,
};
