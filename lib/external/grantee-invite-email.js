/**
 * Grantee invite email HTML render.
 *
 * Parallel grantee variant of the reviewer `plainTextToHtml` button/fallback
 * render (pages/api/review-manager/send-emails.js) — deliberately NOT reusing it,
 * since that helper is specific to the `/external/review/` URL and its button
 * text is the reviewer stage-aware label (`email.reviewer_<type>.button_label`,
 * e.g. "Respond to Invitation"). This renders the staff-edited body as paragraphs and appends a
 * server-injected action button + copy-paste fallback link for the grantee
 * magic-link (the link is minted server-side, never taken from the staff body).
 */

// Local surname extraction (kept in-file so this module stays import-free and usable
// from raw-Node scripts) — mirrors surnameFromName in shared/config/granteeInviteEmail.
function surnameFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

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

function applyPlaceholders(template, replacements) {
  let text = String(template || '');
  for (const [placeholder, value] of Object.entries(replacements)) {
    text = text.split(placeholder).join(String(value ?? ''));
  }
  return text;
}

export function buildGranteeReminderBodyText({ bodyTemplate, piName, title, signatureBlock, invitedDate }) {
  const deadline = formatReminderDeadline(invitedDate);
  return applyPlaceholders(bodyTemplate, {
    // Surname only, consistent with the grantee invite (fillInviteBody) — "Dear
    // Professor Vasquez:", not "Dear Professor Dr. Elena Vasquez:".
    '[Name]': surnameFromName(piName) || piName,
    '[title]': title,
    'COB [date]': deadline,
    '[Program Director signature]': normalizeSignatureText(signatureBlock),
  });
}

export function renderGranteeReminderHtml(args) {
  return renderGranteeInviteHtml({
    bodyText: buildGranteeReminderBodyText(args),
    url: args.url,
  });
}
