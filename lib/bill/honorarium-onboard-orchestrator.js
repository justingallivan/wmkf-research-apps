/**
 * Honorarium onboarding orchestrator — the chunk-4 post-accept step.
 *
 * Runs after a reviewer accepts (Stage 2a) and has NOT opted out of the
 * honorarium. Encapsulates everything respond.js needs so the route stays lean
 * and this stays unit-testable with injected fakes:
 *
 *   1. Ensure a CRM contact (promote-on-accept fallback — send-emails promotion
 *      is non-fatal, so the contact link may be missing here).
 *   2. PATCH the reviewer's mailing address onto the contact (address1_*).
 *   3. Idempotent honorarium akoya_request create:
 *        - fast-path: the suggestion's wmkf_HonorariumRequest junction already
 *          points at a honorarium → reuse, skip create.
 *        - else: create with a DETERMINISTIC GUID (uuidv5 of the suggestion id)
 *          so a retry collides on the primary key instead of minting a second
 *          honorarium (Codex pre-impl P1 #1 — a fresh random GUID per stateless
 *          retry never trips a duplicate guard). Duplicate → confirm-by-read →
 *          reuse. Then PATCH the junction (durable provenance marker).
 *   4. Drive BILL vendor onboarding via the in-process onboard service.
 *
 * The caller (respond.js) treats ANY throw from here as non-fatal to the accept
 * — the suggestion-row accept already committed; a honorarium failure alerts +
 * is retried, never 500s the reviewer.
 *
 * Design: docs/BILL_CHUNK_4_DESIGN.md "Thread 1".
 */

import { v5 as uuidv5 } from 'uuid';
import { DynamicsService } from '../services/dynamics-service.js';
import * as contactAdapter from '../dataverse/adapters/contact.js';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer.js';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
import { backPropReviewerOrcidToContact } from '../services/backprop-reviewer-orcid.js';
import { getHonorariumAmount } from '../services/honorarium-config.js';
import { onboardReviewer } from './onboard-reviewer-service.js';
import {
  HONORARIUM_PROGRAM_ID,
  HONORARIUM_GRANTPROGRAM_ID,
  HONORARIUM_TYPE_ID,
  HONORARIUM_REQUEST_TYPE_INDIVIDUAL,
  assertHonorariumDiscriminatorsConfigured,
} from './honorarium-discriminators.js';

// Fixed namespace so the honorarium GUID is a stable function of the suggestion
// id (one honorarium per reviewer-of-this-proposal engagement). Arbitrary but
// constant — DO NOT change once any honorarium has been minted.
const HONORARIUM_GUID_NAMESPACE = 'b1d9f0c2-4a3e-5c6d-8e7f-0a1b2c3d4e5f';

export async function ensureHonorariumOnboarding({ suggestion, request, reviewer, body, actingUserSystemId }, deps = {}) {
  const {
    dynamics = DynamicsService,
    contacts = contactAdapter,
    potentialReviewers = potentialReviewerAdapter,
    suggestions = suggestionAdapter,
    onboard = onboardReviewer,
    getAmount = getHonorariumAmount,
    backProp = backPropReviewerOrcidToContact,
    deriveGuid = (name) => uuidv5(name, HONORARIUM_GUID_NAMESPACE),
  } = deps;

  const suggestionId = suggestion.wmkf_appreviewersuggestionid;
  if (!suggestionId) throw new Error('ensureHonorariumOnboarding: suggestion id missing');

  // ── 1. Ensure contact (promote-on-accept) ──
  const contactId = await ensureContact({ reviewer, body, contacts, potentialReviewers, actingUserSystemId });

  // ── 1b. ORCID back-prop onto the contact (design §5). Second promotion site;
  // shares the one helper. Best-effort — a back-prop failure must not abort
  // honorarium-create/onboarding. The external accept path has no acting staff
  // user, so the write is attributed to the service principal (native audit
  // still records actor + prior value, §7).
  try {
    await backProp({ reviewer, contactId, actingUserSystemId });
  } catch (bpErr) {
    console.warn('[honorarium-orchestrator] ORCID back-prop failed (non-fatal):', bpErr?.message || bpErr);
  }

  // ── 2. Address → contact.address1_* (BEST-EFFORT; Codex post-impl) ──
  // A failed address write must not abort honorarium-create/onboarding — the
  // address also rides on the BILL vendor payload downstream, and the contact
  // already carries a prior address in the common case.
  try {
    await patchContactAddress(dynamics, contactId, body.address);
  } catch (addrErr) {
    console.warn('[honorarium-orchestrator] contact address PATCH failed (non-fatal):', addrErr?.message || addrErr);
  }

  // ── 3. Idempotent honorarium create ──
  let honorariumRequestId = suggestion._wmkf_honorariumrequest_value || null;
  let created = false;
  if (!honorariumRequestId) {
    assertHonorariumDiscriminatorsConfigured();
    const amount = await getAmount(); // throws on unavailable/malformed → caller alerts + skips
    honorariumRequestId = deriveGuid(suggestionId);

    const createBody = {
      akoya_requestid: honorariumRequestId,
      'akoya_ProgramId@odata.bind': `/akoya_programs(${HONORARIUM_PROGRAM_ID})`,
      'wmkf_GrantProgram@odata.bind': `/wmkf_grantprograms(${HONORARIUM_GRANTPROGRAM_ID})`,
      'wmkf_Type@odata.bind': `/wmkf_types(${HONORARIUM_TYPE_ID})`,
      'akoya_PrimaryContactId@odata.bind': `/contacts(${contactId})`,
      wmkf_request_type: HONORARIUM_REQUEST_TYPE_INDIVIDUAL,
      akoya_recommendedamount: amount,
      ...(request?.wmkf_meetingdate ? { wmkf_meetingdate: request.wmkf_meetingdate } : {}),
    };

    try {
      await dynamics.createRecord('akoya_requests', createBody);
      created = true;
    } catch (err) {
      // Deterministic GUID → a retry of an already-succeeded create lands here.
      // Confirm the row exists before swallowing; a genuine create failure rethrows.
      const found = await dynamics
        .getRecord('akoya_requests', honorariumRequestId, { select: 'akoya_requestid' })
        .catch(() => null);
      if (!found) throw err;
    }

    // Durable provenance marker. Idempotent (same id → no-op PATCH).
    await suggestions.setHonorariumRequest(suggestionId, honorariumRequestId);
  }

  // ── 4. BILL onboarding (in-process; always 200s with status in body) ──
  const onboardResult = await onboard({
    honorariumRequestId,
    reviewerContactId: contactId,
    reviewerName: resolveName(reviewer, body),
    reviewerEmail: resolveEmail(reviewer, body),
    ...(resolvePhone(reviewer, body) ? { reviewerPhone: resolvePhone(reviewer, body) } : {}),
    address: toOnboardAddress(body.address),
  });

  return {
    honorariumRequestId,
    contactId,
    created,
    onboardStatus: onboardResult?.status || null,
  };
}

// ─────────────────────────── helpers ───────────────────────────

async function ensureContact({ reviewer, body, contacts, potentialReviewers, actingUserSystemId }) {
  const existing = reviewer?._wmkf_contact_value || null;
  if (existing) return existing;

  const email = (body.contactEdits?.email || reviewer?.wmkf_emailaddress || '').trim();
  if (!email) {
    const e = new Error('cannot create honorarium contact: no email on reviewer or contactEdits');
    e.code = 'honorarium_no_email';
    throw e;
  }
  const firstName = body.contactEdits?.firstName || reviewer?.wmkf_firstname || null;
  const lastName = body.contactEdits?.lastName || reviewer?.wmkf_lastname || null;
  const { id } = await contacts.findOrCreateByEmail({ firstName, lastName, email }, { actingUserSystemId });

  // Link the potentialreviewer → contact (non-fatal; honorarium can proceed
  // with the contactId even if the back-link write fails).
  if (reviewer?.wmkf_potentialreviewersid) {
    try {
      await potentialReviewers.setContactLink(reviewer.wmkf_potentialreviewersid, id, { actingUserSystemId });
    } catch (err) {
      console.warn('[honorarium-orchestrator] setContactLink failed (non-fatal):', err?.message || err);
    }
  }
  return id;
}

async function patchContactAddress(dynamics, contactId, address) {
  if (!address || typeof address !== 'object') return;
  const map = {
    line1: 'address1_line1',
    line2: 'address1_line2',
    city: 'address1_city',
    state: 'address1_stateorprovince',
    postalCode: 'address1_postalcode',
    country: 'address1_country',
  };
  const payload = {};
  for (const [k, col] of Object.entries(map)) {
    const v = address[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') payload[col] = v;
  }
  if (Object.keys(payload).length) {
    await dynamics.updateRecord('contacts', contactId, payload);
  }
}

function resolveName(reviewer, body) {
  const first = body.contactEdits?.firstName || reviewer?.wmkf_firstname || '';
  const last = body.contactEdits?.lastName || reviewer?.wmkf_lastname || '';
  const composed = `${first} ${last}`.trim();
  return composed || reviewer?.wmkf_name || 'Unknown Reviewer';
}

function resolveEmail(reviewer, body) {
  return (body.contactEdits?.email || reviewer?.wmkf_emailaddress || '').trim() || undefined;
}

function resolvePhone(reviewer, body) {
  return (body.contactEdits?.phone || reviewer?.wmkf_phone || '').trim() || undefined;
}

function toOnboardAddress(address) {
  if (!address || typeof address !== 'object') return undefined;
  return {
    line1: address.line1,
    city: address.city,
    ...(address.state ? { state: address.state } : {}),
    zipOrPostalCode: address.postalCode,
    country: address.country,
  };
}
