/**
 * ContactBridgeService — Entra External ID OID → Dataverse `contact` GUID.
 *
 * The applicant portal authenticates against a separate Entra External ID
 * tenant; each session carries `contactOid` (Entra OID) + `contactEmail`
 * + `contactName`. Every downstream Dataverse operation needs the contact's
 * **`contactid` GUID** — not the OID — to bind via lookup fields like
 * `_wmkf_contact_value` (memberships), `wmkf_Contact@odata.bind`
 * (apprequestperson roster rows), etc.
 *
 * Resolution order (drain plan v7 §"Build pieces" #1 + INTAKE_PORTAL_DESIGN.md:175):
 *   1. OID match  — `contact?$filter=wmkf_portaloid eq '<oid>'`
 *   2. Email-link — `contact?$filter=emailaddress1 eq '<email>' and wmkf_portaloid eq null`
 *                   → PATCH wmkf_portaloid onto the matched contact (first-link-only)
 *   3. Create     — POST new contact with wmkf_portaloid + emailaddress1
 *                   (firstname/lastname derived from contactName or email)
 *
 * Conflict route (DESIGN.md:175): if OID lookup misses but email lookup
 * hits a contact that already has a DIFFERENT wmkf_portaloid set, do NOT
 * auto-link — surface `{ ok: false, reason: 'conflict' }` and write
 * `intake_audit action='bridge.conflict'`. Email-fallback matching is
 * intentionally first-link-only so an applicant changing their email
 * can't silently capture another person's contact row.
 *
 * Concurrency: two parallel bridge calls for the same OID could both miss
 * step 1, both miss step 2, both attempt step 3. The Dataverse alternate
 * key on `wmkf_portaloid` (deployed S179, transitions Pending → Active
 * asynchronously) is the canonical guard. We add defensive duplicate-PK
 * recovery (re-query by OID after create-conflict) so the bridge works
 * correctly whether or not the alt-key is Active yet.
 */

import { DynamicsService } from './dynamics-service';
import { classify } from '../utils/drain-error-classifier';

const CONTACT_SELECT = ['contactid', 'wmkf_portaloid', 'emailaddress1', 'firstname', 'lastname'].join(',');

/**
 * Find a contact whose `wmkf_portaloid` matches the supplied OID.
 * Returns the contact record or null.
 */
async function findByOid(oid) {
  const escaped = String(oid).replace(/'/g, "''");
  const { records } = await DynamicsService.queryRecords('contacts', {
    select: CONTACT_SELECT,
    filter: `wmkf_portaloid eq '${escaped}'`,
    top: 2, // top:2 so we can detect (and alert on) multi-match anomalies
  });
  if (records.length === 0) return null;
  if (records.length > 1) {
    // Alt-key violation — should be impossible once Active. Throw structured.
    const err = new Error(`bridge: multiple contacts share wmkf_portaloid=${oid} (alt-key violated)`);
    err.serviceName = 'bridge';
    err.isTransient = false;
    throw err;
  }
  return records[0];
}

/**
 * Find a contact by `emailaddress1` — used for both the email-link path
 * (when wmkf_portaloid is null) and the conflict-detection branch (when
 * an existing contact already has a different OID).
 *
 * Returns ALL matches up to top:5 so the caller can branch on the
 * has-different-OID case (conflict) vs. has-null-OID case (link).
 */
async function findByEmail(email) {
  const escaped = String(email).toLowerCase().replace(/'/g, "''");
  const { records } = await DynamicsService.queryRecords('contacts', {
    select: CONTACT_SELECT,
    filter: `emailaddress1 eq '${escaped}'`,
    top: 5,
  });
  return records;
}

/**
 * Split a display name into { firstname, lastname }. Lastname is the
 * Dataverse contact required field — we always populate it, falling back
 * to the email username if name parsing yields nothing.
 */
function splitName(displayName, email) {
  if (displayName && typeof displayName === 'string') {
    const trimmed = displayName.trim();
    if (trimmed.length > 0) {
      const parts = trimmed.split(/\s+/);
      if (parts.length === 1) return { firstname: null, lastname: parts[0] };
      return {
        firstname: parts.slice(0, -1).join(' '),
        lastname: parts[parts.length - 1],
      };
    }
    // fall through to email fallback for whitespace-only input
  }
  // Fallback: email username
  const local = String(email || '').split('@')[0] || 'unknown';
  return { firstname: null, lastname: local };
}

/**
 * PATCH wmkf_portaloid onto an existing contact (email-link path).
 * Guard: only call when existing.wmkf_portaloid is null — caller's job.
 */
async function attachOidToContact(contactId, oid) {
  await DynamicsService.updateRecord('contacts', contactId, {
    wmkf_portaloid: oid,
  });
}

/**
 * Create a new contact for this OID/email/name.
 */
async function createContact({ oid, email, name }) {
  const { firstname, lastname } = splitName(name, email);
  const body = {
    wmkf_portaloid: oid,
    emailaddress1: String(email).toLowerCase(),
    lastname,
  };
  if (firstname) body.firstname = firstname;
  const created = await DynamicsService.createRecord('contacts', body);
  return created;
}

/**
 * Main entry point. Returns a discriminated result:
 *   { ok: true, contactId, source: 'oid_match'|'email_link'|'created' }
 *   { ok: false, reason: 'conflict',  existingContactId, existingOid }
 *   { ok: false, reason: 'invalid_session', message }
 *
 * Callers should NOT pass session fields directly; pass primitives so the
 * unit tests don't need a full next-auth session mock.
 */
export async function resolveContactForSession({ oid, email, name } = {}) {
  if (!oid || typeof oid !== 'string') {
    return { ok: false, reason: 'invalid_session', message: 'oid required' };
  }
  if (!email || typeof email !== 'string') {
    return { ok: false, reason: 'invalid_session', message: 'email required' };
  }

  // Step 1 — OID match.
  const byOid = await findByOid(oid);
  if (byOid) {
    return { ok: true, contactId: byOid.contactid, source: 'oid_match' };
  }

  // Step 2 — email lookup. Branch on the existing contact's OID state.
  const byEmail = await findByEmail(email);
  if (byEmail.length > 1) {
    // Multi-match on email — operational ambiguity. Treat as conflict;
    // staff should dedupe or pick one.
    return {
      ok: false,
      reason: 'conflict',
      message: `multiple contacts share emailaddress1=${email}`,
      candidates: byEmail.map((c) => ({ contactId: c.contactid, existingOid: c.wmkf_portaloid })),
    };
  }
  if (byEmail.length === 1) {
    const existing = byEmail[0];
    if (existing.wmkf_portaloid == null) {
      // Email-link path: attach our OID to the existing contact.
      await attachOidToContact(existing.contactid, oid);
      return { ok: true, contactId: existing.contactid, source: 'email_link' };
    }
    if (existing.wmkf_portaloid === oid) {
      // Same OID — defensive consistency check. Shouldn't happen because
      // step 1 would have matched, but if the OID query missed for some
      // transient reason and the email query catches it, accept and move on.
      return { ok: true, contactId: existing.contactid, source: 'oid_match' };
    }
    // Different OID set on the email-match → conflict, do not link.
    return {
      ok: false,
      reason: 'conflict',
      message: `contact ${existing.contactid} already linked to a different portal identity`,
      existingContactId: existing.contactid,
      existingOid: existing.wmkf_portaloid,
    };
  }

  // Step 3 — create. Defensive duplicate-PK recovery: if two bridge calls
  // raced past step 1, the alt-key (once Active) makes the second create
  // 412/409. Re-query by OID and use that.
  try {
    const created = await createContact({ oid, email, name });
    return { ok: true, contactId: created.contactid, source: 'created' };
  } catch (err) {
    const cls = classify(err);
    if (cls.category === 'duplicate_pk') {
      const recovered = await findByOid(oid);
      if (recovered) {
        return { ok: true, contactId: recovered.contactid, source: 'oid_match' };
      }
      // Alt-key matched some other column we don't know about — surface.
      err.bridgeNote = 'create returned duplicate_pk but post-recovery OID lookup found no row';
    }
    throw err;
  }
}

// Internal helpers exported for unit testing only.
export const _testing = {
  findByOid,
  findByEmail,
  attachOidToContact,
  createContact,
  splitName,
};
