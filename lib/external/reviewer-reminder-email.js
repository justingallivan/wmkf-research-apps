/**
 * Reviewer reminder email HTML renders (reviewer-engagement Phase 3).
 *
 * Server-side, fixed-template reminder bodies for the daily reminder cron — the cron
 * has no staff session and so cannot use the per-PD localStorage templates that
 * `render-emails` consumes. Parallel to `grantee-invite-email.js`: the secure link is
 * minted server-side and injected as an action button + copy-paste fallback; it is never
 * taken from a staff-authored body.
 *
 * Two reminders:
 *   - respond-by : nudge an invited reviewer who has not yet accepted/declined.
 *   - review-due : nudge an accepted reviewer who has not yet submitted their review.
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

/** Format a YYYY-MM-DD (or ISO) date as "January 15, 2026" in UTC. */
export function formatReminderDate(value) {
  if (!value) return '';
  const d = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Render a reviewer reminder: body paragraphs + a server-injected secure-link button
 * (label varies by reminder) + a copy-paste fallback.
 * @param {{ bodyText: string, url: string, buttonLabel: string }} args
 * @returns {string} email HTML
 */
export function renderReviewerReminderHtml({ bodyText, url, buttonLabel }) {
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
<a href="${safeUrl}" style="display:inline-block;padding:12px 18px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#ffffff;background:#234c8c;text-decoration:none;font-weight:600;border-radius:4px;">${label}</a>
</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#555555;">This secure link is unique to you. If the button does not work, copy and paste it into your browser:<br><a href="${safeUrl}">${visibleUrl}</a></p>`;
}

/** Title clause used in the body — quotes the proposal title, or a neutral fallback. */
function titleClause(title) {
  return title ? `the proposal "${title}"` : 'a proposal we invited you to review';
}

export function buildRespondReminderBodyText({ bodyTemplate, reviewerName, title, signatureBlock }) {
  return applyPlaceholders(bodyTemplate, {
    '[Reviewer Name]': reviewerName || 'Reviewer',
    '[proposal title clause]': titleClause(title),
    '[Program Director signature]': normalizeSignatureText(signatureBlock),
  });
}

export function buildReviewDueReminderBodyText({ bodyTemplate, reviewerName, title, reviewDueDate, signatureBlock }) {
  return applyPlaceholders(bodyTemplate, {
    '[Reviewer Name]': reviewerName || 'Reviewer',
    '[proposal title clause]': titleClause(title),
    '[review due date]': formatReminderDate(reviewDueDate),
    '[Program Director signature]': normalizeSignatureText(signatureBlock),
  });
}

export function renderRespondReminder(args) {
  return {
    subject: args.subjectTemplate,
    html: renderReviewerReminderHtml({
      bodyText: buildRespondReminderBodyText(args),
      url: args.url,
      buttonLabel: 'Accept or decline',
    }),
  };
}

export function renderReviewDueReminder(args) {
  return {
    subject: args.subjectTemplate,
    html: renderReviewerReminderHtml({
      bodyText: buildReviewDueReminderBodyText(args),
      url: args.url,
      buttonLabel: 'Open your review',
    }),
  };
}
