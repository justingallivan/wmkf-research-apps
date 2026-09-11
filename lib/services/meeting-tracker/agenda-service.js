/** Deliberation-session agenda preview, drift detection, and Dynamics send recovery. */
import * as emailActivityAdapter from '../../dataverse/adapters/email-activity.js';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import { normalizeDistributionRecipients } from '../pre-site-visit/distribution-service.js';
import { getSettingStrict } from '../settings-service.js';
import { getDeliberationSession } from './session-service.js';
import * as store from './agenda-store.js';

const SEND_ACCEPTED_STATUS_CODES = new Set([3, 6, 7]);
const SEND_TERMINAL_STATUS_CODES = new Set([2, 4, 5, 8]);
const AGENDA_SUBJECT_DEFAULT_KEY = 'email.deliberation_agenda.subject';
const AGENDA_BODY_DEFAULT_KEY = 'email.deliberation_agenda.body';

const DEFAULT_DEPENDENCIES = Object.freeze({
  getSession: getDeliberationSession,
  createOrGetAgenda: store.createOrGetAgendaSend,
  getAgenda: store.getAgendaSend,
  getLatestSentAgenda: store.getLatestSentAgendaSend,
  getLatestUnresolvedAgenda: store.getLatestUnresolvedAgendaSend,
  claimSend: store.claimAgendaSend,
  recordEmailActivity: store.recordAgendaEmailActivity,
  recordSendRequested: store.recordAgendaSendRequested,
  recordDraftReconciled: store.recordAgendaDraftReconciled,
  recordTerminalFailure: store.recordAgendaTerminalFailure,
  renewSendLease: store.renewAgendaSendLease,
  recordSent: store.recordAgendaSent,
  recordFailure: store.recordAgendaFailure,
  createEmailActivity: emailActivityAdapter.create,
  getEmailActivity: emailActivityAdapter.getById,
  findEmailByCorrelation: emailActivityAdapter.findByCorrelation,
  sendEmail: emailActivityAdapter.send,
  impersonationEnabled: () => process.env.DYNAMICS_IMPERSONATION_ENABLED === 'true',
  getSettingStrict,
});

function agendaError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extras },
  });
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function unresolvedAgendaError(row) {
  return agendaError(
    'A session agenda send is still unresolved. Review and retry that send before creating or sending another agenda.',
    'agenda_send_unresolved',
    409,
    { pendingSend: projectAgenda(row) },
  );
}

function terminalAgendaError(row) {
  return agendaError(
    'Dynamics closed this agenda email without an accepted transport status. Create a new preview before sending again.',
    'agenda_send_terminal',
    409,
    { failedSend: projectAgenda(row) },
  );
}

function parseStoredObject(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseStoredArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeHttpsUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' && parsed.hostname ? text : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function requireSessionTime(session) {
  const start = new Date(session?.scheduledStartIso || '');
  const end = new Date(session?.scheduledEndIso || '');
  const timeZone = String(session?.ianaTimeZone || '');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || !validTimeZone(timeZone)) {
    throw agendaError(
      'Save a valid session date, time, and time zone before creating the agenda.',
      'agenda_session_time_invalid',
      409,
    );
  }
  return { start, end, timeZone };
}

function sessionWhenText(session, start, end, timeZone) {
  const startText = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(start);
  const endText = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(end);
  return `Deliberation session: ${startText}–${endText}.`;
}

/**
 * Resolves the `{{sessionDate}}` token in an admin-editable agenda default
 * (subject or opening message) against one session's scheduled start and
 * time zone. Only a valid start and time zone are required (unlike
 * `requireSessionTime`, which also demands a valid end) so a session with a
 * bad/missing end time still gets a resolved date rather than leaking the
 * raw token. Returns the template unchanged when the token is absent, or
 * when the start/zone cannot be resolved (falls back to the raw template
 * rather than throwing).
 */
export function resolveAgendaDefault(template, session) {
  const text = String(template || '');
  if (!text.includes('{{sessionDate}}')) return text;
  const start = new Date(session?.scheduledStartIso || '');
  const timeZone = String(session?.ianaTimeZone || '');
  if (!Number.isFinite(start.getTime()) || !validTimeZone(timeZone)) return text;
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(start);
  return text.replaceAll('{{sessionDate}}', date);
}

/** Strict raw read of one admin-editable agenda default setting (no token resolution). */
async function readAgendaSetting(key, dependencies) {
  try {
    const result = await dependencies.getSettingStrict(key);
    const value = result?.found ? String(result.value ?? '') : '';
    return { value: value.trim() === '' ? '' : value, unavailable: false };
  } catch (error) {
    console.error(`meeting tracker agenda default read failed for ${key}:`, error.message);
    return { value: '', unavailable: true };
  }
}

function orderedSlots(slots) {
  return [...(slots || [])].sort((left, right) => (
    Number(left.wmkf_order || 0) - Number(right.wmkf_order || 0)
      || String(left.wmkf_deliberationslotid || '').localeCompare(String(right.wmkf_deliberationslotid || ''))
  ));
}

function instantKey(value) {
  const millis = new Date(value || '').getTime();
  return Number.isFinite(millis) ? `ms:${millis}` : `invalid:${String(value || '')}`;
}

/** Pure agenda calculation. `now` is accepted for deterministic callers; the snapshot has no clock-derived fields. */
export function computeAgenda(session, slots, _now = new Date()) {
  const { start, end, timeZone } = requireSessionTime(session);
  if (!Array.isArray(slots) || slots.length === 0) {
    throw agendaError(
      'Add at least one proposal before creating the agenda.',
      'agenda_slots_required',
      409,
    );
  }
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone,
  });
  let elapsedMinutes = 0;
  const agendaSlots = orderedSlots(slots).map((slot) => {
    const requestId = String(slot?._wmkf_request_value || '').trim().toLowerCase();
    const minutes = Number(slot?.wmkf_minutes);
    if (!isGuid(requestId) || !Number.isSafeInteger(minutes) || minutes < 1) {
      throw agendaError(
        'Every agenda proposal must have a valid request and positive whole-number minutes.',
        'agenda_slot_invalid',
        409,
      );
    }
    const computedStart = new Date(start.getTime() + elapsedMinutes * 60_000);
    const computedEnd = new Date(computedStart.getTime() + minutes * 60_000);
    elapsedMinutes += minutes;
    const briefingUrl = safeHttpsUrl(slot?.briefing?.url);
    const requestNumber = String(slot?.wmkf_Request?.akoya_requestnum || 'Number unavailable').trim();
    const title = String(slot?.wmkf_Request?.akoya_title || 'Title unavailable').trim();
    const leadPdName = String(slot?.wmkf_LeadPd?.fullname || 'Not assigned').trim();
    const windowText = `${timeFormatter.format(computedStart)}–${timeFormatter.format(computedEnd)}`;
    return {
      requestId,
      requestNumber,
      title,
      leadPdName,
      minutes,
      computedStartIso: computedStart.toISOString(),
      computedEndIso: computedEnd.toISOString(),
      windowText,
      briefingUrl,
    };
  });
  return {
    sessionId: session.sessionId,
    scheduledStartIso: start.toISOString(),
    scheduledEndIso: end.toISOString(),
    ianaTimeZone: timeZone,
    meetingLink: safeHttpsUrl(session.meetingLink),
    location: String(session.location || '').trim(),
    sessionLine: sessionWhenText(session, start, end, timeZone),
    slots: agendaSlots,
  };
}

function agendaSlotText(slot) {
  const briefing = slot.briefingUrl ? `Open briefing: ${slot.briefingUrl}` : 'briefing link to follow by email';
  return `${slot.windowText} · #${slot.requestNumber} · ${slot.title} · Lead PD: ${slot.leadPdName} · ${briefing}`;
}

export function renderAgendaEmail(message, snapshot) {
  const messageText = String(message || '').trim();
  const detailLines = [
    snapshot.sessionLine,
    ...(snapshot.meetingLink ? [`Join meeting: ${snapshot.meetingLink}`] : []),
    ...(snapshot.location ? [`Location: ${snapshot.location}`] : []),
  ];
  const slotLines = snapshot.slots.map(agendaSlotText);
  const bodyText = [messageText, ...detailLines, 'Agenda', slotLines.join('\n')].filter(Boolean).join('\n\n');
  const bodyHtml = [
    `<p>${escapeHtml(messageText).replaceAll('\n', '<br>')}</p>`,
    `<p>${escapeHtml(snapshot.sessionLine)}`,
    snapshot.meetingLink
      ? `<br><a href="${escapeHtml(snapshot.meetingLink)}">Join meeting</a>`
      : '',
    snapshot.location ? `<br>Location: ${escapeHtml(snapshot.location)}` : '',
    '</p><h3>Agenda</h3><ol>',
    ...snapshot.slots.map((slot) => {
      const briefing = slot.briefingUrl
        ? `<a href="${escapeHtml(slot.briefingUrl)}">Open briefing</a>`
        : 'briefing link to follow by email';
      return `<li><strong>${escapeHtml(slot.windowText)}</strong> · #${escapeHtml(slot.requestNumber)}`
        + ` · ${escapeHtml(slot.title)} · Lead PD: ${escapeHtml(slot.leadPdName)} · ${briefing}</li>`;
    }),
    '</ol>',
  ].join('');
  return { bodyText, bodyHtml };
}

function scheduleSignature(session, slots) {
  return {
    scheduledStart: instantKey(session?.scheduledStartIso),
    slots: orderedSlots(slots).map((slot) => ({
      requestId: String(slot?._wmkf_request_value || '').toLowerCase(),
      minutes: Number(slot?.wmkf_minutes),
    })),
  };
}

export function agendaScheduleChanged(session, slots, snapshot) {
  if (!snapshot) return false;
  const current = scheduleSignature(session, slots);
  const stored = {
    scheduledStart: instantKey(snapshot.scheduledStartIso),
    slots: Array.isArray(snapshot.slots) ? snapshot.slots.map((slot) => ({
      requestId: String(slot?.requestId || '').toLowerCase(),
      minutes: Number(slot?.minutes),
    })) : [],
  };
  return JSON.stringify(current) !== JSON.stringify(stored);
}

function agendaSnapshotComparisonTuple(snapshot) {
  return [
    String(snapshot?.sessionId || '').toLowerCase(),
    String(snapshot?.scheduledStartIso || ''),
    String(snapshot?.scheduledEndIso || ''),
    String(snapshot?.ianaTimeZone || ''),
    snapshot?.meetingLink || null,
    String(snapshot?.location || ''),
    String(snapshot?.sessionLine || ''),
    ...(Array.isArray(snapshot?.slots) ? snapshot.slots.map((slot) => [
      String(slot?.requestId || '').toLowerCase(),
      String(slot?.requestNumber || ''),
      String(slot?.title || ''),
      String(slot?.leadPdName || ''),
      Number(slot?.minutes),
      String(slot?.computedStartIso || ''),
      String(slot?.computedEndIso || ''),
      String(slot?.windowText || ''),
      slot?.briefingUrl || null,
    ]) : []),
  ];
}

function projectAgenda(row) {
  if (!row) return null;
  const to = parseStoredArray(row.to_recipients);
  const cc = parseStoredArray(row.cc_recipients);
  return {
    operationId: row.operation_id,
    sessionId: row.session_id,
    agenda: parseStoredObject(row.agenda_snapshot),
    to,
    cc,
    recipientCount: to.length + cc.length,
    subject: row.subject,
    bodyText: row.body_text,
    state: row.state,
    dynamicsEmailId: row.dynamics_email_id || null,
    sendRequestedAt: row.send_requested_at || null,
    sentAt: row.sent_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transportAccepted: row.state === 'sent',
    lastErrorCode: row.last_error_code || null,
    lastError: row.last_error_message || null,
  };
}

function requireActorAndSender(input) {
  if (!isGuid(input.actingUserSystemId || '')) {
    throw agendaError(
      'Your staff account is not linked to a Dynamics sender identity.',
      'agenda_staff_identity_required',
      403,
    );
  }
  const fromEmail = String(input.fromEmail || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) {
    throw agendaError('Your account has no valid sending address.', 'agenda_sender_invalid', 400);
  }
  return fromEmail;
}

function composeInput(input) {
  const recipients = normalizeDistributionRecipients(input.to, input.cc);
  const subject = String(input.subject || '').trim();
  const message = String(input.bodyText || '').trim();
  if (!subject || subject.length > 500) {
    throw agendaError('A subject of at most 500 characters is required.', 'agenda_subject_invalid', 400);
  }
  if (!message || message.length > 20_000) {
    throw agendaError('A message of at most 20,000 characters is required.', 'agenda_body_invalid', 400);
  }
  return { recipients, subject, message };
}

function exactPreparedRow(row, input) {
  return sameId(row.session_id, input.sessionId)
    && JSON.stringify(agendaSnapshotComparisonTuple(parseStoredObject(row.agenda_snapshot)))
      === JSON.stringify(agendaSnapshotComparisonTuple(input.agendaSnapshot))
    && row.subject === input.subject
    && row.body_text === input.bodyText
    && row.body_html === input.bodyHtml
    && row.from_email === input.fromEmail
    && sameId(row.acting_user_system_id, input.actingUserSystemId)
    && JSON.stringify(parseStoredArray(row.to_recipients)) === JSON.stringify(input.toRecipients)
    && JSON.stringify(parseStoredArray(row.cc_recipients)) === JSON.stringify(input.ccRecipients);
}

export async function prepareAgendaEmail(input, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(input?.sessionId || '') || !isGuid(input?.operationId || '')) {
    throw agendaError('Valid sessionId and operationId values are required.', 'agenda_identity_invalid', 400);
  }
  const fromEmail = requireActorAndSender(input);
  const compose = composeInput(input);
  const current = await dependencies.getSession({ sessionId: input.sessionId });
  const unresolved = await dependencies.getLatestUnresolvedAgenda(input.sessionId);
  if (unresolved && !sameId(unresolved.operation_id, input.operationId)) {
    throw unresolvedAgendaError(unresolved);
  }
  const snapshot = computeAgenda(current.session, current.slots);
  const rendered = renderAgendaEmail(compose.message, snapshot);
  const rowInput = {
    operationId: input.operationId,
    sessionId: input.sessionId,
    agendaSnapshot: snapshot,
    toRecipients: compose.recipients.to,
    ccRecipients: compose.recipients.cc,
    subject: compose.subject,
    bodyText: rendered.bodyText,
    bodyHtml: rendered.bodyHtml,
    fromEmail,
    actingUserSystemId: input.actingUserSystemId,
  };
  const row = await dependencies.createOrGetAgenda(rowInput);
  if (!row || !exactPreparedRow(row, rowInput)) {
    throw agendaError(
      'This operation ID is already bound to a different agenda. Create a new preview.',
      'agenda_operation_conflict',
      409,
    );
  }
  return { agenda: projectAgenda(row), reused: row.inserted === false };
}

export async function getAgendaStatus({ sessionId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(sessionId || '')) {
    throw agendaError('A valid sessionId is required.', 'agenda_identity_invalid', 400);
  }
  const [current, sentRow, pendingRow, subjectSetting, bodySetting] = await Promise.all([
    dependencies.getSession({ sessionId }),
    dependencies.getLatestSentAgenda(sessionId),
    dependencies.getLatestUnresolvedAgenda(sessionId),
    readAgendaSetting(AGENDA_SUBJECT_DEFAULT_KEY, dependencies),
    readAgendaSetting(AGENDA_BODY_DEFAULT_KEY, dependencies),
  ]);
  const snapshot = parseStoredObject(sentRow?.agenda_snapshot);
  return {
    lastAgenda: projectAgenda(sentRow),
    pendingSend: projectAgenda(pendingRow),
    scheduleChanged: sentRow ? agendaScheduleChanged(current.session, current.slots, snapshot) : false,
    defaults: {
      subject: subjectSetting.value ? resolveAgendaDefault(subjectSetting.value, current.session) : '',
      message: bodySetting.value ? resolveAgendaDefault(bodySetting.value, current.session) : '',
      unavailable: subjectSetting.unavailable || bodySetting.unavailable,
    },
  };
}

function correlationKey(attempt) {
  return `wmkf-deliberation-agenda:${attempt.operation_id}`;
}

async function recoverEmailActivity(attempt, dependencies) {
  if (attempt.dynamics_email_id) {
    return dependencies.getEmailActivity(attempt.dynamics_email_id);
  }
  const matches = await dependencies.findEmailByCorrelation(correlationKey(attempt));
  if (matches.length > 1) {
    throw agendaError(
      'Multiple Dynamics email activities share this agenda identity.',
      'agenda_email_ambiguous',
      500,
    );
  }
  return matches[0] || null;
}

async function persistEmailIdentity(attempt, emailId, dependencies) {
  if (!isGuid(emailId || '')) {
    throw agendaError('Dynamics returned an invalid email activity identity.', 'agenda_email_identity_invalid', 502);
  }
  if (attempt.dynamics_email_id) {
    if (!sameId(attempt.dynamics_email_id, emailId)) {
      throw agendaError('The agenda ledger and Dynamics resolved to different activities.', 'agenda_email_identity_mismatch', 500);
    }
    return attempt;
  }
  let writeError = null;
  try {
    const persisted = await dependencies.recordEmailActivity(attempt, emailId);
    if (persisted) return persisted;
  } catch (error) {
    writeError = error;
  }
  const recovered = await recoverEmailActivity(attempt, dependencies);
  if (!recovered) {
    if (writeError) throw writeError;
    throw agendaError('The Dynamics activity ID could not be persisted.', 'agenda_email_persist_failed', 502);
  }
  if (!sameId(recovered.activityid, emailId)) {
    throw agendaError('The agenda correlation resolved to a different Dynamics activity.', 'agenda_email_identity_mismatch', 500);
  }
  const retried = await dependencies.recordEmailActivity(attempt, recovered.activityid);
  if (!retried) throw agendaError('The recovered Dynamics activity ID could not be persisted.', 'agenda_email_persist_failed', 502);
  return retried;
}

function assertEmailActivityMatches(attempt, email) {
  const parties = Array.isArray(email?.email_activity_parties) ? email.email_activity_parties : [];
  const addresses = (mask) => parties
    .filter((party) => Number(party.participationtypemask) === mask)
    .map((party) => String(party.addressused || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const expectedTo = parseStoredArray(attempt.to_recipients).slice().sort();
  const expectedCc = parseStoredArray(attempt.cc_recipients).slice().sort();
  if (email?.subject !== attempt.subject
    || email?.description !== attempt.body_html
    || email?.subcategory !== correlationKey(attempt)
    || JSON.stringify(addresses(1)) !== JSON.stringify([attempt.from_email])
    || JSON.stringify(addresses(2)) !== JSON.stringify(expectedTo)
    || JSON.stringify(addresses(3)) !== JSON.stringify(expectedCc)) {
    throw agendaError(
      'The recovered Dynamics activity no longer matches this exact agenda preview.',
      'agenda_email_mismatch',
      500,
    );
  }
}

async function assertAgendaCurrent(attempt, dependencies) {
  const current = await dependencies.getSession({ sessionId: attempt.session_id });
  const snapshot = parseStoredObject(attempt.agenda_snapshot);
  if (!snapshot || agendaScheduleChanged(current.session, current.slots, snapshot)) {
    throw agendaError(
      'The session schedule changed after this preview. Create a new preview, review it, and then send.',
      'agenda_operation_stale',
      409,
    );
  }
}

export async function sendAgendaEmail(input, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(input?.sessionId || '') || !isGuid(input?.operationId || '')) {
    throw agendaError('Valid sessionId and operationId values are required.', 'agenda_identity_invalid', 400);
  }
  const fromEmail = requireActorAndSender(input);
  let existing = await dependencies.getAgenda(input.operationId);
  if (!existing || !sameId(existing.session_id, input.sessionId)) {
    throw agendaError('The prepared agenda was not found.', 'agenda_not_found', 404);
  }
  if (existing.state === 'sent') return { agenda: projectAgenda(existing), reused: true };
  if (existing.state === 'failed') {
    throw terminalAgendaError(existing);
  }
  const competing = await dependencies.getLatestUnresolvedAgenda(input.sessionId);
  if (competing && !sameId(competing.operation_id, input.operationId)) {
    throw unresolvedAgendaError(competing);
  }
  let attempt = await dependencies.claimSend(input.operationId);
  if (!attempt) {
    existing = await dependencies.getAgenda(input.operationId);
    if (existing?.state === 'sent') return { agenda: projectAgenda(existing), reused: true };
    if (existing?.state === 'failed') throw terminalAgendaError(existing);
    throw agendaError(
      'This agenda send is already in progress. Retry shortly to read its result.',
      'agenda_send_in_progress',
      409,
      { inProgress: true },
    );
  }
  try {
    // Once send intent is durable, reconcile transport before any freshness
    // check: the activity may already have been accepted by Dynamics.
    if (attempt.send_requested_at && attempt.dynamics_email_id) {
      const reconciled = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => null);
      if (SEND_ACCEPTED_STATUS_CODES.has(Number(reconciled?.statuscode))) {
        const sent = await dependencies.recordSent(attempt, reconciled);
        if (!sent) throw agendaError('Transport acceptance could not be persisted.', 'agenda_send_persist_failed', 502);
        return { agenda: projectAgenda(sent), reused: true };
      }
      const statusCode = Number(reconciled?.statuscode);
      if (SEND_TERMINAL_STATUS_CODES.has(statusCode)) {
        const reason = `Dynamics closed the email with status ${statusCode} without accepted outbound transport.`;
        attempt = await dependencies.recordTerminalFailure(attempt, reconciled || {}, reason);
        if (!attempt) {
          throw agendaError(
            'The terminal Dynamics email status could not be persisted.',
            'agenda_terminal_persist_failed',
            502,
          );
        }
        throw agendaError(
          `${reason} Create a new preview before sending again.`,
          'agenda_send_terminal',
          409,
          { failedSend: projectAgenda(attempt) },
        );
      }
      if (statusCode === 1) {
        if (attempt.from_email !== fromEmail
          || !sameId(attempt.acting_user_system_id, input.actingUserSystemId)) {
          throw agendaError('This agenda belongs to a different staff sender.', 'agenda_actor_mismatch', 403);
        }
        attempt = await dependencies.recordDraftReconciled(attempt, reconciled);
        if (!attempt) {
          throw agendaError(
            'The confirmed Draft status could not be reconciled before retrying transport.',
            'agenda_draft_reconcile_failed',
            502,
          );
        }
      } else {
        throw agendaError(
          'Dynamics has not confirmed transport acceptance for this agenda. Retry this same send before creating another agenda.',
          'agenda_send_unconfirmed',
          202,
          { pendingSend: projectAgenda(attempt) },
        );
      }
    }

    if (attempt.from_email !== fromEmail
      || !sameId(attempt.acting_user_system_id, input.actingUserSystemId)) {
      throw agendaError('This agenda belongs to a different staff sender.', 'agenda_actor_mismatch', 403);
    }
    if (!dependencies.impersonationEnabled()) {
      throw agendaError(
        'Dynamics sender impersonation must be enabled before this agenda can be sent.',
        'agenda_impersonation_required',
        503,
      );
    }

    await assertAgendaCurrent(attempt, dependencies);
    let email = await recoverEmailActivity(attempt, dependencies);
    if (!email && attempt.dynamics_email_id) {
      throw agendaError(
        'The persisted Dynamics email activity could not be found. Reconcile it before retrying.',
        'agenda_email_missing',
        409,
      );
    }
    if (email && !attempt.dynamics_email_id) {
      attempt = await persistEmailIdentity(attempt, email.activityid, dependencies);
    }
    if (!email) {
      try {
        const emailId = await dependencies.createEmailActivity({
          subject: attempt.subject,
          body: attempt.body_html,
          from: attempt.from_email,
          to: parseStoredArray(attempt.to_recipients),
          cc: parseStoredArray(attempt.cc_recipients),
          correlationKey: correlationKey(attempt),
          actingUserSystemId: input.actingUserSystemId,
          noFallback: true,
        });
        attempt = await persistEmailIdentity(attempt, emailId, dependencies);
        email = await dependencies.getEmailActivity(attempt.dynamics_email_id);
      } catch (error) {
        email = await recoverEmailActivity(attempt, dependencies);
        if (!email) throw error;
        attempt = await persistEmailIdentity(attempt, email.activityid, dependencies);
      }
    }
    assertEmailActivityMatches(attempt, email);

    const before = await dependencies.getEmailActivity(attempt.dynamics_email_id);
    if (SEND_ACCEPTED_STATUS_CODES.has(Number(before?.statuscode))) {
      const sent = await dependencies.recordSent(attempt, before);
      if (!sent) throw agendaError('Transport acceptance could not be persisted.', 'agenda_send_persist_failed', 502);
      return { agenda: projectAgenda(sent), reused: true };
    }

    await assertAgendaCurrent(attempt, dependencies);
    try {
      attempt = await dependencies.recordSendRequested(attempt);
    } catch (error) {
      const pending = await dependencies.getLatestUnresolvedAgenda(input.sessionId).catch(() => null);
      if (pending && !sameId(pending.operation_id, input.operationId)) {
        throw unresolvedAgendaError(pending);
      }
      throw error;
    }
    if (!attempt) throw agendaError('The exact send intent could not be persisted.', 'agenda_send_request_persist_failed', 502);
    attempt = await dependencies.renewSendLease(attempt);
    if (!attempt) {
      throw agendaError(
        'The agenda send lease expired before transport. Retry to reconcile its state.',
        'agenda_send_lease_lost',
        409,
      );
    }
    try {
      await dependencies.sendEmail(attempt.dynamics_email_id, {
        actingUserSystemId: input.actingUserSystemId,
        noFallback: true,
      });
    } catch (error) {
      const ambiguous = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => null);
      if (!SEND_ACCEPTED_STATUS_CODES.has(Number(ambiguous?.statuscode))) throw error;
    }
    const after = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => null);
    if (!SEND_ACCEPTED_STATUS_CODES.has(Number(after?.statuscode))) {
      throw agendaError(
        'Dynamics accepted the send request, but its transport status is not confirmed yet. Retry this same send before creating another agenda.',
        'agenda_send_unconfirmed',
        202,
        { pendingSend: projectAgenda(attempt) },
      );
    }
    const sent = await dependencies.recordSent(attempt, after);
    if (!sent) throw agendaError('Transport acceptance could not be persisted.', 'agenda_send_persist_failed', 502);
    return { agenda: projectAgenda(sent), reused: false };
  } catch (error) {
    await dependencies.recordFailure(attempt, error, error?.code || 'agenda_send_failed').catch(() => {});
    throw error;
  }
}

export const MEETING_TRACKER_AGENDA_DEPENDENCIES = DEFAULT_DEPENDENCIES;
export const _internal = {
  agendaSlotText,
  agendaSnapshotComparisonTuple,
  assertEmailActivityMatches,
  correlationKey,
  projectAgenda,
  safeHttpsUrl,
  instantKey,
  scheduleSignature,
};
