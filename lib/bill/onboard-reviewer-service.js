/**
 * BILL onboarding orchestrator — pure logic for /api/bill/onboard-reviewer.
 *
 * Separates HTTP/auth concerns (in the route handler) from the business flow
 * so tests can drive the orchestrator with injected fakes.
 *
 * Flow (per docs/BILL_CHUNK_6_ENDPOINT_DESIGN.md + chunk-4 hardening in
 * docs/BILL_CHUNK_4_DESIGN.md "Thread 3"):
 *
 *   0. If BILL_ONBOARDING_DEFERRED === 'true' → no BILL call, NO alert, return
 *      status: 'deferred' (leadership deferred automated onboarding this cycle;
 *      honorarium + address still captured upstream, payment handled manually).
 *   1. If BILL_ENABLED !== 'true' → alert + return status: 'alert_only'.
 *   2. RESERVE bill_onboarding_state (honorarium_request_id) BEFORE any BILL
 *      side effect. A concurrent second caller loses the PK race → 'in_progress'
 *      short-circuit, never reaching BILL (closes the concurrent duplicate-vendor
 *      window; Codex pre-impl P2).
 *   3. Idempotency pre-read: staged vendor_id first, then contact.wmkf_billcomid.
 *   4. If neither: createBillVendor → PERSIST vendor_id to staging IMMEDIATELY
 *      (before the contact PATCH, so a failed contact PATCH can't lose it →
 *      no duplicate vendor on retry; S198 P1 #1/#2) → PATCH contact
 *      wmkf_billcomid + akoya_isvendor (one retry).
 *   5. searchBillNetwork by name + zipOrPostalCode.
 *   6. exactMatchCount === 1: sendNetworkInvitation → PATCH akoya_request with
 *      PNI + "Yes" (retry+backoff). On persistent failure → mark dynamics_pending
 *      (pending_match=true, pending_pni) so the resume sweep completes it idempotently.
 *   7. exactMatchCount === 0/>=2: PATCH akoya_request "No" (retry+backoff). On
 *      persistent failure → mark dynamics_pending (pending_match=false). >=2 also
 *      emits a warning alert with a redacted result summary.
 *
 * BILL errors are caught per-phase: vendor_create / network_search / network_invite.
 * Dataverse PATCH failures are caught per-PATCH; contact-side gets one retry,
 * request-side now gets retry+backoff plus the durable torn-state marker.
 */

import {
  createBillVendor, searchBillNetwork, sendNetworkInvitation,
  BillAuthError, BillRateLimitError, BillServerError, BillError, BillValidationError,
} from './index.js';
import * as onboardingStateStore from './onboarding-state.js';
import { withDalContext } from '../dataverse/core/context.js';
import * as contactAdapter from '../dataverse/adapters/contact.js';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import NotificationService from '../services/notification-service.js';

import {
  BILLCOM_ACCOUNT_YES,
  BILLCOM_ACCOUNT_NO,
  assertOptionSetValuesConfigured,
} from './option-set-values.js';

const PHASE_VENDOR_CREATE = 'vendor_create';
const PHASE_NETWORK_SEARCH = 'network_search';
const PHASE_NETWORK_INVITE = 'network_invite';

// Request-side akoya_request PATCH: retry a transient Dynamics blip inline so
// most never become torn; a persistent failure falls through to the durable
// dynamics_pending marker + daily resume sweep (Fix #3).
const REQUEST_PATCH_ATTEMPTS = 3;
const REQUEST_PATCH_BACKOFF_MS = 500;

function defaultSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * Drive the BILL onboarding flow for a single honorarium.
 *
 * @param {Object} input — validated request body (see route handler)
 * @param {Object} [deps] — injectable for tests
 * @returns {Promise<Object>} response body shape per design doc
 */
export async function onboardReviewer(input, deps = {}) {
  const {
    contacts = contactAdapter,
    requests = grantRequestAdapter,
    notifications = NotificationService,
    billClient = { createBillVendor, searchBillNetwork, sendNetworkInvitation },
    onboardingState = onboardingStateStore,
    sleep = defaultSleep,
  } = deps;

  // BILL onboarding deferred for this grant cycle (leadership decision — automated
  // bill.com onboarding returns NEXT cycle). Distinct from 'alert_only' ("BILL not
  // wired yet, onboard by hand"): here there is no BILL onboarding at all this cycle,
  // so we skip the BILL call AND fire NO alert — payment is handled manually offline.
  // The honorarium akoya_request + mailing-address capture still run upstream
  // (orchestrator steps 2–3), so the payment record is intact. Re-enable next cycle:
  // unset BILL_ONBOARDING_DEFERRED, set BILL creds, flip BILL_ENABLED=true. No code
  // is removed — this is a reversible gate.
  if (process.env.BILL_ONBOARDING_DEFERRED === 'true') {
    return { ok: true, status: 'deferred' };
  }

  if (process.env.BILL_ENABLED !== 'true') {
    await notifyAlertOnly(notifications, input);
    return { ok: true, status: 'alert_only' };
  }

  assertOptionSetValuesConfigured();

  // Defensive input validation — the SAME gate the HTTP route applies, so the
  // in-process caller (respond.js → orchestrator → onboardReviewer) is a
  // contract-equivalent peer of POST /api/bill/onboard-reviewer rather than a
  // validation-bypassing shortcut (Codex post-impl P3). Runs after the
  // BILL_ENABLED check so the disabled-mode alert_only degrade still fires for
  // a reviewer whose address is incomplete (ops onboards manually).
  const inputError = validateOnboardInput(input);
  if (inputError) {
    await safeNotify(notifications, {
      type: 'bill_invalid_input',
      severity: 'error',
      title: 'BILL onboarding: invalid input (skipped)',
      message: inputError,
      metadata: {
        honorariumRequestId: input?.honorariumRequestId,
        reviewerContactId: input?.reviewerContactId,
      },
      source: 'bill/onboard-reviewer',
      category: 'spend',
    });
    return { ok: false, status: 'invalid_input', error: { code: 'invalid_input', message: inputError } };
  }

  let vendorId;
  let reusedExisting = false;
  const warnings = [];

  // ─── Reserve durable state BEFORE any BILL side effect ───
  // First caller wins; a concurrent caller short-circuits so we never create a
  // second BILL vendor for the same honorarium (Codex pre-impl P2).
  let reservation;
  try {
    reservation = await onboardingState.reserveOnboarding(input.honorariumRequestId, input.reviewerContactId);
  } catch (err) {
    // Can't dedup safely without the store → fail closed (never risk a dup vendor).
    return unhandled(notifications, err, input, PHASE_VENDOR_CREATE);
  }
  if (!reservation.reserved) {
    const stagedVendor = reservation.row?.vendor_id || null;
    if (!stagedVendor) {
      // Reserved by a concurrent — or abandoned — caller BEFORE a BILL vendor
      // was created. We can't safely create one now: an abandoned first caller
      // may have already created a vendor whose id we never persisted (→ dup
      // risk). Bail; if abandoned, the stuck-reconcile sweep surfaces it.
      return { ok: true, status: 'in_progress' };
    }
    // A PRIOR attempt created the vendor (id persisted) but didn't finish.
    // RESUME — but NEVER replay terminal BILL side effects (Codex stop-time:
    // re-running search+invite re-sends a network invitation the prior attempt
    // may already have fired). The vendor exists, so the only safe automatic
    // action is the IDEMPOTENT contact PATCH (the commonly-owed Dynamics write
    // after a torn first attempt). Torn akoya_request writebacks are owned by
    // the dynamics_pending resume sweep (which does NOT re-invite); an
    // onboarding whose invite never completed is left to the stuck reconcile
    // for manual ops (auto-re-invite risks a lost-response duplicate).
    const resumePatch = await patchContactBillcomId(contacts, input.reviewerContactId, stagedVendor);
    if (!resumePatch.ok) {
      await safeNotify(notifications, {
        type: 'bill_contact_patch_failed',
        severity: 'warning',
        title: 'BILL onboarding resume: contact PATCH failed',
        message: resumePatch.message,
        metadata: {
          honorariumRequestId: input.honorariumRequestId,
          reviewerContactId: input.reviewerContactId,
          vendorId: stagedVendor,
          fields: ['wmkf_billcomid', 'akoya_isvendor'],
        },
        source: 'bill/onboard-reviewer',
        category: 'spend',
      });
    }
    return {
      ok: true,
      status: 'resume_reconciled',
      vendorId: stagedVendor,
      ...(resumePatch.ok ? {} : { warnings: [`contact_patch_failed: ${resumePatch.message}`] }),
    };
  }

  // ─── Idempotency pre-read: staged vendor_id, then contact ───
  const stagedVendorId = reservation.row?.vendor_id || null;
  let contact;
  try {
    contact = await withDalContext('bill-onboard-pre-read', () =>
      contacts.getBillingFieldsById(input.reviewerContactId),
    );
  } catch (err) {
    await safeSetStatus(onboardingState, input.honorariumRequestId, 'bill_unavailable');
    return unhandled(notifications, err, input, PHASE_VENDOR_CREATE);
  }

  const existingVendorId = stagedVendorId || contact?.wmkf_billcomid || null;

  // ─── Phase: vendor_create ───
  if (existingVendorId) {
    vendorId = existingVendorId;
    reusedExisting = true;
  } else {
    try {
      const vendorResult = await billClient.createBillVendor({
        name: input.reviewerName,
        email: input.reviewerEmail,
        phone: input.reviewerPhone,
        address: input.address,
      });
      vendorId = vendorResult.vendorId;
    } catch (err) {
      await safeSetStatus(onboardingState, input.honorariumRequestId, 'bill_unavailable');
      return billFailure(notifications, err, input, PHASE_VENDOR_CREATE);
    }

    // Persist vendorId to the durable store IMMEDIATELY — before the contact
    // PATCH — so a failed contact PATCH can never lose it (S198 P1 #1/#2).
    await safeSetVendorId(onboardingState, input.honorariumRequestId, vendorId, warnings);

    // PATCH contact with the new vendorId + akoya_isvendor=true (Q1, Connor 2026-05-26).
    const contactPatchOutcome = await patchContactBillcomId(contacts, input.reviewerContactId, vendorId);
    if (!contactPatchOutcome.ok) {
      await safeNotify(notifications, {
        type: 'bill_contact_patch_failed',
        severity: 'error',
        title: `BILL onboarding: contact PATCH failed after vendor creation`,
        message: contactPatchOutcome.message,
        metadata: {
          honorariumRequestId: input.honorariumRequestId,
          reviewerContactId: input.reviewerContactId,
          vendorId,
          fields: ['wmkf_billcomid', 'akoya_isvendor'],
        },
        source: 'bill/onboard-reviewer',
        category: 'spend',
      }, warnings);
      warnings.push(`contact_patch_failed: ${contactPatchOutcome.message}`);
      // Continue — vendorId is durably staged, so a future invocation reuses it
      // (no dup vendor) and ops can write the contact field manually from the alert.
    }
  }

  // ─── Phase: network_search ───
  let searchResult;
  try {
    searchResult = await billClient.searchBillNetwork({
      name: input.reviewerName,
      zipOrPostalCode: input.address.zipOrPostalCode,
    });
  } catch (err) {
    await safeSetStatus(onboardingState, input.honorariumRequestId, 'bill_unavailable');
    return billFailure(notifications, err, input, PHASE_NETWORK_SEARCH, { vendorId });
  }

  const { exactMatchCount, pni, networkId, allResults } = searchResult;

  // ─── Phase: network_invite + final PATCH ───
  if (exactMatchCount === 1) {
    try {
      await billClient.sendNetworkInvitation(vendorId, networkId);
    } catch (err) {
      await safeSetStatus(onboardingState, input.honorariumRequestId, 'bill_unavailable');
      return billFailure(notifications, err, input, PHASE_NETWORK_INVITE, { vendorId, pni });
    }

    const patchOutcome = await patchAkoyaRequestSuccess(requests, input.honorariumRequestId, pni, sleep);
    if (!patchOutcome.ok) {
      // BILL side succeeded; the writeback is owed → durable torn-state marker.
      await safeMarkPending(onboardingState, input.honorariumRequestId, {
        pendingMatch: true, pendingPni: pni,
      }, warnings);
      await safeNotify(notifications, {
        type: 'bill_request_patch_failed',
        severity: 'warning',
        title: `BILL onboarding: honorarium request PATCH failed after successful invite (resume sweep will retry)`,
        message: patchOutcome.message,
        metadata: {
          honorariumRequestId: input.honorariumRequestId,
          vendorId,
          pni,
          fields: ['wmkf_paymentnetworkidpni', 'wmkf_exisitngbillcomaccount'],
        },
        source: 'bill/onboard-reviewer',
        category: 'spend',
      }, warnings);
      warnings.push(`request_patch_failed: ${patchOutcome.message}`);
      return {
        ok: true, status: 'partial',
        intendedStatus: reusedExisting ? 'reused_existing' : 'onboarded',
        vendorId, pni, exactMatchCount, warnings,
      };
    }

    const status = reusedExisting ? 'reused_existing' : 'onboarded';
    await safeSetStatus(onboardingState, input.honorariumRequestId, warnings.length ? 'partial' : status);
    return warnings.length
      ? { ok: true, status: 'partial', vendorId, pni, exactMatchCount, warnings }
      : { ok: true, status, vendorId, pni, exactMatchCount };
  }

  // exactMatchCount === 0 or >= 2: write "No", maybe alert
  const intendedStatus = exactMatchCount >= 2 ? 'ambiguous_match' : 'no_match';
  const patchOutcome = await patchAkoyaRequestNoMatch(requests, input.honorariumRequestId, sleep);
  let patchFailed = false;
  if (!patchOutcome.ok) {
    patchFailed = true;
    await safeMarkPending(onboardingState, input.honorariumRequestId, {
      pendingMatch: false, pendingPni: null,
    }, warnings);
    await safeNotify(notifications, {
      type: 'bill_request_patch_failed',
      severity: 'warning',
      title: `BILL onboarding: honorarium request PATCH failed (${intendedStatus} path; resume sweep will retry)`,
      message: patchOutcome.message,
      metadata: {
        honorariumRequestId: input.honorariumRequestId,
        vendorId,
        exactMatchCount,
        intendedStatus,
        fields: ['wmkf_exisitngbillcomaccount'],
      },
      source: 'bill/onboard-reviewer',
      category: 'spend',
    }, warnings);
    warnings.push(`request_patch_failed: ${patchOutcome.message}`);
  }

  if (exactMatchCount >= 2) {
    await safeNotify(notifications, {
      type: 'bill_ambiguous_match',
      severity: 'warning',
      emailAdmins: true,
      title: `BILL network search returned multiple matches for ${redactName(input.reviewerName)}`,
      message: `Ops needs to confirm which BILL Network member this reviewer maps to.`,
      metadata: {
        honorariumRequestId: input.honorariumRequestId,
        reviewerContactId: input.reviewerContactId,
        vendorId,
        exactMatchCount,
        results: summarizeNetworkResults(allResults),
      },
      source: 'bill/onboard-reviewer',
      category: 'spend',
    }, warnings);
  }

  if (patchFailed) {
    return {
      ok: true, status: 'partial', intendedStatus, vendorId, exactMatchCount, warnings,
    };
  }

  await safeSetStatus(onboardingState, input.honorariumRequestId, intendedStatus);
  return {
    ok: true, status: intendedStatus, vendorId, exactMatchCount,
    ...(warnings.length ? { warnings } : {}),
  };
}

// ─────────────────────────── Input validation ───────────────────────────

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isGuid(s) { return typeof s === 'string' && GUID_RE.test(s); }

/**
 * Validate the onboarding input shape. SINGLE SOURCE OF TRUTH shared by both
 * entry points:
 *   - pages/api/bill/onboard-reviewer.js (HTTP route → 400 + detail on failure)
 *   - onboardReviewer() above (in-process caller → 'invalid_input' status)
 * One definition is what makes the in-process call a contract peer of the HTTP
 * endpoint rather than a validation bypass (Codex post-impl P3). Returns an
 * error string, or null when valid.
 */
export function validateOnboardInput(input) {
  if (!input || typeof input !== 'object') return 'body must be an object';
  if (!isGuid(input.honorariumRequestId)) return 'honorariumRequestId must be a GUID';
  if (!isGuid(input.reviewerContactId)) return 'reviewerContactId must be a GUID';
  if (typeof input.reviewerName !== 'string' || input.reviewerName.trim().length < 1 || input.reviewerName.length > 100) {
    return 'reviewerName required (1-100 chars)';
  }
  if (input.reviewerEmail !== undefined && typeof input.reviewerEmail !== 'string') return 'reviewerEmail must be a string if provided';
  if (input.reviewerPhone !== undefined && typeof input.reviewerPhone !== 'string') return 'reviewerPhone must be a string if provided';
  const a = input.address;
  if (!a || typeof a !== 'object') return 'address required';
  if (typeof a.line1 !== 'string' || a.line1.length === 0) return 'address.line1 required';
  if (typeof a.city !== 'string' || a.city.length === 0) return 'address.city required';
  if (typeof a.zipOrPostalCode !== 'string' || a.zipOrPostalCode.length === 0) return 'address.zipOrPostalCode required';
  if (typeof a.country !== 'string' || a.country.length !== 2) return 'address.country must be ISO2';
  if (a.state !== undefined && typeof a.state !== 'string') return 'address.state must be a string if provided';
  return null;
}

// ─────────────────────────── Dataverse PATCH helpers ───────────────────────────

async function patchContactBillcomId(contacts, contactId, vendorId) {
  const body = {
    wmkf_billcomid: vendorId,
    akoya_isvendor: true,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await withDalContext('bill-onboard-contact-patch', () =>
        contacts.updateFields(contactId, body),
      );
      return { ok: true };
    } catch (err) {
      if (attempt === 0) continue;
      return { ok: false, message: err?.message || String(err) };
    }
  }
  return { ok: false, message: 'unreachable' };
}

async function patchAkoyaRequestSuccess(requests, requestId, pni, sleep) {
  const body = {
    wmkf_paymentnetworkidpni: pni,
    wmkf_exisitngbillcomaccount: BILLCOM_ACCOUNT_YES,
  };
  return patchAkoyaRequestWithRetry(requests, 'bill-onboard-request-patch-yes', requestId, body, sleep);
}

async function patchAkoyaRequestNoMatch(requests, requestId, sleep) {
  const body = {
    wmkf_exisitngbillcomaccount: BILLCOM_ACCOUNT_NO,
  };
  return patchAkoyaRequestWithRetry(requests, 'bill-onboard-request-patch-no', requestId, body, sleep);
}

/**
 * PATCH the honorarium akoya_request with a small inline retry+backoff so a
 * transient Dynamics blip self-heals without waiting for the daily resume
 * sweep. A persistent failure returns { ok:false } and the caller writes the
 * durable dynamics_pending marker (Fix #3).
 */
async function patchAkoyaRequestWithRetry(requests, context, requestId, body, sleep) {
  let lastMessage = 'unreachable';
  for (let attempt = 0; attempt < REQUEST_PATCH_ATTEMPTS; attempt++) {
    try {
      await withDalContext(context, () =>
        requests.updateById(requestId, body),
      );
      return { ok: true };
    } catch (err) {
      lastMessage = err?.message || String(err);
      if (attempt < REQUEST_PATCH_ATTEMPTS - 1) {
        await sleep(REQUEST_PATCH_BACKOFF_MS * Math.pow(2, attempt));
      }
    }
  }
  return { ok: false, message: lastMessage };
}

// ─────────────── Durable-state helpers (best-effort; never crash the flow) ───────────────

async function safeSetVendorId(onboardingState, honorariumRequestId, vendorId, warnings) {
  try {
    await onboardingState.setVendorId(honorariumRequestId, vendorId);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[bill-onboard-reviewer] setVendorId failed:', msg);
    if (Array.isArray(warnings)) warnings.push(`vendor_id_persist_failed: ${msg}`);
  }
}

async function safeMarkPending(onboardingState, honorariumRequestId, fields, warnings) {
  try {
    await onboardingState.markDynamicsPending(honorariumRequestId, fields);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[bill-onboard-reviewer] markDynamicsPending failed:', msg);
    if (Array.isArray(warnings)) warnings.push(`mark_pending_failed: ${msg}`);
  }
}

async function safeSetStatus(onboardingState, honorariumRequestId, billStatus) {
  try {
    await onboardingState.setStatus(honorariumRequestId, billStatus);
  } catch (err) {
    console.error('[bill-onboard-reviewer] setStatus failed:', err?.message || String(err));
  }
}

// ─────────────────────────── Failure handlers ───────────────────────────

async function billFailure(notifications, err, input, phase, advanced = {}) {
  let severity = 'error';
  let codeLabel = 'bill_error';
  if (err instanceof BillAuthError) { severity = 'critical'; codeLabel = 'bill_auth'; }
  else if (err instanceof BillRateLimitError) { codeLabel = 'bill_rate_limit'; }
  else if (err instanceof BillServerError) { codeLabel = 'bill_5xx'; }
  else if (err instanceof BillValidationError) { codeLabel = 'bill_validation'; }

  await safeNotify(notifications, {
    type: 'bill_unavailable',
    severity,
    title: `BILL onboarding failed in phase: ${phase}`,
    message: err?.message || String(err),
    metadata: {
      honorariumRequestId: input.honorariumRequestId,
      reviewerContactId: input.reviewerContactId,
      phase,
      ...advanced,
    },
    source: 'bill/onboard-reviewer',
    category: 'spend',
  });

  return {
    ok: false,
    status: 'bill_unavailable',
    error: { code: codeLabel, message: err?.message || String(err), phase, ...advanced },
  };
}

async function unhandled(notifications, err, input, phase) {
  await safeNotify(notifications, {
    type: 'bill_unhandled_error',
    severity: 'error',
    title: `BILL onboarding: unhandled error in phase: ${phase}`,
    message: err?.message || String(err),
    metadata: {
      honorariumRequestId: input.honorariumRequestId,
      reviewerContactId: input.reviewerContactId,
      phase,
    },
    source: 'bill/onboard-reviewer',
    category: 'spend',
  });
  return {
    ok: false,
    status: 'bill_unavailable',
    error: { code: 'unhandled', message: err?.message || String(err), phase },
  };
}

async function notifyAlertOnly(notifications, input) {
  await safeNotify(notifications, {
    type: 'bill_manual_onboarding',
    severity: 'warning',
    emailAdmins: true,
    title: `Manual BILL onboarding needed: ${redactName(input.reviewerName)}`,
    message: 'BILL integration is disabled; ops must onboard this reviewer manually.',
    metadata: {
      honorariumRequestId: input.honorariumRequestId,
      reviewerContactId: input.reviewerContactId,
      reviewerName: input.reviewerName,
      reviewerEmail: input.reviewerEmail,
      reviewerPhone: input.reviewerPhone,
      address: input.address,
    },
    source: 'bill/onboard-reviewer',
    category: 'spend',
  });
}

/**
 * Wrap a notify() call so a notification-system failure can never bubble up
 * and convert a designed 200 outcome into a route 500. Per Codex post-impl
 * P1 #4. Optional `warningsBucket` records the failure for inclusion in the
 * response body.
 */
async function safeNotify(notifications, notifyArgs, warningsBucket) {
  try {
    return await notifications.notify(notifyArgs);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[bill-onboard-reviewer] notify() failed:', msg);
    if (Array.isArray(warningsBucket)) {
      warningsBucket.push(`alert_failed: ${msg}`);
    }
    return null;
  }
}

// ─────────────────────────── Helpers ───────────────────────────

function redactName(name) {
  if (typeof name !== 'string' || name.length === 0) return '(no name)';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function summarizeNetworkResults(results) {
  if (!Array.isArray(results)) return [];
  return results.slice(0, 5).map(r => ({
    networkId: r?.id || null,
    type: r?.type || null,
    // Whatever BILL returns about each match — name/zip — would be PII; in
    // sandbox we'll learn the actual shape and may need to redact further.
    // For now ship the structural fields only.
  }));
}
