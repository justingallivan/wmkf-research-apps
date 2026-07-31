/**
 * Honorarium onboarding orchestrator — the chunk-4 post-accept step.
 *
 * Runs after a reviewer accepts (Stage 2a) and has NOT opted out of the
 * honorarium. Accepted-contact promotion itself is exported separately so
 * opt-out acceptances use the same identity-aware path without entering the
 * payment workflow.
 *
 *   1. Ensure a CRM contact (identity-aware promote-on-accept).
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
 * The acceptance drain treats ANY throw from here as follow-up failure, not a
 * rollback of the accepted suggestion. Retryable failures are retried and
 * deterministic identity conflicts remain terminal for staff review.
 *
 * Design: docs/BILL_CHUNK_4_DESIGN.md "Thread 1".
 */

import { v5 as uuidv5 } from 'uuid';
import * as contactAdapter from '../dataverse/adapters/contact.js';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import { runChangeset } from '../dataverse/core/changeset.js';
import { ContactParser } from '../utils/contact-parser.js';
import { normalizeOrcid } from '../utils/orcid-normalize.js';
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
// Stable function of accepted identity: valid ORCID across reviewer rows, with
// potentialReviewer id as the fallback when no valid ORCID exists. DO NOT change
// after release: retries and concurrent acceptance jobs depend on deriving the
// same Contact primary key.
const ACCEPTED_REVIEWER_CONTACT_GUID_NAMESPACE = '17834a61-9e55-5ce6-a0df-f08b53a73dd1';

export async function ensureHonorariumOnboarding({ suggestion, request, reviewer, body, actingUserSystemId }, deps = {}) {
  const {
    requests = grantRequestAdapter,
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

  // ── 1. Ensure the accepted-reviewer contact and capture first-party data ──
  const { contactId, addressCaptureError } = await ensureAcceptedReviewerContact(
    { reviewer, suggestion, body, actingUserSystemId },
    {
      contacts,
      potentialReviewers,
      backProp,
      notify,
      deriveContactGuid: deps.deriveContactGuid,
      claimNewContact: deps.claimNewContact,
    },
  );

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
      // Structured honorarium→proposal link (strategy doc §8/§9). Self-lookup
      // wmkf_reviewedproposal created on akoya_request 2026-07-02; the Referencing
      // nav property `wmkf_ReviewedProposal` is the authoritative name read back from
      // the relationship metadata and confirmed by a read-only $expand (200) — do NOT
      // re-case it without re-checking (§4 hazard, 0x80060888). Populates the FK so
      // app-created honoraria feed Connor's AkoyaGO dashboard. Bound only when the
      // parent proposal id is present.
      ...(request?.akoya_requestid
        ? { 'wmkf_ReviewedProposal@odata.bind': `/akoya_requests(${request.akoya_requestid})` }
        : {}),
    };

    try {
      await requests.create(createBody);
      created = true;
    } catch (err) {
      // Deterministic GUID → a retry of an already-succeeded create lands here.
      // Confirm the row exists before swallowing; a genuine create failure rethrows.
      const found = await requests
        .getById(honorariumRequestId, { select: 'akoya_requestid' })
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
    reviewerName: resolveName(reviewer, body, suggestion),
    reviewerEmail: resolveEmail(reviewer, body, suggestion),
    ...(resolvePhone(reviewer, body) ? { reviewerPhone: resolvePhone(reviewer, body) } : {}),
    address: toOnboardAddress(body.address),
  });

  return {
    honorariumRequestId,
    contactId,
    created,
    onboardStatus: onboardResult?.status || null,
    addressCaptureError,
  };
}

// ─────────────────────────── helpers ───────────────────────────

export async function ensureAcceptedReviewerContact(
  { reviewer, suggestion = {}, body = {}, actingUserSystemId },
  deps = {},
) {
  const {
    contacts = contactAdapter,
    potentialReviewers = potentialReviewerAdapter,
    backProp = backPropReviewerOrcidToContact,
    notify = (opts) => NotificationService.notify(opts),
    deriveContactGuid = (identityKey) => uuidv5(identityKey, ACCEPTED_REVIEWER_CONTACT_GUID_NAMESPACE),
    claimNewContact = claimNewAcceptedReviewerContact,
  } = deps;

  const contactId = await ensureContact({
    reviewer,
    suggestion,
    body,
    contacts,
    potentialReviewers,
    actingUserSystemId,
    notify,
    deriveContactGuid,
    claimNewContact,
  });

  // First-party acceptance is the contact promotion boundary. Contact mutation
  // starts only after the link has passed identity validation.
  const backpropResult = await backProp({ reviewer, contactId, actingUserSystemId });
  if (backpropResult?.action === 'conflict' || backpropResult?.action === 'malformed') {
    await raiseAcceptedContactReview({
      notify,
      reviewer,
      email: resolveEmail(reviewer, body, suggestion),
      orcid: resolveOrcid(reviewer, body),
      reason: `contact_orcid_${backpropResult.action}`,
      details: {
        contactId,
        existing: backpropResult.existing || null,
        incoming: backpropResult.incoming || null,
      },
    });
  }

  // Address capture is also best-effort. Callers receive the error explicitly
  // so capture-only and opt-out acceptance jobs can retry/report it.
  let addressCaptureError = null;
  try {
    await patchContactAddress(contacts, contactId, body.address);
  } catch (addrErr) {
    addressCaptureError = addrErr?.message || String(addrErr);
    console.warn('[honorarium-orchestrator] contact address PATCH failed (non-fatal):', addressCaptureError);
  }

  return { contactId, addressCaptureError };
}

function acceptedContactError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.retryable = false;
  err.details = details;
  return err;
}

function contactDisplayName(row) {
  return row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ');
}

function contactNameMatches(reviewerName, contact) {
  const left = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(reviewerName || ''));
  const right = ContactParser.normalizeNameForMatch(
    ContactParser.stripHonorifics(contactDisplayName(contact) || ''),
  );
  return !!left && !!right && ContactParser.namesMatch(left, right);
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const clean = String(value).trim();
    if (clean) return clean;
  }
  return '';
}

function resolveContactNameParts(reviewer, body, suggestion = {}) {
  let firstName = firstNonBlank(
    body.contactEdits?.firstName,
    suggestion.wmkf_reviewerfirstname,
    reviewer?.wmkf_firstname,
  );
  let lastName = firstNonBlank(
    body.contactEdits?.lastName,
    suggestion.wmkf_reviewerlastname,
    reviewer?.wmkf_lastname,
  );
  const displayName = ContactParser.normalizeDisplayName(
    ContactParser.stripHonorifics(reviewer?.wmkf_name || ''),
  );

  if ((!firstName || !lastName) && displayName) {
    const parts = displayName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      if (!lastName) lastName = parts[0];
      if (firstName.toLowerCase() === lastName.toLowerCase()) firstName = '';
    } else {
      if (!firstName) firstName = parts[0];
      if (!lastName) lastName = parts.slice(1).join(' ');
    }
  }

  // Dataverse Contact requires lastname. A one-token reviewer name belongs in
  // lastname; this is preferable to an opaque platform validation failure.
  if (!lastName) {
    lastName = firstName || displayName || 'Unknown Reviewer';
    if (firstName.toLowerCase() === lastName.toLowerCase()) firstName = '';
  }
  return { firstName: firstName || null, lastName };
}

async function alertAcceptedContactReview({ notify, reviewer, email, orcid, reason, details }) {
  try {
    await notify({
      type: 'accepted_reviewer_contact_identity_review',
      severity: 'warning',
      emailAdmins: true,
      title: 'Accepted reviewer needs CRM contact identity review',
      message: `Accepted reviewer "${reviewer?.wmkf_name || email}" was not linked to a CRM contact because identity matching returned ${reason}.`,
      metadata: {
        potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
        reviewerName: reviewer?.wmkf_name || null,
        email,
        orcid: orcid || null,
        reason,
        details,
        policyDecision: 'accept_unlinked_staff_review',
      },
      source: 'reviewer-acceptance-drain',
      category: 'reviewers',
      autoResolveKey: `accepted-reviewer-contact:${reviewer?.wmkf_potentialreviewersid || email}`,
    });
    return true;
  } catch (notifyErr) {
    console.warn('[honorarium-orchestrator] accepted-contact review alert failed (non-fatal):', notifyErr?.message || notifyErr);
    return false;
  }
}

async function raiseAcceptedContactReview(args) {
  const alerted = await alertAcceptedContactReview(args);
  const err = acceptedContactError(
    'accepted_reviewer_contact_identity_review_required',
    `accepted reviewer contact requires staff identity review: ${args.reason}`,
    { reason: args.reason, ...(args.details || {}) },
  );
  err.staffAlerted = alerted;
  throw err;
}

function normalizeEmailForMatch(value) {
  return String(value || '').trim().toLowerCase();
}

function contactIdentityProblem(contact, {
  reviewerName,
  alternateReviewerNames = [],
  email,
  alternateEmails = [],
  orcid,
  allowDeterministicClaim = false,
} = {}) {
  if (!contact) return { reason: 'linked_contact_missing', details: {} };
  if (contact.statecode !== undefined && Number(contact.statecode) !== 0) {
    return {
      reason: 'inactive_contact_match',
      details: { contactId: contact.contactid, statecode: contact.statecode },
    };
  }
  const candidateNames = [reviewerName, ...alternateReviewerNames].filter(Boolean);
  if (!candidateNames.some((name) => contactNameMatches(name, contact))) {
    return {
      reason: 'contact_name_mismatch',
      details: {
        contactId: contact.contactid,
        reviewerName,
        alternateReviewerNames,
        contactName: contactDisplayName(contact) || null,
      },
    };
  }

  const incomingOrcid = normalizeOrcid(orcid);
  const storedOrcid = normalizeOrcid(contact.wmkf_orcid);
  if (incomingOrcid.state === 'valid'
      && storedOrcid.state === 'valid'
      && incomingOrcid.id !== storedOrcid.id) {
    return {
      reason: 'contact_orcid_conflict',
      details: {
        contactId: contact.contactid,
        reviewerOrcid: incomingOrcid.id,
        contactOrcid: storedOrcid.id,
      },
    };
  }

  const incomingEmails = [email, ...alternateEmails]
    .map(normalizeEmailForMatch)
    .filter(Boolean);
  const storedEmail = normalizeEmailForMatch(contact.emailaddress1);
  const emailMatches = !!storedEmail && incomingEmails.includes(storedEmail);
  const orcidMatches = incomingOrcid.state === 'valid'
    && storedOrcid.state === 'valid'
    && incomingOrcid.id === storedOrcid.id;
  if (!emailMatches && !orcidMatches && !allowDeterministicClaim) {
    return {
      reason: 'linked_contact_identity_unconfirmed',
      details: {
        contactId: contact.contactid,
        reviewerEmail: email || null,
        alternateReviewerEmails: alternateEmails,
        contactEmail: contact.emailaddress1 || null,
        reviewerOrcid: incomingOrcid.state === 'valid' ? incomingOrcid.id : null,
        contactOrcid: storedOrcid.state === 'valid' ? storedOrcid.id : null,
      },
    };
  }
  return null;
}

async function validateLinkedContact({
  contacts,
  reviewer,
  contactId,
  reviewerName,
  email,
  orcid,
  notify,
  allowDeterministicClaim = false,
}) {
  const contact = await contacts.getById(contactId);
  const problem = contactIdentityProblem(contact, {
    reviewerName,
    alternateReviewerNames: [reviewer?.wmkf_name],
    email,
    alternateEmails: [reviewer?.wmkf_emailaddress],
    orcid,
    allowDeterministicClaim,
  });
  if (problem) {
    await raiseAcceptedContactReview({
      notify,
      reviewer,
      email,
      orcid,
      reason: problem.reason,
      details: problem.details,
    });
  }
  return contactId;
}

async function ensureContact({
  reviewer,
  suggestion,
  body,
  contacts,
  potentialReviewers,
  actingUserSystemId,
  notify,
  deriveContactGuid,
  claimNewContact,
}) {
  const reviewerId = reviewer?.wmkf_potentialreviewersid || null;
  if (!reviewerId) {
    throw acceptedContactError(
      'accepted_reviewer_contact_no_reviewer_id',
      'cannot promote accepted reviewer: potential reviewer id missing',
      {},
    );
  }
  const email = resolveEmail(reviewer, body, suggestion);
  const orcid = resolveOrcid(reviewer, body);
  const { firstName, lastName } = resolveContactNameParts(reviewer, body, suggestion);
  const reviewerName = ContactParser.normalizeDisplayName(
    [firstName, lastName].filter(Boolean).join(' '),
  );
  const existing = reviewer?._wmkf_contact_value || null;
  if (existing) {
    return validateLinkedContact({
      contacts,
      reviewer,
      contactId: existing,
      reviewerName,
      email,
      orcid,
      notify,
    });
  }

  // Resolve both exact keys before choosing a contact. Ambiguity, a split
  // ORCID/email result, or a name mismatch preserves the unlinked state and
  // creates a staff-visible review item instead of guessing.
  const [emailMatch, orcidMatch] = await Promise.all([
    email ? contacts.findByEmailCandidates(email) : Promise.resolve({ none: true }),
    orcid ? contacts.findByOrcidCandidates(orcid) : Promise.resolve({ none: true }),
  ]);
  let reason = null;
  let details = null;
  if (emailMatch?.inactiveOnly || orcidMatch?.inactiveOnly) {
    reason = 'inactive_contact_match';
    details = {
      emailMatches: emailMatch?.count || 0,
      orcidMatches: orcidMatch?.count || 0,
    };
  } else if (emailMatch?.ambiguous || orcidMatch?.ambiguous) {
    reason = 'ambiguous_contact_match';
    details = {
      emailMatches: emailMatch?.count || 0,
      orcidMatches: orcidMatch?.count || 0,
    };
  } else if (
    emailMatch?.one
    && orcidMatch?.one
    && String(emailMatch.id).toLowerCase() !== String(orcidMatch.id).toLowerCase()
  ) {
    reason = 'orcid_email_split';
    details = { emailContactId: emailMatch.id, orcidContactId: orcidMatch.id };
  }

  const matched = reason ? null : (orcidMatch?.one ? orcidMatch : (emailMatch?.one ? emailMatch : null));
  if (!reason && matched?.row) {
    const problem = contactIdentityProblem(matched.row, { reviewerName, email, orcid });
    if (problem) {
      reason = problem.reason;
      details = problem.details;
    }
  }

  if (reason) {
    await raiseAcceptedContactReview({ notify, reviewer, email, orcid, reason, details });
  }

  if (matched?.id) {
    return linkPotentialReviewer({
      contacts,
      potentialReviewers,
      reviewer,
      contactId: matched.id,
      actingUserSystemId,
      reviewerName,
      email,
      orcid,
      notify,
    });
  }

  if (!email) {
    throw acceptedContactError(
      'accepted_reviewer_contact_no_email',
      'cannot create accepted reviewer contact: no engagement or reviewer email',
      { potentialReviewerId: reviewerId },
    );
  }

  // Valid accepted ORCID is the cross-reviewer identity key; otherwise the
  // potentialReviewer id scopes idempotency to one person row. The prefixes are
  // part of the durable UUID contract.
  const normalizedOrcid = normalizeOrcid(orcid);
  const identityKey = normalizedOrcid.state === 'valid'
    ? `orcid:${normalizedOrcid.id}`
    : `reviewer:${String(reviewerId).replace(/[{}]/g, '').toLowerCase()}`;
  const contactId = deriveContactGuid(identityKey);
  return claimNewContact({
    reviewer,
    contactId,
    firstName,
    lastName,
    email,
    orcid,
    reviewerName,
    contacts,
    potentialReviewers,
    actingUserSystemId,
    notify,
  });
}

export async function claimNewAcceptedReviewerContact(args, deps = {}) {
  const {
    reviewer,
    contactId,
    firstName,
    lastName,
    email,
    orcid,
    reviewerName,
    contacts = contactAdapter,
    potentialReviewers = potentialReviewerAdapter,
    actingUserSystemId,
    notify = (opts) => NotificationService.notify(opts),
  } = args;
  const runAtomic = deps.runAtomic || runChangeset;
  const reviewerId = reviewer.wmkf_potentialreviewersid;
  const current = await potentialReviewers.getById(reviewerId);
  if (!current) {
    throw acceptedContactError(
      'accepted_reviewer_contact_no_reviewer',
      'cannot claim accepted reviewer contact: reviewer no longer exists',
      { potentialReviewerId: reviewerId },
    );
  }
  if (current._wmkf_contact_value) {
    return validateLinkedContact({
      contacts,
      reviewer,
      contactId: current._wmkf_contact_value,
      reviewerName,
      email,
      orcid,
      notify,
    });
  }
  if (!current._etag) {
    const err = new Error('accepted reviewer contact claim requires a current reviewer ETag');
    err.code = 'accepted_reviewer_contact_etag_missing';
    throw err;
  }

  const contactPayload = contacts.acceptedReviewerContactPayload({
    contactId,
    firstName,
    lastName,
    email,
  });
  try {
    await runAtomic([
      { method: 'POST', entitySet: 'contacts', body: contactPayload },
      {
        method: 'PATCH',
        entitySet: 'wmkf_potentialreviewerses',
        key: reviewerId,
        body: { 'wmkf_Contact@odata.bind': `/contacts(${contactId})` },
        ifMatch: current._etag,
      },
    ], { actingUserSystemId });
    return contactId;
  } catch (claimError) {
    // A dropped response or a competing deterministic claim can make the batch
    // throw after another writer established durable state. Reconcile by exact
    // IDs; never infer success from the original error alone.
    const [afterReviewer, afterContact] = await Promise.all([
      potentialReviewers.getById(reviewerId).catch(() => null),
      contacts.getById(contactId).catch(() => null),
    ]);
    if (afterReviewer?._wmkf_contact_value) {
      if (String(afterReviewer._wmkf_contact_value).toLowerCase() === String(contactId).toLowerCase()) {
        if (!afterContact) throw claimError;
        return validateLinkedContact({
          contacts,
          reviewer,
          contactId,
          reviewerName,
          email,
          orcid,
          notify,
          allowDeterministicClaim: true,
        });
      }
      return validateLinkedContact({
        contacts,
        reviewer,
        contactId: afterReviewer._wmkf_contact_value,
        reviewerName,
        email,
        orcid,
        notify,
      });
    }
    if (!afterContact) throw claimError;
    const problem = contactIdentityProblem(afterContact, {
      reviewerName,
      email,
      orcid,
      allowDeterministicClaim: true,
    });
    if (problem) {
      await raiseAcceptedContactReview({
        notify,
        reviewer,
        email,
        orcid,
        reason: problem.reason,
        details: problem.details,
      });
    }
    return linkPotentialReviewer({
      contacts,
      potentialReviewers,
      reviewer,
      contactId,
      actingUserSystemId,
      reviewerName,
      email,
      orcid,
      notify,
    });
  }
}

// Link with an ETag-guarded adapter write. A competing link can be adopted only
// after the winner's Contact passes the same identity checks as every other
// accepted-contact path.
async function linkPotentialReviewer({
  contacts,
  potentialReviewers,
  reviewer,
  contactId,
  actingUserSystemId,
  reviewerName,
  email,
  orcid,
  notify,
}) {
  const chosen = contactId;
  try {
    await potentialReviewers.setContactLink(reviewer.wmkf_potentialreviewersid, chosen, { actingUserSystemId });
  } catch (err) {
    if (err?.code === 'reviewer_linked_elsewhere' && err?.details?.existingContactId) {
      return validateLinkedContact({
        contacts,
        reviewer,
        contactId: err.details.existingContactId,
        reviewerName,
        email,
        orcid,
        notify,
      });
    }
    if (err?.code === 'contact_linked_elsewhere') {
      await raiseAcceptedContactReview({
        notify,
        reviewer,
        email,
        orcid,
        reason: 'contact_linked_elsewhere',
        details: { contactId: chosen, ...(err.details || {}) },
      });
    }

    // The adapter's pre-read can race with another writer after its checks.
    // Reconcile durable state after any unclassified failure (notably 412 or a
    // reverse-link uniqueness collision) before deciding whether to retry.
    const [currentReviewer, currentOwner] = await Promise.all([
      typeof potentialReviewers.getById === 'function'
        ? potentialReviewers.getById(reviewer.wmkf_potentialreviewersid).catch(() => null)
        : Promise.resolve(null),
      typeof potentialReviewers.findByContactId === 'function'
        ? potentialReviewers.findByContactId(chosen).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (currentReviewer?._wmkf_contact_value) {
      return validateLinkedContact({
        contacts,
        reviewer,
        contactId: currentReviewer._wmkf_contact_value,
        reviewerName,
        email,
        orcid,
        notify,
      });
    }
    if (
      currentOwner?.wmkf_potentialreviewersid
      && String(currentOwner.wmkf_potentialreviewersid).toLowerCase()
        !== String(reviewer.wmkf_potentialreviewersid).toLowerCase()
    ) {
      await raiseAcceptedContactReview({
        notify,
        reviewer,
        email,
        orcid,
        reason: 'contact_linked_elsewhere',
        details: {
          contactId: chosen,
          existingReviewerId: currentOwner.wmkf_potentialreviewersid,
          potentialReviewerId: reviewer.wmkf_potentialreviewersid,
        },
      });
    }
    throw err;
  }
  return chosen;
}

async function patchContactAddress(contacts, contactId, address) {
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
    await contacts.updateFields(contactId, payload);
  }
}

function resolveName(reviewer, body, suggestion = {}) {
  const { firstName, lastName } = resolveContactNameParts(reviewer, body, suggestion);
  return ContactParser.normalizeDisplayName(
    [firstName, lastName].filter(Boolean).join(' '),
  ) || 'Unknown Reviewer';
}

function resolveEmail(reviewer, body, suggestion = {}) {
  return firstNonBlank(
    body.contactEdits?.email,
    suggestion.wmkf_revieweremail,
    reviewer?.wmkf_emailaddress,
  ) || undefined;
}

function resolveOrcid(reviewer, body) {
  return firstNonBlank(body.contactEdits?.orcid, reviewer?.wmkf_orcid) || undefined;
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
