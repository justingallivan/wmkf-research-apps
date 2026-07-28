/**
 * "No longer needed" withdrawal email (reviewer-engagement Phase 4, spec §3.C).
 *
 * Sent by the PD when enough reviewers have accepted and a still-pending invitee is being
 * politely released. Server-side fixed template (the action is a staff bulk send with no
 * per-recipient editing). No secure link — the engagement is being closed, not advanced.
 */

import { renderPlainTextEmailHtml } from './plain-text-email-html';
import { ContactParser } from '../utils/contact-parser';
import { buildReviewerGreeting } from '../utils/email-generator';

function normalizeSignatureText(signatureBlock) {
  return String(signatureBlock?.signature || signatureBlock?.name || 'W. M. Keck Foundation').trim();
}

function applyPlaceholders(template, replacements) {
  let text = String(template || '');
  const entries = Object.entries(replacements).sort((a, b) => b[0].length - a[0].length);
  for (const [placeholder, value] of entries) {
    text = text.split(placeholder).join(String(value ?? ''));
  }
  return text;
}

function titleClause(title) {
  return title ? `the proposal “${title}”` : 'a proposal we recently invited you to review';
}

export function buildWithdrawSufficientBodyText({ bodyTemplate, reviewerName, title, signatureBlock }) {
  const name = ContactParser.normalizeDisplayName(reviewerName);
  // {{greeting}} is the honorific form ("Dear Dr. Weeks"), matching the reviewer
  // invitation. {{reviewerName}} keeps its full-name meaning so live templates
  // that already use it are unaffected. No trailing punctuation — the template
  // supplies it.
  const greeting = buildReviewerGreeting(reviewerName);
  const normalizedName = name || 'Reviewer';
  const proposal = titleClause(title);
  const signature = normalizeSignatureText(signatureBlock);
  return applyPlaceholders(bodyTemplate, {
    '[proposal title clause]': proposal, // legacy token (pre-rename prod settings); safe to drop after re-baseline
    '[Program Director signature]': signature,
    '{{reviewerName}}': normalizedName,
    '[Reviewer Name]': normalizedName,
    '[reviewerName]': normalizedName,
    '{{greeting}}': greeting,
    '[greeting]': greeting,
    '{{proposalClause}}': proposal,
    '[proposal]': proposal,
    '[title]': proposal,
    '{{signature}}': signature,
    '[signature]': signature,
  });
}

export function renderWithdrawSufficientHtml({ bodyTemplate, reviewerName, title, signatureBlock }) {
  const bodyText = buildWithdrawSufficientBodyText({ bodyTemplate, reviewerName, title, signatureBlock });
  return renderPlainTextEmailHtml(bodyText);
}

export function renderWithdrawSufficient(args) {
  return {
    subject: args.subjectTemplate,
    html: renderWithdrawSufficientHtml(args),
  };
}
