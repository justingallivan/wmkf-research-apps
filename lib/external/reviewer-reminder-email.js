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

export function buildRespondReminderBodyText({ reviewerName, title, signatureBlock }) {
  const greeting = reviewerName ? `Dear ${reviewerName}:` : 'Dear Reviewer:';
  return [
    greeting,
    `I'm following up on my recent invitation to review ${titleClause(title)} for the W. M. Keck Foundation. We have not yet heard back from you and would be grateful to know whether you are able to serve.`,
    'Please use your secure link below to accept or decline. If you accept, you can confirm a few details now and the full proposal will follow once it is released. If your circumstances have changed, a quick decline is just as helpful.',
    'Thank you,',
    normalizeSignatureText(signatureBlock),
  ].join('\n\n');
}

export function buildReviewDueReminderBodyText({ reviewerName, title, reviewDueDate, signatureBlock }) {
  const greeting = reviewerName ? `Dear ${reviewerName}:` : 'Dear Reviewer:';
  const due = formatReminderDate(reviewDueDate);
  const dueClause = due ? ` Your review is due by ${due}.` : '';
  return [
    greeting,
    `This is a friendly reminder about your review of ${titleClause(title)} for the W. M. Keck Foundation.${dueClause}`,
    'Your secure link below opens the proposal materials and the review form. If you have already submitted, thank you — no further action is needed.',
    'Thank you,',
    normalizeSignatureText(signatureBlock),
  ].join('\n\n');
}

export function renderRespondReminder(args) {
  return {
    subject: 'Reminder: your W. M. Keck Foundation review invitation',
    html: renderReviewerReminderHtml({
      bodyText: buildRespondReminderBodyText(args),
      url: args.url,
      buttonLabel: 'Accept or decline',
    }),
  };
}

export function renderReviewDueReminder(args) {
  return {
    subject: 'Reminder: your W. M. Keck Foundation review',
    html: renderReviewerReminderHtml({
      bodyText: buildReviewDueReminderBodyText(args),
      url: args.url,
      buttonLabel: 'Open your review',
    }),
  };
}
