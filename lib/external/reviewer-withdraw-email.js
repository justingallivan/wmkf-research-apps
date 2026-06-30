/**
 * "No longer needed" withdrawal email (reviewer-engagement Phase 4, spec §3.C).
 *
 * Sent by the PD when enough reviewers have accepted and a still-pending invitee is being
 * politely released. Server-side fixed template (the action is a staff bulk send with no
 * per-recipient editing). No secure link — the engagement is being closed, not advanced.
 */

import { renderPlainTextEmailHtml } from './plain-text-email-html';
import { ContactParser } from '../utils/contact-parser';

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

function titleClause(title) {
  return title ? `the proposal “${title}”` : 'a proposal we recently invited you to review';
}

export function buildWithdrawSufficientBodyText({ bodyTemplate, reviewerName, title, signatureBlock }) {
  const name = ContactParser.normalizeDisplayName(reviewerName);
  const greeting = name ? `Dear ${name}:` : 'Dear Reviewer:';
  return applyPlaceholders(bodyTemplate, {
    '[Reviewer Name]': name || 'Reviewer',
    '[reviewerName]': name || 'Reviewer',
    '[greeting]': greeting,
    '[proposal]': titleClause(title),
    '[proposal title clause]': titleClause(title), // legacy token (pre-rename prod settings); safe to drop after re-baseline
    '[title]': titleClause(title),
    '[Program Director signature]': normalizeSignatureText(signatureBlock),
    '[signature]': normalizeSignatureText(signatureBlock),
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
