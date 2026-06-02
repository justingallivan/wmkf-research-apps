/**
 * D26 going-forward allowlist — THROWAWAY pilot config (Request Workbench).
 *
 * ⚠️ Edit this one file to change the set. It exists only to unblock the
 * Workbench dashboard for the D26 (December 2026) peer-review cycle BEFORE the
 * formal Phase I→II status flip. The going-forward requests are still
 * `akoya_requeststatus = 'Phase I Pending'` (verified live 2026-05-31: all 35,
 * all with Dec-2026 meeting dates → D26, all PD-assigned), so the normal
 * status-gated reviewer-finding surface (`my-proposals.js`, gated to
 * `'Phase II Pending'`) can't see them yet, and advancing the status early
 * fires a live PowerAutomate intake-recompute trigger.
 *
 * The dashboard surfaces these by request NUMBER (not by status), in addition
 * to whatever the normal status-gated query returns. Once the cycle flips to
 * Phase II for real, this allowlist becomes a no-op (the status-gated branch
 * picks the same requests up) and can be deleted.
 *
 * Set is complete but MAY CHANGE before mid-June 2026 — keep it editable here,
 * in one place. The 35-request handover set is two ascending batches (18 + 17)
 * as handed over (S207). A 36th entry was appended in S212 as a safe smoke-test
 * request (see below) — the handover set itself is still the original 35.
 *
 * NB: `akoya_requestnum` is a STRING field in Dataverse — these are string
 * literals and must be quoted in OData filters.
 */

export const D26_ALLOWLIST_CYCLE_CODE = 'D26';

export const D26_ALLOWLIST_REQUEST_NUMS = [
  // Batch 1 (18)
  '1002836', '1002850', '1002852', '1002872', '1002874', '1002903',
  '1002912', '1002926', '1002959', '1002963', '1002964', '1003000',
  '1003010', '1003013', '1003020', '1003024', '1003038', '1003046',
  // Batch 2 (17)
  '1002794', '1002821', '1002833', '1002835', '1002860', '1002873',
  '1002886', '1002913', '1002916', '1002953', '1002988', '1003023',
  '1003034', '1003036', '1003070', '1003074', '1003075',
  // S212 test addition (1) — NOT part of the S207 handover set. Request 1002826
  // is "Phase I Pending", meeting date 2026-12-11 (→ D26), lead PD Justin
  // Gallivan, and is no longer under consideration, so it's a harm-free testbed
  // for the reviewer-invite prod smoke (replaces using live requests like
  // 1002794). Remove after smoke if a clean handover-only set is wanted.
  '1002826',
];
