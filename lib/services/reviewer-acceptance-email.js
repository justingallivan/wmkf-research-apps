/** Acceptance confirmation preparation is read-only; the drain owns the durable pre-send claim. */
import { ContactParser } from '../utils/contact-parser.js';
import { buildReviewerGreeting } from '../utils/email-generator.js';
import { DynamicsService } from './dynamics-service.js';
import { buildReviewDueIcs } from '../external/calendar-invite.js';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { renderPlainTextEmailHtml } from '../external/plain-text-email-html.js';
import { resolveSignatureForRequest } from './email-signature.js';
import * as systemUserAdapter from '../dataverse/adapters/system-user.js';
import { composeReviewerEmailSignature } from '../utils/reviewer-email-closing.js';
import { applyPlaceholders as applyTemplatePlaceholders } from '../utils/email-placeholders.js';
import { resolveEffectiveReviewDueDate } from '../external/reviewer-due-date.js';
import { isGuid } from '../utils/guid.js';
import { ownReviewerAcceptanceTemplate } from './reviewer-acceptance-personalization.js';
import { testRequestIsolationEnabled } from './test-requests/isolation.js';

export const ACCEPTANCE_SUBJECT_KEY = 'email.reviewer_acceptance.subject';
export const ACCEPTANCE_BODY_KEY = 'email.reviewer_acceptance.body';
// D49: the one email a reviewer gets on acceptance when materials go out with it.
export const MATERIALS_ACCEPTANCE_SUBJECT_KEY = 'email.reviewer_materials_acceptance.subject';
export const MATERIALS_ACCEPTANCE_BODY_KEY = 'email.reviewer_materials_acceptance.body';

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

function renderAcceptanceText({
  subjectTemplate,
  bodyTemplate,
  reviewer,
  suggestion,
  request,
  signatureBlock,
  programDirector,
  withdrawUrl,
  reviewUrl,
}) {
  const reviewerName = ContactParser.normalizeDisplayName(reviewer?.wmkf_name) || 'Reviewer';
  const greeting = buildReviewerGreeting(reviewer?.wmkf_name);
  const title = request?.akoya_title || 'the proposal';
  const reviewDueDate = resolveEffectiveReviewDueDate({
    overrideDate: suggestion?.wmkf_reviewduedateoverride,
    defaultDate: request?.wmkf_reviewduedate,
  });
  const due = formatReviewDueDate(reviewDueDate);
  const dueSentence = due
    ? `Your review is due on ${due}.`
    : 'We will follow up with the review due date.';
  const signature = composeReviewerEmailSignature(signatureBlock);
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
    '{{reviewUrl}}': reviewUrl || '',
    '{{requestNumber}}': '',
    '[requestNumber]': '',
  };
  const subjectValues = Object.fromEntries(Object.entries(replacements)
    .map(([key, value]) => [key, String(value ?? '').replace(/[\r\n]+/g, ' ')]));
  const subject = applyTemplatePlaceholders(subjectTemplate, subjectValues);
  let bodyText = applyTemplatePlaceholders(bodyTemplate, replacements);
  const businessText = bodyText;
  const templateHasWithdrawUrl = String(bodyTemplate || '').includes('{{withdrawUrl}}');
  if (withdrawUrl && !templateHasWithdrawUrl) {
    bodyText +=
      '\n\nIf something changes before proposal materials are released, you can withdraw from this review '
      + 'and suggest alternate reviewers using your secure link:\n'
      + withdrawUrl;
  }
  // The materials email is never sent without the reviewer's link.
  if (reviewUrl && !String(bodyTemplate || '').includes('{{reviewUrl}}')) {
    bodyText += `\n\nThe proposal and the review form are at your secure link:\n${reviewUrl}`;
  }

  return { subject, businessText, bodyText, body: renderPlainTextEmailHtml(bodyText) };
}

export function renderAcceptanceConfirmationEmail(input) {
  const { subject, body } = renderAcceptanceText(input);
  return { subject, body };
}

async function resolveAcceptanceConfirmationSender(request) {
  const pdId = request?._wmkf_programdirector_value || null;
  if (pdId) {
    if (!isGuid(pdId)) return { ok: false, reason: 'sender_identity_invalid' };
    let pd;
    try {
      pd = await systemUserAdapter.getByIdWithSelect(pdId, 'systemuserid,fullname,internalemailaddress,isdisabled');
    } catch { return { ok: false, reason: 'sender_unavailable' }; }
    if (!pd) return { ok: false, reason: 'sender_unavailable' };
    if (!isGuid(pd.systemuserid) || pd.systemuserid.toLowerCase() !== pdId.toLowerCase()
        || typeof pd.isdisabled !== 'boolean') return { ok: false, reason: 'sender_identity_invalid' };
    if (!pd.isdisabled && pd.internalemailaddress) {
      return { ok: true, from: pd.internalemailaddress, actingUserSystemId: pdId.toLowerCase(),
        programDirector: { name: pd.fullname || 'your Program Director', email: pd.internalemailaddress } };
    }
  }
  return { ok: true, from: process.env.NOTIFICATION_EMAIL_FROM || null,
    actingUserSystemId: undefined, programDirector: null };
}

export async function prepareAcceptanceConfirmationEmail({ suggestion, request, reviewer, withdrawUrl = null }) {
  const to = suggestion?.wmkf_revieweremail || reviewer?.wmkf_emailaddress || null;
  if (!to) throw new Error('acceptance confirmation recipient email missing');
  if (!request?.akoya_requestid && testRequestIsolationEnabled()) throw new Error('acceptance confirmation request missing');
  const sender = await resolveAcceptanceConfirmationSender(request);
  if (!sender.ok) return sender;
  const { from, actingUserSystemId, programDirector } = sender;
  if (!from) throw new Error('acceptance confirmation sender email missing');
  try {
    const shared = await readRequiredEmailDefaults([ACCEPTANCE_SUBJECT_KEY, ACCEPTANCE_BODY_KEY], {
      source: 'external/review/respond:acceptance-confirmation',
    });
    if (!shared.ok) return { ok: false, reason: 'defaults_unavailable' };
    let template = { subject: shared.values[ACCEPTANCE_SUBJECT_KEY], body: shared.values[ACCEPTANCE_BODY_KEY] };
    if (actingUserSystemId) {
      const own = await ownReviewerAcceptanceTemplate(actingUserSystemId);
      if (own.status === 'configured') template = own.template;
      else if (own.status !== 'absent') return { ok: false, reason: `preference_${own.status || 'unavailable'}` };
    }
    const signatureBlock = await resolveSignatureForRequest(request?.akoya_requestid);
    const rendered = renderAcceptanceText({ subjectTemplate: template.subject, bodyTemplate: template.body,
      reviewer, suggestion, request, signatureBlock, programDirector, withdrawUrl });
    if (!rendered.subject.trim() || /[\r\n]/.test(rendered.subject) || rendered.subject.length > 2000
        || !rendered.businessText.trim() || rendered.businessText.length > 100000 || rendered.bodyText.length > 100000) {
      return { ok: false, reason: 'rendered_copy_invalid' };
    }
    const ics = buildReviewDueIcs({ reviewDueDate: resolveEffectiveReviewDueDate({
      overrideDate: suggestion?.wmkf_reviewduedateoverride, defaultDate: request?.wmkf_reviewduedate,
    }), suggestionId: suggestion?.wmkf_appreviewersuggestionid });
    return { ok: true, message: Object.freeze({ subject: rendered.subject, body: rendered.body, from, to,
      regardingId: request?.akoya_requestid || undefined,
      regardingType: request?.akoya_requestid ? 'akoya_request' : undefined,
      attachments: Object.freeze(ics ? [ics] : []), actingUserSystemId, noFallback: true }) };
  } catch { return { ok: false, reason: 'preparation_unavailable' }; }
}

/**
 * D49: the acceptance email that carries the materials. Read-only, like the
 * confirmation's preparation: it renders the send-time placeholder link, which
 * `finalizeMaterialsAcceptanceMessage` replaces with the minted link after the
 * release claim. The caller passes the placeholder (token-lifecycle's send-time
 * placeholder) so this module stays free of the token-minting imports. New template keys, so no per-PD acceptance override applies.
 * `reason` values: `materials_defaults_blank` (keys not seeded: the caller
 * holds materials and sends today's confirmation) or a transient reason (the
 * caller retries).
 */
export async function prepareMaterialsAcceptanceEmail({ suggestion, request, reviewer, attachments = [], placeholderUrl, placeholderToken }) {
  if (!placeholderToken || !String(placeholderUrl || '').includes(placeholderToken)) return { ok: false, reason: 'link_placeholder_missing' };
  const to = suggestion?.wmkf_revieweremail || reviewer?.wmkf_emailaddress || null;
  if (!to) return { ok: false, reason: 'recipient_missing' };
  if (!request?.akoya_requestid) return { ok: false, reason: 'request_missing' };
  const sender = await resolveAcceptanceConfirmationSender(request);
  if (!sender.ok) return sender;
  const { from, actingUserSystemId, programDirector } = sender;
  if (!from) return { ok: false, reason: 'sender_unavailable' };
  try {
    const shared = await readRequiredEmailDefaults([MATERIALS_ACCEPTANCE_SUBJECT_KEY, MATERIALS_ACCEPTANCE_BODY_KEY], {
      source: 'reviewer-acceptance-drain:materials',
    });
    if (!shared.ok) {
      return { ok: false, reason: shared.failures.every(f => f.reason === 'blank') ? 'materials_defaults_blank' : 'defaults_unavailable' };
    }
    const signatureBlock = await resolveSignatureForRequest(request.akoya_requestid);
    const rendered = renderAcceptanceText({ subjectTemplate: shared.values[MATERIALS_ACCEPTANCE_SUBJECT_KEY],
      bodyTemplate: shared.values[MATERIALS_ACCEPTANCE_BODY_KEY], reviewer, suggestion, request, signatureBlock,
      programDirector, reviewUrl: placeholderUrl });
    if (!rendered.subject.trim() || /[\r\n]/.test(rendered.subject) || rendered.subject.length > 2000
        || !rendered.businessText.trim() || rendered.bodyText.length > 100000
        || !rendered.body.includes(placeholderToken) || rendered.subject.includes(placeholderToken)) {
      return { ok: false, reason: 'rendered_copy_invalid' };
    }
    const ics = buildReviewDueIcs({ reviewDueDate: resolveEffectiveReviewDueDate({
      overrideDate: suggestion?.wmkf_reviewduedateoverride, defaultDate: request?.wmkf_reviewduedate,
    }), suggestionId: suggestion?.wmkf_appreviewersuggestionid });
    return { ok: true, placeholderToken, message: Object.freeze({ subject: rendered.subject, body: rendered.body, from, to,
      regardingId: request.akoya_requestid, regardingType: 'akoya_request',
      attachments: Object.freeze([...(ics ? [ics] : []), ...attachments]), actingUserSystemId, noFallback: true }) };
  } catch { return { ok: false, reason: 'preparation_unavailable' }; }
}

/** The prepared message with the minted link in place of every send-time placeholder. */
export function finalizeMaterialsAcceptanceMessage(prepared, jwt) {
  const placeholder = prepared?.placeholderToken;
  if (!placeholder || typeof jwt !== 'string' || !jwt || jwt === placeholder) throw new Error('minted link missing');
  const body = prepared.message.body.split(placeholder).join(jwt);
  return { ...prepared, message: Object.freeze({ ...prepared.message, body }) };
}

/** No reads, rendering or claim writes after preparation. */
export async function sendPreparedAcceptanceConfirmationEmail(prepared) {
  const receipt = await DynamicsService.createAndSendEmail(prepared.message);
  return { sent: true, emailId: receipt?.emailId };
}

/** Compatibility wrapper; production drain uses the split preparation/transport seams. */
export async function sendAcceptanceConfirmationEmail(input) {
  const prepared = await prepareAcceptanceConfirmationEmail(input);
  if (!prepared.ok) return { skipped: true, reason: prepared.reason };
  await sendPreparedAcceptanceConfirmationEmail(prepared);
  return { sent: true };
}
