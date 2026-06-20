/**
 * Grantee document HTML — the presentation layer for the chunk-8 assembly model
 * (build-plan chunk 8 outputs b + c; spec D9). Turns the structured model from
 * lib/services/grantee-document-assembly.js into HTML. ALL structural formatting
 * lives here, keyed on field identity (D8): institution → bold, location / PI+co-PIs
 * / edited title → italic, amount → plain. Body + caption are already sanitized
 * HTML (em/strong/sub/sup) from shared/utils/grantee-markdown.js and are inlined
 * as-is; every plain-text field is HTML-escaped here.
 *
 * `renderAwardBlock` is the single per-award fragment shared by the website-HTML
 * output (b), the cycle export (c), and (later) the portal preview (a) — so the
 * award renders identically everywhere.
 *
 * Image note: the model carries `hasImage` (+ `imageFileRef` on staff surfaces),
 * but the ref is a PRIVATE SharePoint reference, not a public URL. Public image
 * serving is a separate follow-up, so an image is emitted as a <figure>
 * placeholder carrying the caption + the ref in a comment — staff insert the
 * actual <img> via the site CMS. We never fabricate a public <img src>.
 */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a plain-text field for safe HTML emission. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/**
 * Render one award as a semantic HTML fragment. Empty fields are omitted (no
 * stray empty tags). `includeImage` adds the image <figure> placeholder when the
 * model has an image (staff/website surface).
 *
 * @param {object} model - from assembleGranteeDocument()
 * @param {{ includeImage?: boolean }} [opts]
 * @returns {string} HTML fragment (no outer page chrome)
 */
function renderAwardBlock(model, { includeImage = false } = {}) {
  if (!model) return '';
  const parts = [];
  parts.push('<article class="grantee-award">');
  if (model.institution) parts.push(`  <p class="institution"><strong>${esc(model.institution)}</strong></p>`);
  if (model.location) parts.push(`  <p class="location"><em>${esc(model.location)}</em></p>`);
  if (model.names) parts.push(`  <p class="investigators"><em>${esc(model.names)}</em></p>`);
  if (model.amountFormatted) parts.push(`  <p class="amount">${esc(model.amountFormatted)}</p>`);
  if (model.editedTitle) parts.push(`  <p class="edited-title"><em>${esc(model.editedTitle)}</em></p>`);
  if (model.bodyHtml) parts.push(`  <div class="abstract-body">${model.bodyHtml}</div>`);
  if (includeImage && model.hasImage) {
    const refComment = model.imageFileRef ? `<!-- image: ${esc(model.imageFileRef)} (insert image via site CMS) -->` : '<!-- image present (ref not exposed) -->';
    const figcaption = model.captionHtml ? `\n    <figcaption>${model.captionHtml}</figcaption>` : '';
    parts.push(`  <figure class="grantee-image">\n    ${refComment}${figcaption}\n  </figure>`);
  }
  parts.push('</article>');
  return parts.join('\n');
}

/**
 * Wrap one or more award blocks in a standalone, printable HTML page for the
 * cycle export (output c). Minimal inline CSS so staff can open/print/post it
 * without an external stylesheet.
 *
 * @param {object[]} models
 * @param {{ cycleLabel?: string, includeImage?: boolean, capped?: boolean, totalCount?: number, returnedCount?: number }} [opts]
 * @returns {string} a complete HTML document
 */
function renderCyclePage(models, {
  cycleLabel = '',
  includeImage = false,
  capped = false,
  totalCount = 0,
  returnedCount,
} = {}) {
  const list = Array.isArray(models) ? models.filter(Boolean) : [];
  const heading = cycleLabel ? `${esc(cycleLabel)} — awarded research` : 'Awarded research';
  const blocks = list.map((m) => renderAwardBlock(m, { includeImage })).join('\n\n');
  const cappedReturnedCount = returnedCount === undefined ? list.length : returnedCount;
  const cappedNotice = capped
    ? `  <p class="export-notice">Export truncated: Dataverse returned ${esc(cappedReturnedCount)} of ${esc(totalCount || cappedReturnedCount)} award records. Re-run or narrow the cycle before posting.</p>`
    : '';
  const css = [
    'body{font-family:Georgia,\'Times New Roman\',serif;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#111;line-height:1.5}',
    'h1{font-size:1.5rem;border-bottom:1px solid #ccc;padding-bottom:.5rem}',
    '.export-notice{border:1px solid #9a3412;background:#fff7ed;color:#7c2d12;padding:.65rem .8rem;font-family:Arial,sans-serif;font-size:.9rem}',
    '.grantee-award{margin:0 0 2.5rem;page-break-inside:avoid}',
    '.grantee-award p{margin:.1rem 0}',
    '.institution strong{font-size:1.05rem}',
    '.amount{margin-bottom:.4rem}',
    '.abstract-body p{margin:.6rem 0;text-align:justify}',
    '.grantee-image figcaption{font-size:.85rem;color:#555}',
  ].join('\n');
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${heading}</title>`,
    `  <style>\n${css}\n  </style>`,
    '</head>',
    '<body>',
    `  <h1>${heading}</h1>`,
    `  <p class="count">${list.length} award${list.length === 1 ? '' : 's'}</p>`,
    cappedNotice,
    blocks,
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = {
  esc,
  renderAwardBlock,
  renderCyclePage,
};
