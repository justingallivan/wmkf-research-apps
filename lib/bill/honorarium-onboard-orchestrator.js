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
import { ContactParser } from '../utils/contact-parser.js';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer.js';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
import { backPropReviewerOrcidToContact } from '../services/backprop-reviewer-orcid.js';
import { getHonorariumAmount } from '../services/honorarium-config.js';
import { onboardReviewer } from './onboard-reviewer-service.js';
import NotificationService from '../services/notification-service.js';
import {
  HONORARIUM_PROGRAM_ID,
  HONORARIUM_GRANTPROGRAM_ID,
  HONORARIUM_TYPE_ID,
  HONORARIUM_REQUEST_TYPE_INDIVIDUAL,
  HONORARIUM_AKOYA_REQUEST_TYPE_SCHOLARSHIP,
  HONORARIUM_CURRENCY_ID,
  assertHonorariumDiscriminatorsConfigured,
  honorariumDiscriminatorsConfigured,
} from './honorarium-discriminators.js';

// Capture-only (deferred) gate. When the honorarium payment pipeline isn't
// enabled yet — an explicit leadership switch (HONORARIUM_ONBOARDING_DEFERRED),
// OR the discriminator GUIDs simply aren't configured — the orchestrator still
// captures contact + mailing address but STOPS before creating the akoya_request
// or calling BILL, and does NOT throw (so the accept path fires no per-reviewer
// alert). Mirrors lib/bill/onboard-reviewer-service.js's BILL_ONBOARDING_DEFERRED
// tier, one step earlier in the pipeline. Reversible: configure the GUIDs / unset
// the flag and the full create+onboard tail runs unchanged on a later accept.
function defaultHonorariumOnboardingDeferred() {
  return process.env.HONORARIUM_ONBOARDING_DEFERRED === 'true' || !honorariumDiscriminatorsConfigured();
}

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
    isDeferred = defaultHonorariumOnboardingDeferred,
    // Bound wrapper, not a bare `NotificationService.notify` reference: notify()
    // calls `this.isEmailEnabled()` etc., so an unbound reference would lose `this`.
    notify = (opts) => NotificationService.notify(opts),
  } = deps;

  const suggestionId = suggestion.wmkf_appreviewersuggestionid;
  if (!suggestionId) throw new Error('ensureHonorariumOnboarding: suggestion id missing');

  // ── 1. Ensure contact (promote-on-accept) ──
  const contactId = await ensureContact({ reviewer, body, contacts, potentialReviewers, actingUserSystemId, notify });

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
  // already carries a prior address in the common case. We DO record the failure:
  // in capture-only mode (2b) there is no downstream copy, so the caller must be
  // told the address didn't land instead of treating it as a clean capture
  // (Codex S274 P1 — silent data loss for the one thing capture-only exists for).
  let addressCaptureError = null;
  try {
    await patchContactAddress(dynamics, contactId, body.address);
  } catch (addrErr) {
    addressCaptureError = addrErr?.message || String(addrErr);
    console.warn('[honorarium-orchestrator] contact address PATCH failed (non-fatal):', addressCaptureError);
  }

  // ── 2b. Capture-only short-circuit (honorarium onboarding deferred) ──
  // Contact + mailing address are now captured. If the payment pipeline isn't
  // enabled yet, STOP here: do NOT mint the akoya_request, do NOT call BILL, and
  // do NOT throw — the caller decides the alert posture from the fields below.
  // The reviewer's accept + honorarium opt-out are persisted independently on the
  // suggestion row.
  if (isDeferred()) {
    // Partial go-live misconfiguration signal (Codex S274 P2): some-but-not-all
    // discriminator GUIDs set AND no explicit defer flag → likely a botched
    // go-live, not an intentional capture-only cycle. Read live env (a diagnostic,
    // independent of the gate's cached configured() check) so the caller can alert.
    const guidEnvs = [
      process.env.HONORARIUM_PROGRAM_ID,
      process.env.HONORARIUM_GRANTPROGRAM_ID,
      process.env.HONORARIUM_TYPE_ID,
    ];
    const guidsSet = guidEnvs.filter((v) => typeof v === 'string' && v.trim() !== '').length;
    const explicitDefer = process.env.HONORARIUM_ONBOARDING_DEFERRED === 'true';
    return {
      status: 'deferred',
      contactId,
      honorariumRequestId: suggestion._wmkf_honorariumrequest_value || null,
      created: false,
      onboardStatus: null,
      addressCaptureError, // null on success; message string when the address PATCH failed
      partialDiscriminatorConfig: !explicitDefer && guidsSet > 0 && guidsSet < 3,
    };
  }

  // ── 3. Idempotent honorarium create ──
  let honorariumRequestId = suggestion._wmkf_honorariumrequest_value || null;
  let created = false;
  if (!honorariumRequestId) {
    assertHonorariumDiscriminatorsConfigured();
    const amount = await getAmount(); // throws on unavailable/malformed → caller alerts + skips
    honorariumRequestId = deriveGuid(suggestionId);

    // akoya_fiscalyear is a plain, sync-stamped string — no plugin derives it on a
    // bare create — and it comes from the PARENT proposal's meeting date. That date
    // also fills wmkf_meetingdate, so a proposal with no meeting date can't yield a
    // well-formed honorarium: guard + throw (caller alerts, accept still succeeds)
    // rather than write a malformed row. Strategy doc §5.
    const meetingDate = request?.wmkf_meetingdate || null;
    if (!meetingDate) {
      const e = new Error('cannot create honorarium: parent request has no wmkf_meetingdate (needed to derive akoya_fiscalyear)');
      e.code = 'honorarium_no_meeting_date';
      throw e;
    }

    const createBody = {
      akoya_requestid: honorariumRequestId,
      // Navigation-property names are case-sensitive: akoya_programid /
      // akoya_primarycontactid are lowercase (wmkf_GrantProgram / wmkf_Type are
      // PascalCase). Verified against live Dataverse — the prior PascalCase
      // akoya_ProgramId / akoya_PrimaryContactId was rejected 400. Strategy doc §4.
      'akoya_programid@odata.bind': `/akoya_programs(${HONORARIUM_PROGRAM_ID})`,
      'wmkf_GrantProgram@odata.bind': `/wmkf_grantprograms(${HONORARIUM_GRANTPROGRAM_ID})`,
      'wmkf_Type@odata.bind': `/wmkf_types(${HONORARIUM_TYPE_ID})`,
      'akoya_primarycontactid@odata.bind': `/contacts(${contactId})`,
      // Native Akoya request-type — auto-defaults to the WRONG value; must set (§3a).
      akoya_requesttype: HONORARIUM_AKOYA_REQUEST_TYPE_SCHOLARSHIP,
      wmkf_request_type: HONORARIUM_REQUEST_TYPE_INDIVIDUAL,
      // The GoApply cohort stamps the amount on all three money fields.
      akoya_recommendedamount: amount,
      akoya_request: amount,
      wmkf_invitedamount: amount,
      wmkf_meetingdate: meetingDate,
      akoya_fiscalyear: deriveHonorariumFiscalYear(meetingDate),
      // GoApply rows leave these off; a bare create auto-defaults them true, which
      // would switch on reviewer reminders against the honorarium record. Force off.
      wmkf_respondreminderenabled: false,
      wmkf_reviewduereminderenabled: false,
      // Proposal-referencing title (Option C) — otherwise a plugin denormalizes the
      // reviewer's name as "Grant to <name>". Strategy doc §8.
      akoya_title: deriveHonorariumTitle(request),
      // Bind currency explicitly only when configured; otherwise Dataverse applies the
      // org default (USD for this org). Strategy doc §3a.
      ...(HONORARIUM_CURRENCY_ID
        ? { 'transactioncurrencyid@odata.bind': `/transactioncurrencies(${HONORARIUM_CURRENCY_ID})` }
        : {}),
      // TODO(strategy doc §8/§9): APPROVED 2026-07-02 — Connor is creating the
      // honorarium→proposal self-lookup (proposed wmkf_relatedproposal,
      // akoya_request → akoya_request). Bind the Referencing (N:1) nav property here
      // so app-created honoraria populate the FK for Connor's AkoyaGO dashboard.
      // CONFIRM the exact nav-property name/casing from live metadata FIRST (§4 casing
      // hazard, 0x80060888 on wrong casing) — do not guess from the schema name:
      //   '<navprop>@odata.bind': `/akoya_requests(${request.akoya_requestid})`,
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

async function ensureContact({ reviewer, body, contacts, potentialReviewers, actingUserSystemId, notify }) {
  const existing = reviewer?._wmkf_contact_value || null;
  if (existing) return existing;

  const email = (body.contactEdits?.email || reviewer?.wmkf_emailaddress || '').trim();
  const orcid = (body.contactEdits?.orcid || reviewer?.wmkf_orcid || '').trim();
  if (!email) {
    const e = new Error('cannot create honorarium contact: no email on reviewer or contactEdits');
    e.code = 'honorarium_no_email';
    throw e;
  }
  const firstName = body.contactEdits?.firstName || reviewer?.wmkf_firstname || null;
  const lastName = body.contactEdits?.lastName || reviewer?.wmkf_lastname || null;

  // (a) Exact email match wins.
  const byEmail = await contacts.findByEmail(email);
  if (byEmail?.contactid) {
    if (orcid) {
      try {
        const orcidMatch = await contacts.findByOrcidCandidates(orcid);
        if (orcidMatch?.one && orcidMatch.id && orcidMatch.id !== byEmail.contactid) {
          try {
            await notify({
              type: 'contact_orcid_email_split',
              severity: 'warning',
              title: 'Reviewer email and ORCID match different CRM contacts',
              message: `Reviewer payment email ${email} matched CRM contact ${byEmail.contactid}, but ORCID ${orcid} uniquely matched CRM contact ${orcidMatch.id}. The honorarium proceeded using the email-matched contact; staff should reconcile the split.`,
              metadata: {
                orcid,
                correctedEmail: email,
                emailContactId: byEmail.contactid,
                orcidContactId: orcidMatch.id,
                potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
                reviewerName: reviewer?.wmkf_name || null,
                decision: 'linked_email_contact',
              },
              source: 'honorarium-orchestrator',
              category: 'reviewers',
              autoResolveKey: `contact-orcid-email-split:${reviewer?.wmkf_potentialreviewersid || orcid}`,
            });
          } catch (notifyErr) {
            console.warn('[honorarium-orchestrator] contact ORCID/email split alert failed (non-fatal):', notifyErr?.message || notifyErr);
          }
        }
      } catch (err) {
        console.warn('[honorarium-orchestrator] ORCID contact split lookup failed (non-fatal, using email match):', err?.message || err);
      }
    }
    return linkPotentialReviewer({ potentialReviewers, reviewer, contactId: byEmail.contactid, actingUserSystemId });
  }

  // (b) Email missed. Before minting a NEW contact, fall back to the reviewer's
  // ORCID: a corrected/secondary email that doesn't match contacts.emailaddress1
  // would otherwise spawn a DUPLICATE of an existing CRM contact
  // (REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS finding #4). Fail-open — any lookup
  // error falls through to create so the honorarium never stalls on it.
  if (orcid) {
    let orcidMatch = null;
    try {
      orcidMatch = await contacts.findByOrcidCandidates(orcid);
    } catch (err) {
      console.warn('[honorarium-orchestrator] ORCID contact lookup failed (non-fatal, will create):', err?.message || err);
    }
    if (orcidMatch?.one && orcidMatch.id) {
      // Unique ORCID match → link to the existing contact instead of duplicating.
      return linkPotentialReviewer({ potentialReviewers, reviewer, contactId: orcidMatch.id, actingUserSystemId });
    }
    if (orcidMatch?.ambiguous) {
      // ORCID matches multiple contacts → can't safely auto-link. Fail open: create
      // a new contact so the payment proceeds, but flag the likely duplicate for
      // staff to reconcile (owner decision: create + flag, never block). The flag is
      // BOTH a server log AND a durable `system_alerts` row (warning severity), so it
      // surfaces on the /admin alerts dashboard instead of living only in logs
      // (REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS, "flag for staff").
      console.warn(
        `[honorarium-orchestrator] contactDuplicateRisk: reviewer ORCID ${orcid} matches ${orcidMatch.count} CRM contacts but corrected email ${email} matched none — creating a NEW contact; STAFF REVIEW to dedup. potentialReviewer=${reviewer?.wmkf_potentialreviewersid || 'n/a'}`
      );
      // Durable, staff-visible surface. Best-effort: a notify/DB failure must never
      // abort the honorarium (same fail-open posture as the ORCID lookup above).
      // autoResolveKey dedups to one active alert per reviewer so retries / repeat
      // accepts don't spawn a pile of identical "go dedup" alerts.
      try {
        await notify({
          type: 'contact_duplicate_risk',
          severity: 'warning',
          title: 'Possible duplicate CRM contact (reviewer honorarium)',
          message:
            `Reviewer ORCID ${orcid} matches ${orcidMatch.count} CRM contacts, but the corrected ` +
            `email ${email} matched none — a NEW contact was created so the honorarium could ` +
            `proceed. Staff: reconcile the likely duplicate.`,
          metadata: {
            orcid,
            correctedEmail: email,
            matchedContactCount: orcidMatch.count,
            potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
          },
          source: 'honorarium-orchestrator',
          category: 'reviewers',
          autoResolveKey: `contact-dup-risk:${reviewer?.wmkf_potentialreviewersid || orcid}`,
        });
      } catch (notifyErr) {
        console.warn(
          '[honorarium-orchestrator] contactDuplicateRisk alert failed (non-fatal):',
          notifyErr?.message || notifyErr
        );
      }
    }
  }

  // (c) No email match and no unique ORCID match → genuine new contact.
  const { id } = await contacts.findOrCreateByEmail({ firstName, lastName, email }, { actingUserSystemId });
  return linkPotentialReviewer({ potentialReviewers, reviewer, contactId: id, actingUserSystemId });
}

// Link the potentialreviewer → contact and return the contactId the honorarium
// should actually bind to. Non-fatal: a link-write failure never aborts onboarding.
//
// Concurrency guard (Codex diff review): `setContactLink` re-reads the LIVE
// potentialreviewer row, not the (possibly stale) `reviewer` object ensureContact
// snapshotted. If a concurrent promotion linked this reviewer to a DIFFERENT contact
// in the meantime, it throws `reviewer_linked_elsewhere` with the existing link —
// that live link is authoritative, so we bind the honorarium to it rather than to
// the contact we just picked (avoids contact-binding ↔ persisted-link divergence).
async function linkPotentialReviewer({ potentialReviewers, reviewer, contactId, actingUserSystemId }) {
  const chosen = contactId;
  if (!reviewer?.wmkf_potentialreviewersid) return chosen;
  try {
    await potentialReviewers.setContactLink(reviewer.wmkf_potentialreviewersid, chosen, { actingUserSystemId });
  } catch (err) {
    if (err?.code === 'reviewer_linked_elsewhere' && err?.details?.existingContactId) {
      console.warn(
        `[honorarium-orchestrator] potentialReviewer ${reviewer.wmkf_potentialreviewersid} already linked to contact ${err.details.existingContactId} (chose ${chosen}); using the existing live link for the honorarium.`
      );
      return err.details.existingContactId;
    }
    console.warn('[honorarium-orchestrator] setContactLink failed (non-fatal):', err?.message || err);
  }
  return chosen;
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
    phone: 'address1_telephone1',
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
  // Collapse internal whitespace too — a trailing space on `first` would leave a
  // double space mid-name ("Test  Case") that the end-trim above can't catch. The
  // BILL vendor record / network search should see a clean display name.
  return ContactParser.normalizeDisplayName(composed || reviewer?.wmkf_name) || 'Unknown Reviewer';
}

function resolveEmail(reviewer, body) {
  return (body.contactEdits?.email || reviewer?.wmkf_emailaddress || '').trim() || undefined;
}

function resolvePhone(reviewer, body) {
  // Phone is collected in the payment-address card (body.address.phone), persisted
  // to contact.address1_telephone1, and — when BILL is enabled — carried on the
  // vendor payload as reviewerPhone.
  return (body.address?.phone || reviewer?.wmkf_phone || '').trim() || undefined;
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

const FISCAL_YEAR_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * akoya_fiscalyear = "<MonthName> <FullYear>" of the parent proposal's meeting date
 * (observed months are June / December, but any month renders correctly). Dataverse
 * date-only values are UTC-midnight, so read UTC parts to avoid a timezone off-by-one
 * near month boundaries. Exported for unit tests. Strategy doc §5.
 */
export function deriveHonorariumFiscalYear(meetingDate) {
  const d = new Date(meetingDate);
  if (Number.isNaN(d.getTime())) {
    const e = new Error(`cannot derive akoya_fiscalyear: unparseable meeting date '${meetingDate}'`);
    e.code = 'honorarium_bad_meeting_date';
    throw e;
  }
  return `${FISCAL_YEAR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Proposal-referencing honorarium title (Option C, strategy doc §8). Prefers the
// proposal's own title, appends its request number for staff, and caps length so a
// long proposal title can't exceed the akoya_title column.
function deriveHonorariumTitle(request) {
  const proposalTitle = (request?.akoya_title || '').trim();
  const num = request?.akoya_requestnum ? `#${request.akoya_requestnum}` : '';
  const ref = proposalTitle || 'proposal';
  const title = `Reviewer honorarium — ${ref}${num ? ` (${num})` : ''}`;
  return title.length > 200 ? `${title.slice(0, 199)}…` : title;
}
