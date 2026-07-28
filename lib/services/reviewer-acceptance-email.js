import { ContactParser } from '../utils/contact-parser.js';
import { buildReviewerGreeting } from '../utils/email-generator.js';
import { DynamicsService } from './dynamics-service.js';
import { buildReviewDueIcs } from '../external/calendar-invite.js';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { renderPlainTextEmailHtml } from '../external/plain-text-email-html.js';
import { resolveSignatureForRequest } from './email-signature.js';
import * as systemUserAdapter from '../dataverse/adapters/system-user.js';

export const ACCEPTANCE_SUBJECT_KEY = 'email.reviewer_acceptance.subject';
export const ACCEPTANCE_BODY_KEY = 'email.reviewer_acceptance.body';

function formatReviewDueDate(reviewDueDate) {
  if (!reviewDueDate || typeof reviewDueDate !== 'string') return null;
  const match = reviewDueDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, mo, d] = match;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() + 1 !== Number(mo) || dt.getUTCDate() !== Number(d)) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(dt);
}

function applyTemplatePlaceholders(template, replacements) {
  let text = String(template || '');
  const entries = Object.entries(replacements).sort((a, b) => b[0].length - a[0].length);
  for (const [placeholder, value] of entries) {
    text = text.split(placeholder).join(String(value ?? ''));
  }
  return text;
}

export function renderAcceptanceConfirmationEmail({
  subjectTemplate,
  bodyTemplate,
  reviewer,
  request,
  signatureBlock,
  programDirector,
  withdrawUrl,
}) {
  const reviewerName = ContactParser.normalizeDisplayName(reviewer?.wmkf_name) || 'Reviewer';
  const greeting = buildReviewerGreeting(reviewer?.wmkf_name);
  const title = request?.akoya_title || 'the proposal';
  const due = formatReviewDueDate(request?.wmkf_reviewduedate);
  const dueSentence = due
    ? `Your review is due on ${due}.`
    : 'We will follow up with the review due date.';
  const signature = String(signatureBlock?.signature || signatureBlock?.name || 'W. M. Keck Foundation').trim();
  const replacements = {
    '[Program Director signature]': signature,
    '{{greeting}}': greeting,
    '[greeting]': greeting,
    '{{reviewerName}}': reviewerName,
    '[reviewerName]': reviewerName,
    '{{proposalTitle}}': title,
    '[title]': title,
    '{{reviewDueDate}}': dueSentence,
    '[reviewDueDate]': dueSentence,
    '{{signature}}': signature,
    '{{programDirectorName}}': programDirector?.name || 'your Program Director',
    '{{programDirectorEmail}}': programDirector?.email || '',
    '{{withdrawUrl}}': withdrawUrl || '',
    '{{requestNumber}}': '',
    '[requestNumber]': '',
  };
  const subject = applyTemplatePlaceholders(subjectTemplate, replacements);
  let bodyText = applyTemplatePlaceholders(bodyTemplate, replacements);
  const templateHasWithdrawUrl = String(bodyTemplate || '').includes('{{withdrawUrl}}');
  if (withdrawUrl && !templateHasWithdrawUrl) {
    bodyText +=
      '\n\nIf something changes before proposal materials are released, you can withdraw from this review '
      + 'and suggest alternate reviewers using your secure link:\n'
      + withdrawUrl;
  }

  return { subject, body: renderPlainTextEmailHtml(bodyText) };
}

async function resolveAcceptanceConfirmationSender(request) {
  const pdId = request?._wmkf_programdirector_value || null;
  if (pdId) {
    try {
      const pd = await systemUserAdapter.getByIdWithSelect(
        pdId,
        'systemuserid,fullname,internalemailaddress,isdisabled',
      );
      if (pd?.isdisabled === false && pd.internalemailaddress) {
        return {
          from: pd.internalemailaddress,
          actingUserSystemId: pd.systemuserid || undefined,
          programDirector: {
            name: pd.fullname || 'your Program Director',
            email: pd.internalemailaddress,
          },
        };
      }
    } catch (e) {
      console.warn('[reviewer acceptance email] PD sender lookup failed (using fallback):', e?.message || e);
    }
  }
  return {
    from: process.env.NOTIFICATION_EMAIL_FROM || null,
    actingUserSystemId: undefined,
    programDirector: null,
  };
}

export async function sendAcceptanceConfirmationEmail({
  suggestion,
  request,
  reviewer,
  withdrawUrl = null,
}) {
  // The engagement address is the one the reviewer just confirmed or corrected
  // through the magic-link accept form. Prefer it over the older person-record
  // address; the latter remains a fallback when the engagement has no email.
  const to = suggestion?.wmkf_revieweremail || reviewer?.wmkf_emailaddress || null;
  const {
    from,
    actingUserSystemId,
    programDirector,
  } = await resolveAcceptanceConfirmationSender(request);
  if (!to) {
    throw new Error('acceptance confirmation recipient email missing');
  }
  if (!from) {
    throw new Error('acceptance confirmation sender email missing');
  }

  const ics = buildReviewDueIcs({
    reviewDueDate: request?.wmkf_reviewduedate,
    suggestionId: suggestion?.wmkf_appreviewersuggestionid,
  });
  const emailDefaults = await readRequiredEmailDefaults([ACCEPTANCE_SUBJECT_KEY, ACCEPTANCE_BODY_KEY], {
    source: 'external/review/respond:acceptance-confirmation',
  });
  if (!emailDefaults.ok) {
    return { skipped: true, reason: 'defaults_unavailable' };
  }
  const signatureBlock = await resolveSignatureForRequest(request?.akoya_requestid);
  const { subject, body } = renderAcceptanceConfirmationEmail({
    subjectTemplate: emailDefaults.values[ACCEPTANCE_SUBJECT_KEY],
    bodyTemplate: emailDefaults.values[ACCEPTANCE_BODY_KEY],
    reviewer,
    request,
    signatureBlock,
    programDirector,
    withdrawUrl,
  });

  await DynamicsService.createAndSendEmail({
    subject,
    body,
    from,
    to,
    regardingId: request?.akoya_requestid || undefined,
    regardingType: request?.akoya_requestid ? 'akoya_request' : undefined,
    attachments: ics ? [ics] : [],
    actingUserSystemId,
  });
  return { sent: true };
}
