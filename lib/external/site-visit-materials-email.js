/**
 * Site visit materials email HTML render (Build D, 2026-09-10 UX pass).
 *
 * The invitation and reminder bodies built by
 * `lib/services/site-visit-materials/collection-service.js` were rendered
 * through the plain `renderPlainTextEmailHtml` helper with the raw contributor
 * URL as a paragraph. This mirrors the grantee/reviewer pattern instead: the
 * staff/system body renders as paragraphs, followed by a server-injected
 * action button plus a copy-paste fallback link for the contributor URL (the
 * URL is minted server-side, never taken from the body text).
 *
 * `escapeHtml`/`escapeAttr` are not exported from `grantee-invite-email.js` or
 * `reviewer-reminder-email.js`, so they are mirrored here rather than shared.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/**
 * @param {Object} args
 * @param {string} args.bodyText - server-composed plain-text body
 * @param {string} args.url - the contributor upload link (minted server-side)
 * @param {string} args.buttonLabel - action button text
 * @returns {string} email HTML
 */
export function renderMaterialsEmailHtml({ bodyText, url, buttonLabel }) {
  const paragraphs = String(bodyText || '')
    .split(/\n\s*\n/)
    .map((p) =>
      `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1a1a1a;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  const safeUrl = escapeAttr(url);
  const visibleUrl = escapeHtml(url);
  const label = escapeHtml(buttonLabel || 'Open the secure link');

  return `${paragraphs}
<p style="margin:18px 0;">
<a href="${safeUrl}" style="display:inline-block;padding:12px 18px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#ffffff;background:#1a4a7a;text-decoration:none;font-weight:600;border-radius:4px;">${label}</a>
</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#555555;">If the button does not work, copy and paste this secure link into your browser:<br><a href="${safeUrl}">${visibleUrl}</a></p>`;
}
