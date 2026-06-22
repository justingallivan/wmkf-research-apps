/**
 * "No longer needed" withdrawal email (reviewer-engagement Phase 4, spec §3.C).
 *
 * Sent by the PD when enough reviewers have accepted and a still-pending invitee is being
 * politely released. Server-side fixed template (the action is a staff bulk send with no
 * per-recipient editing). No secure link — the engagement is being closed, not advanced.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeSignatureText(signatureBlock) {
  return String(signatureBlock?.signature || signatureBlock?.name || 'W. M. Keck Foundation').trim();
}

export function buildWithdrawSufficientBodyText({ reviewerName, title, signatureBlock }) {
  const greeting = reviewerName ? `Dear ${reviewerName}:` : 'Dear Reviewer:';
  const titleClause = title ? `the proposal "${title}"` : 'a proposal we recently invited you to review';
  return [
    greeting,
    `Thank you so much for your willingness to review ${titleClause} for the W. M. Keck Foundation. We have now assembled a full panel for this proposal, so we will not need to call on you this time.`,
    'We are very grateful for your time and hope to have the opportunity to work with you on a future review.',
    'With appreciation,',
    normalizeSignatureText(signatureBlock),
  ].join('\n\n');
}

export function renderWithdrawSufficientHtml({ reviewerName, title, signatureBlock }) {
  const bodyText = buildWithdrawSufficientBodyText({ reviewerName, title, signatureBlock });
  const paragraphs = String(bodyText)
    .split(/\n\s*\n/)
    .map((p) =>
      `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1a1a1a;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return paragraphs;
}

export function renderWithdrawSufficient(args) {
  return {
    subject: 'Thank you — W. M. Keck Foundation review',
    html: renderWithdrawSufficientHtml(args),
  };
}
