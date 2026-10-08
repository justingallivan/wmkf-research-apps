/**
 * Leadership daily digest (Final Writeup group-review handoff Stage 5).
 *
 * Once a day each leadership-persona staff member gets one email, from the
 * system mailbox, listing the writeups that entered leadership review ("Send
 * to leadership") that they have not been told about yet. Contract:
 *  - Research only (owner 2026-10-07): writeups come only from Grant Programs
 *    in FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS, the same fail-closed list as
 *    the Stage 4 handoff email. Unset or invalid means no digest. TEST
 *    requests are excluded in the request query, because the email has no
 *    single regarding request for the transport guard to check.
 *  - A writeup is listed when its request's current Final has a complete
 *    leadership checkpoint (leadership-checkpoint.js) started within the last
 *    LOOKBACK_DAYS, and no accepted digest to that recipient listed it.
 *  - Recipients: the Leadership persona in the published staffing setting,
 *    already pruned to the current reviewer roster. Internal staff only: an
 *    address outside exactly the foundation domain is never emailed.
 *  - One row per (recipient, digest day) in `final_writeup_leadership_digests`,
 *    claimed with a lease before any Dynamics work. Membership is frozen at
 *    insert, so retries render the same email, and only an accepted digest's
 *    membership counts as told: a writeup that a failed digest listed goes out
 *    the next day instead. The stored activity id, the lease fence and the
 *    Dynamics correlation key prevent a second email for the same day.
 *  - No email when nothing is new. Copy comes from
 *    email.final_writeup_leadership_digest.subject / .body; blank copy sends
 *    nothing and raises an ops alert, as does any recipient that fails.
 *  - Each recipient is handled independently: one failure never blocks the
 *    others.
 */

import * as emailActivityAdapter from '../../dataverse/adapters/email-activity.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import * as odata from '../../dataverse/core/odata.js';
import { chunk } from '../../utils/chunk.js';
import { isGuid } from '../../utils/guid.js';
import { isFinalWriteupSchemaReady } from '../../utils/final-writeup-readiness.js';
import { getSettingStrict } from '../settings-service.js';
import NotificationService from '../notification-service.js';
import { withOrdinaryTestRequestODataFilter } from '../test-requests/isolation.js';
import { FOUNDATION_EMAIL_DOMAIN } from '../test-requests/email-allowlist.js';
import { isLeadershipCheckpointComplete } from './leadership-checkpoint.js';
import { getFinalWriteupPersonaRuntimeState } from './matrix-audience-service.js';
import { readHandoffEmailProgramIds } from './handoff-email-config.js';
import * as store from './leadership-digest-store.js';
import { FINAL_WRITEUP_PERSONA } from '../../../shared/config/finalWriteupPersonas.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument.js';
import { requestInstitution } from '../../../shared/utils/institution.js';

export const FINAL_WRITEUP_LEADERSHIP_DIGEST_SUBJECT_KEY = 'email.final_writeup_leadership_digest.subject';
export const FINAL_WRITEUP_LEADERSHIP_DIGEST_BODY_KEY = 'email.final_writeup_leadership_digest.body';
// How far back a digest looks for writeups; also covers missed nights.
export const LOOKBACK_DAYS = 7;
// Accepted digests this far back count as "already told"; longer than LOOKBACK_DAYS.
const TOLD_WINDOW_DAYS = LOOKBACK_DAYS + 3;
const SEND_ACCEPTED_STATUS_CODES = new Set([3, 6, 7]);
const DAY_MS = 24 * 60 * 60 * 1000;

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_programdirector_value',
  '_wmkf_grantprogram_value',
  '_wmkf_currentfinalwriteup_value',
].join(',');

function publicBaseUrl(env = process.env) {
  const configured = String(env.NEXTAUTH_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const production = String(env.VERCEL_PROJECT_PRODUCTION_URL || '').trim().replace(/\/$/, '');
  return production ? `https://${production}` : '';
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isFinalWriteupSchemaReady,
  programIds: () => readHandoffEmailProgramIds(),
  queryAllRequests: (options) => grantRequestAdapter.queryAllRequests(options),
  findDocumentsByIds: (ids) => requestDocumentAdapter.findByIds(ids),
  personaState: () => getFinalWriteupPersonaRuntimeState(),
  getSystemUser: (systemUserId) => systemUserAdapter.getByIdWithSelect(
    systemUserId,
    ['systemuserid', 'internalemailaddress', 'isdisabled'],
  ),
  getSettingStrict,
  createEmailActivity: emailActivityAdapter.create,
  getEmailActivity: emailActivityAdapter.getById,
  findEmailByCorrelation: emailActivityAdapter.findByCorrelation,
  sendEmail: emailActivityAdapter.send,
  getRow: store.getLeadershipDigest,
  listTold: store.listToldFinalDocumentIds,
  claim: store.claimLeadershipDigest,
  renew: store.renewLeadershipDigestLease,
  recordActivity: store.recordLeadershipDigestActivity,
  markAccepted: store.markLeadershipDigestAccepted,
  recordFailure: store.recordLeadershipDigestFailure,
  sender: () => String(process.env.NOTIFICATION_EMAIL_FROM || '').trim(),
  baseUrl: () => publicBaseUrl(),
  notify: (options) => NotificationService.notify(options),
  now: () => new Date(),
});

function digestError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizedGuid(value) {
  return isGuid(value) ? String(value).toLowerCase() : null;
}

function accepted(email) {
  return SEND_ACCEPTED_STATUS_CODES.has(Number(email?.statuscode));
}

/**
 * The digest day is the UTC calendar day before the run. The cron fires at
 * 07:00 UTC (midnight PDT, 11pm PST), so the key is the Pacific day that is
 * ending, and two consecutive daily runs always get consecutive keys, across
 * both daylight-saving changes.
 */
export function leadershipDigestDay(now) {
  return new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
}

function shiftDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function leadershipDigestCorrelationKey(recipientSystemUserId, digestDay) {
  return `wmkf-final-writeup-leadership-digest:${String(recipientSystemUserId).toLowerCase()}:${digestDay}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveTokens(template, tokens) {
  return Object.entries(tokens).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value || ''),
    String(template || ''),
  ).replace(/[ \t]{2,}/g, ' ').trim();
}

/** Render from the frozen membership only, so every retry sends the same email. */
export function renderLeadershipDigest({ subjectTemplate, bodyTemplate, membership, baseUrl }) {
  const count = String(membership.length);
  const tokens = { count, writeupWord: membership.length === 1 ? 'writeup' : 'writeups' };
  const subject = resolveTokens(subjectTemplate, tokens).replace(/\s+/g, ' ');
  const intro = resolveTokens(bodyTemplate, tokens).split(/\n{2,}/).map((part) => (
    `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`
  ));
  const items = membership.map((item) => {
    const url = `${baseUrl}/workbench/${encodeURIComponent(item.requestId)}?tab=final-writeup`;
    const details = [item.institution, item.leadProgramDirector && `Lead PD: ${item.leadProgramDirector}`]
      .filter(Boolean).map(escapeHtml).join(' · ');
    return `<li style="margin-bottom:10px;"><a href="${escapeHtml(url)}">${escapeHtml(item.requestNumber)}</a> ${escapeHtml(item.title)}${details ? `<br><span style="color:#555;">${details}</span>` : ''}</li>`;
  });
  return { subject, html: [...intro, `<ul>\n${items.join('\n')}\n</ul>`].join('\n') };
}

async function readCopy(key, dependencies) {
  try {
    const result = await dependencies.getSettingStrict(key);
    const value = result?.found ? String(result.value ?? '') : '';
    return value.trim() ? value : null;
  } catch {
    return null;
  }
}

function programFilter(programIds) {
  const programs = odata.or(programIds.map((id) => odata.eqGuid('_wmkf_grantprogram_value', id)));
  return withOrdinaryTestRequestODataFilter(`_wmkf_currentfinalwriteup_value ne null and (${programs})`);
}

/**
 * Writeups in leadership review for the listed programs, started within the
 * lookback window, oldest first. Each item is the display snapshot frozen into
 * a digest row. A capped or failed read throws: a partial list must not be
 * frozen into a digest.
 */
async function eligibleWriteups(programIds, now, dependencies) {
  const result = await dependencies.queryAllRequests({
    select: REQUEST_SELECT,
    filter: programFilter(programIds),
    orderby: 'akoya_requestnum asc',
  });
  if (result?.capped) throw digestError('leadership_digest_request_scan_capped');
  const requests = (result?.records || []).filter((request) => (
    programIds.includes(normalizedGuid(request._wmkf_grantprogram_value))
    && normalizedGuid(request._wmkf_currentfinalwriteup_value)
  ));
  const finalIds = requests.map((request) => normalizedGuid(request._wmkf_currentfinalwriteup_value));
  const documents = new Map();
  for (const ids of chunk(finalIds, requestDocumentAdapter.REQUEST_DOCUMENT_BATCH_MAX_IDS)) {
    const batch = await dependencies.findDocumentsByIds(ids);
    if (batch?.capped) throw digestError('leadership_digest_document_read_capped');
    for (const document of batch?.records || []) {
      documents.set(normalizedGuid(document.wmkf_requestdocumentid), document);
    }
  }
  const since = now.getTime() - LOOKBACK_DAYS * DAY_MS;
  const items = [];
  for (const request of requests) {
    const finalId = normalizedGuid(request._wmkf_currentfinalwriteup_value);
    const final = documents.get(finalId);
    if (!final || final.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) continue;
    if (!isLeadershipCheckpointComplete(final)) continue;
    const startedMs = Date.parse(final.wmkf_leadershipreviewstartedat);
    if (startedMs < since || startedMs > now.getTime()) continue;
    items.push({
      finalDocumentId: finalId,
      requestId: normalizedGuid(request.akoya_requestid),
      requestNumber: String(request.akoya_requestnum || '').trim(),
      title: String(request.akoya_title || '').trim(),
      institution: requestInstitution(request) || '',
      leadProgramDirector: String(request._wmkf_programdirector_value_formatted || '').trim(),
      leadershipReviewStartedAt: final.wmkf_leadershipreviewstartedat,
    });
  }
  return items.sort((left, right) => (
    Date.parse(left.leadershipReviewStartedAt) - Date.parse(right.leadershipReviewStartedAt)
  ));
}

function isFoundationAddress(address) {
  const at = address.lastIndexOf('@');
  return at > 0 && address.slice(at + 1).toLowerCase() === FOUNDATION_EMAIL_DOMAIN;
}

/** Returns the address, or null for a definitive "cannot email"; any other lookup failure throws. */
async function recipientAddress(systemUserId, dependencies) {
  let user;
  try {
    user = await dependencies.getSystemUser(systemUserId);
  } catch (error) {
    if (error?.status === 404) return null;
    throw digestError('leadership_digest_recipient_lookup_failed');
  }
  const address = String(user?.internalemailaddress || '').trim();
  if (!user || user.isdisabled !== false || !/^[^\s@]+@[^\s@]+$/.test(address)) return null;
  return isFoundationAddress(address) ? address : null;
}

async function recoverByCorrelation(key, dependencies) {
  const matches = await dependencies.findEmailByCorrelation(key);
  if (matches.length > 1) throw digestError('leadership_digest_duplicate_correlation');
  return matches[0] || null;
}

/**
 * Send one claimed row. Every Dynamics side effect is preceded by a lease
 * renewal (fence); the activity id is persisted before transport, and the
 * correlation key finds an activity created before its id was recorded.
 */
async function deliverClaimed(row, { recipientId, day }, copy, dependencies) {
  const token = row.lease_token;
  const key = leadershipDigestCorrelationKey(recipientId, day);
  const fence = async () => {
    if (!await dependencies.renew(recipientId, day, token)) throw digestError('leadership_digest_lease_lost');
  };

  let email = row.dynamics_email_id
    ? await dependencies.getEmailActivity(row.dynamics_email_id)
    : await recoverByCorrelation(key, dependencies);
  if (!email) {
    await fence();
    const { subject, html } = renderLeadershipDigest({
      subjectTemplate: copy.subject,
      bodyTemplate: copy.body,
      membership: row.membership,
      baseUrl: copy.baseUrl,
    });
    const emailId = await dependencies.createEmailActivity({
      subject,
      body: html,
      from: copy.sender,
      to: row.recipient_address,
      correlationKey: key,
    });
    if (!await dependencies.recordActivity(recipientId, day, token, emailId)) {
      throw digestError('leadership_digest_lease_lost');
    }
    email = await dependencies.getEmailActivity(emailId);
  } else if (!row.dynamics_email_id) {
    if (!await dependencies.recordActivity(recipientId, day, token, email.activityid)) {
      throw digestError('leadership_digest_lease_lost');
    }
  }
  if (!accepted(email)) {
    await fence();
    try {
      await dependencies.sendEmail(email.activityid);
    } catch (error) {
      const readback = await dependencies.getEmailActivity(email.activityid).catch(() => null);
      if (!accepted(readback)) throw digestError('leadership_digest_send_failed');
    }
  }
  if (!await dependencies.markAccepted(recipientId, day, token)) throw digestError('leadership_digest_lease_lost');
}

async function alert(dependencies, { reason, recipientSystemUserId = null, digestDay }) {
  try {
    await dependencies.notify({
      type: 'final_writeup_leadership_digest_undelivered',
      severity: 'error',
      category: 'ops',
      source: 'final-writeup-leadership-digest',
      title: 'Leadership digest not delivered',
      message: `The daily email telling leadership which writeups were sent to them did not go out (${reason}). Let them know directly, then fix the cause; the writeups are listed again in the next digest.`,
      metadata: { reason, recipientSystemUserId, digestDay },
      autoResolveKey: `final-writeup-leadership-digest:${digestDay}:${recipientSystemUserId || 'all'}`,
    });
  } catch (error) {
    console.error('Final Writeup leadership digest alert failed:', error?.message);
  }
}

async function runForRecipient(recipientSystemUserId, context, dependencies) {
  const { day, items, copy } = context;
  const existing = await dependencies.getRow(recipientSystemUserId, day);
  if (existing?.accepted_at) return { status: 'already_sent' };

  // A retry passes the row's own frozen membership: Postgres checks the
  // proposed insert row before ON CONFLICT reclaims the existing one.
  let membership = existing?.membership || null;
  let address = existing?.recipient_address || null;
  if (!existing) {
    const told = new Set(await dependencies.listTold(recipientSystemUserId, shiftDay(day, -TOLD_WINDOW_DAYS)));
    membership = items.filter((item) => !told.has(item.finalDocumentId));
    if (!membership.length) return { status: 'nothing_new' };
    address = await recipientAddress(recipientSystemUserId, dependencies);
    if (!address) return { status: 'recipient_unavailable' };
  }
  if (!copy) return { status: 'copy_missing' };

  const { claimed, row } = await dependencies.claim({
    recipientSystemUserId,
    digestDay: day,
    recipientAddress: address,
    membership,
  });
  if (!claimed) return { status: row?.accepted_at ? 'already_sent' : 'busy' };
  try {
    await deliverClaimed(row, { recipientId: recipientSystemUserId, day }, copy, dependencies);
    return { status: 'sent', count: row.membership.length };
  } catch (error) {
    const code = error?.code || 'leadership_digest_failed';
    await dependencies.recordFailure(recipientSystemUserId, day, row.lease_token, code).catch(() => 0);
    return { status: 'failed', code };
  }
}

/**
 * Run one day's digests. Returns { status, digestDay, results } where results
 * holds one outcome per leadership recipient. Throws only for a deployment or
 * read fault that affects everyone (missing sender or base URL, a failed
 * writeup scan), so the cron reports failure.
 */
export async function runLeadershipDigests(dependencies = DEFAULT_DEPENDENCIES) {
  const day = leadershipDigestDay(dependencies.now());
  try {
    return await runForDay(day, dependencies);
  } catch (error) {
    // A run-wide fault stops every recipient's digest, so tell ops as well.
    await alert(dependencies, { reason: error?.code || 'leadership_digest_run_failed', digestDay: day });
    throw error;
  }
}

async function runForDay(day, dependencies) {
  const now = dependencies.now();
  const programIds = dependencies.programIds();
  if (!programIds.length) return { status: 'disabled', digestDay: day, results: [] };
  if (!dependencies.schemaReady()) return { status: 'schema_not_ready', digestDay: day, results: [] };

  const items = await eligibleWriteups(programIds, now, dependencies);
  if (!items.length) return { status: 'nothing_new', digestDay: day, results: [] };
  const persona = await dependencies.personaState();
  const recipients = [...new Set((persona?.assignments || [])
    .filter((assignment) => assignment.roles?.includes(FINAL_WRITEUP_PERSONA.LEADERSHIP))
    .map((assignment) => normalizedGuid(assignment.reviewerId))
    .filter(Boolean))];
  if (!recipients.length) {
    await alert(dependencies, { reason: 'no_leadership_recipients', digestDay: day });
    return { status: 'no_recipients', digestDay: day, results: [] };
  }

  const sender = dependencies.sender();
  const baseUrl = dependencies.baseUrl();
  if (!sender || !baseUrl) throw digestError('leadership_digest_not_configured');
  const subject = await readCopy(FINAL_WRITEUP_LEADERSHIP_DIGEST_SUBJECT_KEY, dependencies);
  const body = await readCopy(FINAL_WRITEUP_LEADERSHIP_DIGEST_BODY_KEY, dependencies);
  const copy = subject && body ? { subject, body, sender, baseUrl } : null;

  const results = [];
  for (const recipientSystemUserId of recipients) {
    let outcome;
    try {
      outcome = await runForRecipient(recipientSystemUserId, { day, items, copy }, dependencies);
    } catch (error) {
      outcome = { status: 'failed', code: error?.code || 'leadership_digest_failed' };
    }
    if (['failed', 'recipient_unavailable', 'copy_missing'].includes(outcome.status)) {
      await alert(dependencies, { reason: outcome.code || outcome.status, recipientSystemUserId, digestDay: day });
    }
    results.push({ recipientSystemUserId, ...outcome });
  }
  return { status: 'ran', digestDay: day, results };
}

export const FINAL_WRITEUP_LEADERSHIP_DIGEST_DEPENDENCIES = DEFAULT_DEPENDENCIES;
