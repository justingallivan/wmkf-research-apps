/**
 * BILL onboarding orchestrator — pure logic for /api/bill/onboard-reviewer.
 *
 * Separates HTTP/auth concerns (in the route handler) from the business flow
 * so tests can drive the orchestrator with injected fakes.
 *
 * Flow (per docs/BILL_CHUNK_6_ENDPOINT_DESIGN.md "Behavior — per status path"):
 *
 *   1. If BILL_ENABLED !== 'true' → alert + return status: 'alert_only'.
 *   2. Re-read contact.wmkf_billcomid (idempotency primitive).
 *   3. If empty: createBillVendor → PATCH contact wmkf_billcomid + akoya_isvendor
 *      (with one retry on the contact PATCH; failure escalates to status: 'partial').
 *   4. searchBillNetwork by name + zipOrPostalCode.
 *   5. exactMatchCount === 1: sendNetworkInvitation → PATCH akoya_request
 *      with PNI + wmkf_exisitngbillcomaccount = "Yes" → status: 'onboarded' or
 *      'reused_existing' depending on (3).
 *   6. exactMatchCount === 0: PATCH akoya_request with wmkf_exisitngbillcomaccount = "No"
 *      → status: 'no_match' (no alert).
 *   7. exactMatchCount >= 2: PATCH akoya_request with wmkf_exisitngbillcomaccount = "No"
 *      → status: 'ambiguous_match' + warning alert with redacted result summary.
 *
 * BILL errors are caught per-phase: vendor_create / network_search / network_invite.
 * The response includes which phase failed + what advanced.
 *
 * Dataverse PATCH failures are caught per-PATCH. contact-side gets one retry
 * (it's the idempotency primitive); request-side gets none.
 */

import {
  createBillVendor, searchBillNetwork, sendNetworkInvitation,
  BillAuthError, BillRateLimitError, BillServerError, BillError, BillValidationError,
} from './index.js';
import { bypassDynamicsRestrictions } from '../services/dynamics-context.js';
import { DynamicsService } from '../services/dynamics-service.js';
import NotificationService from '../services/notification-service.js';
import {
  BILLCOM_ACCOUNT_YES,
  BILLCOM_ACCOUNT_NO,
  assertOptionSetValuesConfigured,
} from './option-set-values.js';

const PHASE_VENDOR_CREATE = 'vendor_create';
const PHASE_NETWORK_SEARCH = 'network_search';
const PHASE_NETWORK_INVITE = 'network_invite';

/**
 * Drive the BILL onboarding flow for a single honorarium.
 *
 * @param {Object} input — validated request body (see route handler)
 * @param {Object} [deps] — injectable for tests
 * @returns {Promise<Object>} response body shape per design doc
 */
export async function onboardReviewer(input, deps = {}) {
  const {
    dynamics = DynamicsService,
    notifications = NotificationService,
    billClient = { createBillVendor, searchBillNetwork, sendNetworkInvitation },
  } = deps;

  if (process.env.BILL_ENABLED !== 'true') {
    await notifyAlertOnly(notifications, input);
    return { ok: true, status: 'alert_only' };
  }

  assertOptionSetValuesConfigured();

  let vendorId;
  let reusedExisting = false;
  const warnings = [];

  // ─── Idempotency pre-read ───
  let contact;
  try {
    contact = await bypassDynamicsRestrictions('bill-onboard-pre-read', () =>
      dynamics.getRecord('contacts', input.reviewerContactId, ['wmkf_billcomid', 'akoya_isvendor']),
    );
  } catch (err) {
    return unhandled(notifications, err, input, PHASE_VENDOR_CREATE);
  }

  const existingVendorId = contact?.wmkf_billcomid || null;

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
      return billFailure(notifications, err, input, PHASE_VENDOR_CREATE);
    }

    // PATCH contact with the new vendorId + akoya_isvendor=true (Q1, Connor 2026-05-26).
    // Contact PATCH IS the idempotency primitive; one retry before alerting.
    const contactPatchOutcome = await patchContactBillcomId(dynamics, input.reviewerContactId, vendorId);
    if (!contactPatchOutcome.ok) {
      await notifications.notify({
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
      });
      warnings.push(`contact_patch_failed: ${contactPatchOutcome.message}`);
      // Continue to search+invite anyway — the alert payload has vendorId so ops
      // can write it manually; further BILL work is still useful.
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
    return billFailure(notifications, err, input, PHASE_NETWORK_SEARCH, { vendorId });
  }

  const { exactMatchCount, pni, networkId, allResults } = searchResult;

  // ─── Phase: network_invite + final PATCH ───
  if (exactMatchCount === 1) {
    try {
      await billClient.sendNetworkInvitation(vendorId, networkId);
    } catch (err) {
      return billFailure(notifications, err, input, PHASE_NETWORK_INVITE, { vendorId, pni });
    }

    const patchOutcome = await patchAkoyaRequestSuccess(dynamics, input.honorariumRequestId, pni);
    if (!patchOutcome.ok) {
      await notifications.notify({
        type: 'bill_request_patch_failed',
        severity: 'warning',
        title: `BILL onboarding: honorarium request PATCH failed after successful invite`,
        message: patchOutcome.message,
        metadata: {
          honorariumRequestId: input.honorariumRequestId,
          vendorId,
          pni,
          fields: ['wmkf_paymentnetworkidpni', 'wmkf_exisitngbillcomaccount'],
        },
        source: 'bill/onboard-reviewer',
        category: 'spend',
      });
      warnings.push(`request_patch_failed: ${patchOutcome.message}`);
      return { ok: true, status: 'partial', vendorId, pni, exactMatchCount, warnings };
    }

    const status = reusedExisting ? 'reused_existing' : 'onboarded';
    return warnings.length
      ? { ok: true, status: 'partial', vendorId, pni, exactMatchCount, warnings }
      : { ok: true, status, vendorId, pni, exactMatchCount };
  }

  // exactMatchCount === 0 or >= 2: write "No", maybe alert
  const patchOutcome = await patchAkoyaRequestNoMatch(dynamics, input.honorariumRequestId);
  if (!patchOutcome.ok) {
    await notifications.notify({
      type: 'bill_request_patch_failed',
      severity: 'warning',
      title: `BILL onboarding: honorarium request PATCH failed (no_match path)`,
      message: patchOutcome.message,
      metadata: {
        honorariumRequestId: input.honorariumRequestId,
        vendorId,
        exactMatchCount,
        fields: ['wmkf_exisitngbillcomaccount'],
      },
      source: 'bill/onboard-reviewer',
      category: 'spend',
    });
    warnings.push(`request_patch_failed: ${patchOutcome.message}`);
  }

  if (exactMatchCount >= 2) {
    await notifications.notify({
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
    });
    return {
      ok: true, status: 'ambiguous_match', vendorId, exactMatchCount,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  return {
    ok: true, status: 'no_match', vendorId, exactMatchCount,
    ...(warnings.length ? { warnings } : {}),
  };
}

// ─────────────────────────── Dataverse PATCH helpers ───────────────────────────

async function patchContactBillcomId(dynamics, contactId, vendorId) {
  const body = {
    wmkf_billcomid: vendorId,
    akoya_isvendor: true,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await bypassDynamicsRestrictions('bill-onboard-contact-patch', () =>
        dynamics.updateRecord('contacts', contactId, body),
      );
      return { ok: true };
    } catch (err) {
      if (attempt === 0) continue;
      return { ok: false, message: err?.message || String(err) };
    }
  }
  return { ok: false, message: 'unreachable' };
}

async function patchAkoyaRequestSuccess(dynamics, requestId, pni) {
  try {
    await bypassDynamicsRestrictions('bill-onboard-request-patch-yes', () =>
      dynamics.updateRecord('akoya_requests', requestId, {
        wmkf_paymentnetworkidpni: pni,
        wmkf_exisitngbillcomaccount: BILLCOM_ACCOUNT_YES,
      }),
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
}

async function patchAkoyaRequestNoMatch(dynamics, requestId) {
  try {
    await bypassDynamicsRestrictions('bill-onboard-request-patch-no', () =>
      dynamics.updateRecord('akoya_requests', requestId, {
        wmkf_exisitngbillcomaccount: BILLCOM_ACCOUNT_NO,
      }),
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
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

  await notifications.notify({
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
  await notifications.notify({
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
  await notifications.notify({
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
