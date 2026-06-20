/**
 * Grantee invite email HTML render.
 *
 * Parallel grantee variant of the reviewer `plainTextToHtml` button/fallback
 * render (pages/api/review-manager/send-emails.js) — deliberately NOT reusing it,
 * since that helper is hardcoded to the `/external/review/` URL + "Start Review"
 * button text. This renders the staff-edited body as paragraphs and appends a
 * server-injected action button + copy-paste fallback link for the grantee
 * magic-link (the link is minted server-side, never taken from the staff body).
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
 * @param {string} args.bodyText - staff-authored/edited plain-text body
 * @param {string} args.url - the grantee portal magic-link (minted server-side)
 * @returns {string} email HTML
 */
export function renderGranteeInviteHtml({ bodyText, url }) {
  const paragraphs = String(bodyText || '')
    .split(/\n\s*\n/)
    .map((p) =>
      `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1a1a1a;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  const safeUrl = escapeAttr(url);
  const visibleUrl = escapeHtml(url);

  return `${paragraphs}
<p style="margin:18px 0;">
<a href="${safeUrl}" style="display:inline-block;padding:12px 18px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#ffffff;background:#1a4a7a;text-decoration:none;font-weight:600;border-radius:4px;">Open the Grantee Portal</a>
</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#555555;">If the button does not work, copy and paste this secure link into your browser:<br><a href="${safeUrl}">${visibleUrl}</a></p>`;
}

export function formatReminderDeadline(invitedDate) {
  const d = new Date(invitedDate);
  d.setUTCDate(d.getUTCDate() + 14);
  return `COB ${d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

function normalizeSignatureText(signatureBlock) {
  return String(signatureBlock?.signature || signatureBlock?.name || 'W. M. Keck Foundation').trim();
}

export function buildGranteeReminderBodyText({ piName, title, signatureBlock, invitedDate }) {
  const deadline = formatReminderDeadline(invitedDate);
  return [
    `Dear Professor ${piName}:`,
    `I'm following up on the abstract for your recent W. M. Keck Foundation award entitled "${title}". We'd welcome any changes to the draft, and an image to accompany it, before we post your award on the Foundation's website. Please use your secure link below by ${deadline}. If we have not heard from you by then, we will post the draft abstract as written. If you have already submitted, thank you - no further action is needed. Please do not hesitate to contact me if you need additional information.`,
    'Thank you,',
    normalizeSignatureText(signatureBlock),
  ].join('\n\n');
}

export function renderGranteeReminderHtml(args) {
  return renderGranteeInviteHtml({
    bodyText: buildGranteeReminderBodyText(args),
    url: args.url,
  });
}
