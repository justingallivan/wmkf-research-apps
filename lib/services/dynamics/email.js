// @ts-check
/**
 * DynamicsService decomposition — Stage 8 module (Checkpoint E, CRM email).
 *
 * Moved verbatim from lib/services/dynamics-service.js: the CRM email pipeline —
 * `resolveSystemUser`, `createEmailActivity`, `addEmailAttachment`, `sendEmail`,
 * `createAndSendEmail`. Each method gains the C1 svc-dispatch rewrite (`this.` →
 * `svc.`) so sibling calls (`svc.getAccessToken`, `svc.buildHeaders`,
 * `svc._withCallerId`, `svc._writeFetch`, `svc.queryRecords`,
 * `svc.resolveEntitySetName`, and the composed `svc.createEmailActivity` /
 * `svc.addEmailAttachment` / `svc.sendEmail`) still route through the facade and
 * its test spies. Nothing else in the bodies changed.
 *
 * ENFORCEMENT NOTE (Checkpoint E, from the plan): the three write helpers
 * (`createEmailActivity`, `addEmailAttachment`, `sendEmail`) are exempt from the
 * static access-layer gate as `NON_ENTITY_TRANSPORT_METHODS`, so the runtime
 * `assertTrustedDalContext` asserts (kept FIRST-statement, C2) are the ONLY
 * enforcement on this surface — a dropped assert would be CI-invisible.
 * `createAndSendEmail` has no assert of its own: it composes the three guarded
 * writes and never mutates directly. `resolveSystemUser` is a read.
 *
 * C7 (known-and-frozen): `resolveSystemUser` interpolates the email RAW into an
 * OData filter — this is a pre-existing, deliberately-unfrozen defect carried
 * as-is by the behavior-freeze. Routing it through `odata.escape` is a semantic
 * change and a separate post-decomposition follow-up; do NOT "fix" it here.
 *
 * C9: `createAndSendEmail` reads `process.env.DYNAMICS_IMPERSONATION_ENABLED` at
 * call time — not hoisted to module load (tests set env per-case).
 *
 * C13 (error-shape freeze): the email writes throw a plain Error with the
 * interpolated status text (not buildServiceError); byte-identical bodies keep
 * this. Deps: dynamics-context (`assertTrustedDalContext`) only — network access
 * and header construction are reached via `svc` (C1), not direct imports.
 */

import { assertTrustedDalContext } from '../dynamics-context.js';

/**
 * The DynamicsService facade receiver (C1 svc-dispatch). Typed `any` here on
 * purpose: the facade's own typed coverage is deferred to the decomposition's
 * facade-finalize checkpoint. See docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md.
 * @typedef {any} Svc
 */

/**
 * Resolve an email address to a Dynamics system user ID.
 * Required for sender party — Dynamics needs a partyid reference.
 * @param {Svc} svc
 * @param {string} email
 */
export async function resolveSystemUser(svc, email) {
  const { records } = await svc.queryRecords('systemusers', {
    select: 'systemuserid',
    filter: `internalemailaddress eq '${email}'`,
    top: 1,
  });
  if (records.length === 0) {
    throw new Error(`No Dynamics system user found for email: ${email}`);
  }
  return records[0].systemuserid;
}

/**
 * Create an email activity record in Dynamics CRM.
 *
 * @param {Svc} svc
 * @param {{ subject: string, body: string, from: string, to: string|string[],
 *   cc?: string|string[], regardingId?: string, regardingType?: string,
 *   correlationKey?: string, actingUserSystemId?: string|null,
 *   noFallback?: boolean }} params
 *   subject: Email subject; body: Email body (HTML supported); from: sender
 *   email; to: recipient email(s); cc: CC email(s); regardingId: GUID of the
 *   regarding entity (e.g. request); regardingType: logical name of regarding
 *   entity (e.g. 'akoya_request').
 * @returns {Promise<string>} The created email activity ID
 */
export async function createEmailActivity(svc, { subject, body, from, to, cc, regardingId, regardingType, correlationKey, actingUserSystemId, noFallback = false }) {
  assertTrustedDalContext('DynamicsService.createEmailActivity');
  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;

  // Resolve sender to a system user (required for SendEmail)
  const senderUserId = await svc.resolveSystemUser(from);

  // Build activity parties
  const parties = [];

  // Sender (participationtypemask = 1) — must bind to a system user
  parties.push({
    participationtypemask: 1,
    addressused: from,
    'partyid_systemuser@odata.bind': `/systemusers(${senderUserId})`,
  });

  // To recipients (participationtypemask = 2)
  const toList = Array.isArray(to) ? to : [to];
  for (const addr of toList) {
    parties.push({ participationtypemask: 2, addressused: addr });
  }

  // CC recipients (participationtypemask = 3)
  if (cc) {
    const ccList = Array.isArray(cc) ? cc : [cc];
    for (const addr of ccList) {
      parties.push({ participationtypemask: 3, addressused: addr });
    }
  }

  /** @type {Record<string, any>} */
  const emailData = {
    subject,
    description: body,
    directioncode: true, // Outgoing
    email_activity_parties: parties,
    ...(correlationKey ? { subcategory: String(correlationKey).slice(0, 100) } : {}),
  };

  // Link to a regarding record (e.g., a request)
  if (regardingId && regardingType) {
    const entitySet = await svc.resolveEntitySetName(regardingType);
    emailData[`regardingobjectid_${regardingType}@odata.bind`] = `/${entitySet}(${regardingId})`;
  }

  const resp = await svc._writeFetch(`${baseUrl}/api/data/v9.2/emails`, {
    method: 'POST',
    headers: svc._withCallerId({
      ...svc.buildHeaders(token),
      Prefer: 'return=representation',
    }, actingUserSystemId),
    body: JSON.stringify(emailData),
  }, actingUserSystemId, { noFallback });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`Failed to create email activity (${resp.status}): ${errorBody}`);
  }

  const result = await resp.json();
  return result.activityid;
}

/**
 * Add an attachment to an email activity.
 *
 * @param {Svc} svc
 * @param {string} emailId - Email activity ID
 * @param {{ filename: string, contentType: string, content: Buffer|string,
 *   actingUserSystemId?: string|null, noFallback?: boolean }} attachment
 */
export async function addEmailAttachment(svc, emailId, { filename, contentType, content, actingUserSystemId, noFallback = false }) {
  assertTrustedDalContext('DynamicsService.addEmailAttachment');
  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;

  const base64Body = Buffer.isBuffer(content)
    ? content.toString('base64')
    : content;

  const attachmentData = {
    'objectid_email@odata.bind': `/emails(${emailId})`,
    objecttypecode: 'email',
    subject: filename,
    filename,
    mimetype: contentType || 'application/octet-stream',
    body: base64Body,
  };

  const resp = await svc._writeFetch(`${baseUrl}/api/data/v9.2/activitymimeattachments`, {
    method: 'POST',
    headers: svc._withCallerId(svc.buildHeaders(token), actingUserSystemId),
    body: JSON.stringify(attachmentData),
  }, actingUserSystemId, { noFallback });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`Failed to add email attachment "${filename}" (${resp.status}): ${errorBody}`);
  }
}

/**
 * Send an email activity via the Dynamics SendEmail action.
 * The email must already be created via createEmailActivity().
 *
 * @param {Svc} svc
 * @param {string} emailId - Email activity ID to send
 * @param {{ actingUserSystemId?: string|null, noFallback?: boolean }} [options]
 */
export async function sendEmail(svc, emailId, { actingUserSystemId, noFallback = false } = {}) {
  assertTrustedDalContext('DynamicsService.sendEmail');
  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;

  const resp = await svc._writeFetch(`${baseUrl}/api/data/v9.2/emails(${emailId})/Microsoft.Dynamics.CRM.SendEmail`, {
    method: 'POST',
    headers: svc._withCallerId(svc.buildHeaders(token), actingUserSystemId),
    body: JSON.stringify({
      IssueSend: true,
    }),
  }, actingUserSystemId, { noFallback });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`Failed to send email (${resp.status}): ${errorBody}`);
  }
}

/**
 * Create, optionally attach files, and send an email in one call.
 *
 * @param {Svc} svc
 * @param {{ subject: string, body: string, from: string, to: string|string[],
 *   cc?: string|string[], regardingId?: string, regardingType?: string,
 *   attachments?: any[], actingUserSystemId?: string|null, noFallback?: boolean }} options
 *   Same as createEmailActivity plus attachments: array of { filename, contentType, content }.
 * @returns {Promise<{ emailId: string }>} The sent email activity ID
 */
export async function createAndSendEmail(svc, { subject, body, from, to, cc, regardingId, regardingType, attachments = [], actingUserSystemId, noFallback = false }) {
  if (noFallback && actingUserSystemId && process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
    throw new Error('Dynamics impersonation is disabled; noFallback requested');
  }

  // Step 1: Create the email activity
  const emailId = await svc.createEmailActivity({ subject, body, from, to, cc, regardingId, regardingType, actingUserSystemId, noFallback });

  // Step 2: Add attachments (sequentially to avoid race conditions)
  for (const attachment of attachments) {
    await svc.addEmailAttachment(emailId, { ...attachment, actingUserSystemId, noFallback });
  }

  // Step 3: Send
  await svc.sendEmail(emailId, { actingUserSystemId, noFallback });

  return { emailId };
}
