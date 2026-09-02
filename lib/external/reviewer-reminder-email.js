/**
 * Reviewer reminder email HTML renders (reviewer-engagement Phase 3).
 *
 * Server-side, fixed-template reminder bodies for the daily reminder cron — the cron
 * has no staff session and so cannot use the per-PD localStorage templates that
 * `render-emails` consumes. Respond reminders inject a freshly minted pre-acceptance
 * link. Review-due reminders are deliberately link-free so routine follow-up cannot
 * replace the token an accepted reviewer may already be using.
 *
 * Two reminders:
 *   - respond-by : nudge an invited reviewer who has not yet accepted/declined.
 *   - review-due : nudge an accepted reviewer who has not yet submitted their review.
 */

import { ContactParser } from '../utils/contact-parser';
import { buildReviewerGreeting } from '../utils/email-generator';
import { composeReviewerEmailSignature } from '../utils/reviewer-email-closing';
import {
  renderAutomatedEmailNoticeHtml,
  stripLegacyAutomationMarker,
} from './automated-email-notice';

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

function normalizeActionSignatureText(signatureBlock) {
  return composeReviewerEmailSignature(signatureBlock);
}

function applyPlaceholders(template, replacements) {
  let text = String(template || '');
  const entries = Object.entries(replacements).sort((a, b) => b[0].length - a[0].length);
  for (const [placeholder, value] of entries) {
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
function renderBodyParagraphsHtml(bodyText) {
  return String(bodyText || '')
    .split(/\n\s*\n/)
    .map((p) =>
      `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1a1a1a;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export const REVIEW_DUE_ACCESS_INSTRUCTION =
  'Please continue using the secure link in your original review materials email. If you no longer have that email, contact the Foundation for a replacement link.';

const REVIEWER_LINK_CONTENT = /{{externalLink}}|\/external\/review\//i;
const LINK_DIRECTION_SENTENCE = /\blinks?\b/i;

function withoutReviewLinkDirections(bodyText) {
  const text = String(bodyText || '');
  if (REVIEWER_LINK_CONTENT.test(text)) {
    throw new Error('Review-due reminder content cannot contain a reviewer URL or {{externalLink}}.');
  }

  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph
      .split(/(?<=[.!?])\s+(?=(?:If|Thank|Please|Your|This|We|You|The|A|An)\b)/)
      .filter((sentence) => !LINK_DIRECTION_SENTENCE.test(sentence))
      .join(' ')
      .trim())
    .filter(Boolean)
    .join('\n\n');
}

function renderLinkFreeReviewDueHtml({ bodyText, automationNotice = null }) {
  const notice = automationNotice ? renderAutomatedEmailNoticeHtml(automationNotice) : '';
  const paragraphs = renderBodyParagraphsHtml(withoutReviewLinkDirections(bodyText));
  return `${notice}${paragraphs}${renderBodyParagraphsHtml(REVIEW_DUE_ACCESS_INSTRUCTION)}`;
}

export function renderReviewerReminderHtml({ bodyText, url, buttonLabel, automationNotice = null }) {
  const paragraphs = renderBodyParagraphsHtml(bodyText);
  const safeUrl = escapeAttr(url);
  const visibleUrl = escapeHtml(url);
  const label = escapeHtml(buttonLabel || 'Open the secure link');
  const notice = automationNotice ? renderAutomatedEmailNoticeHtml(automationNotice) : '';
  return `${notice}${paragraphs}
<p style="margin:18px 0;">
<a href="${safeUrl}" style="display:inline-block;padding:12px 18px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#ffffff;background:#234c8c;text-decoration:none;font-weight:600;border-radius:4px;">${label}</a>
</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#555555;">This secure link is unique to you. If the button does not work, copy and paste it into your browser:<br><a href="${safeUrl}">${visibleUrl}</a></p>`;
}

/** Title clause used in the body — quotes the proposal title, or a neutral fallback. */
function titleClause(title) {
  return title ? `the proposal “${title}”` : 'a proposal we invited you to review';
}

export function buildRespondReminderBodyText({ bodyTemplate, reviewerName, title, signatureBlock }) {
  const name = ContactParser.normalizeDisplayName(reviewerName) || 'Reviewer';
  const greeting = buildReviewerGreeting(reviewerName);
  const proposal = titleClause(title);
  const signature = normalizeActionSignatureText(signatureBlock);
  return stripLegacyAutomationMarker(applyPlaceholders(bodyTemplate, {
    '[proposal title clause]': proposal, // legacy token (pre-rename prod settings); safe to drop after re-baseline
    '[Program Director signature]': signature,
    '{{greeting}}': greeting,
    '[greeting]': greeting,
    '{{reviewerName}}': name,
    '[Reviewer Name]': name,
    '{{proposalClause}}': proposal,
    '[proposal]': proposal,
    '{{signature}}': signature,
  }));
}

export function buildReviewDueReminderBodyText({ bodyTemplate, reviewerName, title, reviewDueDate, signatureBlock }) {
  const name = ContactParser.normalizeDisplayName(reviewerName) || 'Reviewer';
  const greeting = buildReviewerGreeting(reviewerName);
  const proposal = titleClause(title);
  const due = formatReminderDate(reviewDueDate);
  const signature = normalizeActionSignatureText(signatureBlock);
  return stripLegacyAutomationMarker(applyPlaceholders(bodyTemplate, {
    '[proposal title clause]': proposal, // legacy token (pre-rename prod settings); safe to drop after re-baseline
    '[Program Director signature]': signature,
    '{{greeting}}': greeting,
    '[greeting]': greeting,
    '{{reviewerName}}': name,
    '[Reviewer Name]': name,
    '{{proposalClause}}': proposal,
    '[proposal]': proposal,
    '{{reviewDueDate}}': due,
    '[review due date]': due,
    '{{signature}}': signature,
  }));
}

/**
 * Build the thank-you body text (reviewer-engagement thank-you sweep). No secure
 * link — the review is already submitted — so this reuses the shared
 * `applyPlaceholders` mechanism (NOT the reminder body builders, whose token
 * vocabulary differs) against the seeded thank-you template's tokens:
 * {{greeting}} / {{proposalTitle}} / {{signature}} (plus legacy [..] variants).
 */
export function buildThankYouBodyText({ bodyTemplate, reviewerName, title, signatureBlock }) {
  const name = ContactParser.normalizeDisplayName(reviewerName) || 'Reviewer';
  const greeting = buildReviewerGreeting(reviewerName);
  const proposalTitle = title || 'your assigned proposal';
  const signature = normalizeSignatureText(signatureBlock);
  return stripLegacyAutomationMarker(applyPlaceholders(bodyTemplate, {
    '{{greeting}}': greeting,
    '[greeting]': greeting,
    '{{proposalTitle}}': proposalTitle,
    '[proposal title]': proposalTitle,
    '[Program Director signature]': signature,
    '{{signature}}': signature,
  }));
}

/**
 * Render the seeded thank-you email (subject + HTML body). Both subject and body
 * carry {{proposalTitle}}, so placeholders are applied to each. No action button
 * (the review is complete); the courtesy DOCX copy of the review is attached by
 * the caller (`reviewer-thankyou-sweep.js`), not embedded here.
 */
export function renderThankYou({ subjectTemplate, bodyTemplate, reviewerName, title, signatureBlock, senderName, senderEmail }) {
  const proposalTitle = title || 'your assigned proposal';
  const subject = applyPlaceholders(subjectTemplate, {
    '{{proposalTitle}}': proposalTitle,
    '[proposal title]': proposalTitle,
  });
  return {
    subject,
    html: renderAutomatedEmailNoticeHtml({
      senderName: senderName || signatureBlock?.name,
      senderEmail: senderEmail || signatureBlock?.email,
      kind: 'message',
    }) + renderBodyParagraphsHtml(buildThankYouBodyText({ bodyTemplate, reviewerName, title, signatureBlock })),
  };
}

export function renderRespondReminder(args) {
  return {
    subject: args.subjectTemplate,
    html: renderReviewerReminderHtml({
      bodyText: buildRespondReminderBodyText(args),
      url: args.url,
      buttonLabel: 'Accept or decline',
      automationNotice: {
        senderName: args.senderName || args.signatureBlock?.name,
        senderEmail: args.senderEmail || args.signatureBlock?.email,
        kind: 'reminder',
      },
    }),
  };
}

/**
 * Render staff-reviewed respond-reminder copy. The body remains plain text until
 * this server-side step so staff edits are escaped, while the live secure link is
 * injected here and can never be supplied or altered by the browser.
 *
 * The automation notice is server-side chrome like the button/link block: it is
 * NOT part of the editable preview text, and is deliberately absent from the
 * staff preview, matching how the manual review-due reminder (no preview at
 * all) carries it. Passing it here closes the #7-vs-#5 divergence from the
 * 2026-08-26 outbound-email inventory.
 */
export function renderRespondReminderFromBodyText({ subject, bodyText, url, automationNotice = null }) {
  return {
    subject,
    html: renderReviewerReminderHtml({
      bodyText,
      url,
      buttonLabel: 'Accept or decline',
      automationNotice,
    }),
  };
}

export function renderReviewDueReminder(args) {
  return {
    subject: args.subjectTemplate,
    html: renderLinkFreeReviewDueHtml({
      bodyText: buildReviewDueReminderBodyText(args),
      automationNotice: {
        senderName: args.senderName || args.signatureBlock?.name,
        senderEmail: args.senderEmail || args.signatureBlock?.email,
        kind: 'reminder',
      },
    }),
  };
}
