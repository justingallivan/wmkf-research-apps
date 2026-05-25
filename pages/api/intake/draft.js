/**
 * POST /api/intake/draft
 *
 * Applicant intake portal — draft autosave. Upserts the draft's
 * `draft_json` field; never touches `attachments[]` (those are managed
 * independently by /api/intake/draft/attach so concurrent appends don't
 * race with autosaves).
 *
 * Contract (drain plan v7 §"Build pieces" #4):
 *
 *   Request:  { accountId, formKey, draftJson }
 *   Auth:     external-id session with userType='applicant' + contactOid;
 *             any live membership (Submitter OR Contributor — Contributors
 *             can edit but cannot submit).
 *
 *   NOTE on requestId scoping: this endpoint does NOT accept requestId.
 *   The requestless branch (request_id IS NULL) is the only branch in
 *   v1 scope; the with-request branch is reserved for the future
 *   compliance-loop flow (per intake-draft-service.js comments), which
 *   needs an ownership model the autosave path doesn't provide. Accepting
 *   requestId here was Codex S183-round-8 BLOCKER: any Contributor at an
 *   institution could overwrite/reassign another Contributor's
 *   request-bound draft just by knowing the request GUID, because the
 *   with-request upsert keys on (account_id, request_id, form_key) and
 *   reassigns contact_oid on conflict. Reject any requestId in the body
 *   to close that exploit path.
 *
 *   Sequence:
 *     1. Auth → contactOid (from session)
 *     2. Bridge: resolveContactForSession({ oid, email, name }) → contactId
 *        (same path as /api/intake/submit; Codex round-13 Q3 503 fail-loud
 *        on altKeyNotActive)
 *     3. Membership guard: hasLiveMembership(contactId, accountId)
 *     4. Idempotency-key preservation: read the existing draft (if any) and
 *        carry forward draft_json.idempotency_key; if no existing draft, mint
 *        a new one. Reused on every autosave so /submit's collision-returning
 *        UPSERT works correctly.
 *     5. IntakeDraftService.upsertDraftJson(...) — touches only draft_json,
 *        leaves attachments[] alone.
 *     6. Audit (best-effort): action='draft.upsert'
 *
 *   Responses:
 *     200 { draftId, updatedAt }
 *     400 missing fields / invalid body shape
 *     401 not authenticated as applicant
 *     403 no live membership on accountId
 *     409 identity_conflict (bridge.conflict path; mirrors /submit)
 *     500 internal (pg / bridge / auth-layer failure)
 *     503 identity_service_initializing (alt-key transient)
 *
 *   NOT IN SCOPE:
 *     - Attachment management (use /api/intake/draft/attach)
 *     - Submission lifecycle (use /api/intake/submit)
 *     - Form validation against schema — autosave accepts partial /
 *       in-progress data by design; full validation runs at /submit
 */

import crypto from 'crypto';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { hasLiveMembership } from '../../../lib/services/membership-service';
import IntakeDraftService from '../../../lib/services/intake-draft-service';
import IntakeAuditService from '../../../lib/services/intake-audit-service';
import { resolveContactForSession } from '../../../lib/services/contact-bridge-service';
import { checkIntakeRateLimit } from '../../../lib/intake/rate-limit';

function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'Method not allowed');
  }

  // 1) Auth — applicant session
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || session.user.userType !== 'applicant') {
    return jsonError(res, 401, 'Authentication required (applicant)');
  }
  const contactOid = session.user.contactOid;
  if (!contactOid) {
    return jsonError(res, 401, 'Session missing contactOid');
  }

  // Rate limit — draft autosave gets a dedicated per-IP bucket (no
  // per-applicant cap so keystroke-debounced autosave can't UX-fail).
  // contactOid omitted intentionally for the 'draft' routeKey.
  const rl = await checkIntakeRateLimit(req, contactOid, 'draft');
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limited', { scope: rl.scope });
  }

  // 2) Body
  const { accountId, formKey, draftJson } = req.body || {};
  if (!accountId || typeof accountId !== 'string') {
    return jsonError(res, 400, 'accountId is required');
  }
  if (!formKey || typeof formKey !== 'string') {
    return jsonError(res, 400, 'formKey is required');
  }
  if (draftJson == null || typeof draftJson !== 'object' || Array.isArray(draftJson)) {
    return jsonError(res, 400, 'draftJson must be an object');
  }
  // Reject any caller-supplied requestId — see header comment "NOTE on
  // requestId scoping" for the ownership-takeover rationale.
  if (req.body && req.body.requestId != null) {
    return jsonError(res, 400, 'requestId is not accepted on this endpoint');
  }

  // 3) Bridge: OID → contactId. Same path as /submit.
  let bridgeResult;
  try {
    bridgeResult = await resolveContactForSession({
      oid: contactOid,
      email: session.user.contactEmail,
      name: session.user.contactName,
    });
  } catch (err) {
    if (err?.altKeyNotActive) {
      console.warn('[intake/draft] bridge altKeyNotActive:', err.message);
      res.setHeader('Retry-After', '30');
      return jsonError(res, 503, 'identity_service_initializing', {
        message: 'The identity service is still initializing. Please retry in a moment.',
      });
    }
    console.error('[intake/draft] bridge failed:', err);
    return jsonError(res, 502, 'Identity bridge failed; please retry');
  }
  if (!bridgeResult.ok) {
    if (bridgeResult.reason === 'conflict') {
      IntakeAuditService.log({
        actorOid: contactOid,
        actorType: 'applicant',
        action: 'bridge.conflict',
        targetEntity: 'contact',
        targetId: bridgeResult.existingContactId ?? null,
        payload: {
          message: bridgeResult.message,
          existingContactId: bridgeResult.existingContactId,
          existingOid: bridgeResult.existingOid,
          candidates: bridgeResult.candidates,
        },
      }).catch(() => {});
      return jsonError(res, 409, 'identity_conflict', {
        message: 'Your account is already linked to a different portal identity. Please contact staff to resolve.',
      });
    }
    return jsonError(res, 401, bridgeResult.message || 'Identity bridge invalid');
  }
  const contactId = bridgeResult.contactId;

  // 4) Membership — any role accepted (Contributor or Submitter)
  let allowed;
  try {
    allowed = await hasLiveMembership(contactId, accountId);
  } catch (err) {
    console.error('[intake/draft] membership check failed:', err);
    return jsonError(res, 502, 'Membership lookup failed; please retry');
  }
  if (!allowed) {
    return jsonError(res, 403, 'No live membership on this institution');
  }

  // 5) Preserve idempotency_key across autosaves. The first autosave for a
  //    new (contactOid, accountId, formKey) triple mints one; subsequent
  //    autosaves carry it forward so /submit's collision-returning UPSERT
  //    keys off a stable value.
  let existing;
  try {
    existing = await IntakeDraftService.getByKey({
      contactOid,
      accountId,
      requestId: null,
      formKey,
    });
  } catch (err) {
    console.error('[intake/draft] getByKey failed:', err);
    return jsonError(res, 500, 'Draft lookup failed');
  }

  const existingIdempotencyKey = existing?.draft_json?.idempotency_key;
  const idempotencyKey = existingIdempotencyKey || crypto.randomUUID();

  // Caller-supplied idempotency_key in draftJson is ignored — server owns
  // this field's lifecycle. Strip it before merging so the autosaved body
  // can't overwrite the stable value.
  const { idempotency_key: _ignored, ...draftJsonRest } = draftJson;
  const mergedDraftJson = { ...draftJsonRest, idempotency_key: idempotencyKey };

  // 6) Upsert (draft_json only — attachments[] preserved by service contract)
  let row;
  try {
    row = await IntakeDraftService.upsertDraftJson({
      contactOid,
      accountId,
      requestId: null,
      formKey,
      draftJson: mergedDraftJson,
    });
  } catch (err) {
    console.error('[intake/draft] upsertDraftJson failed:', err);
    return jsonError(res, 500, 'Draft save failed');
  }

  // 7) Audit (best-effort, never blocks the response)
  IntakeAuditService.log({
    actorOid: contactOid,
    actorType: 'applicant',
    action: 'draft.upsert',
    targetEntity: 'intake_drafts',
    targetId: row.id,
    payload: mergedDraftJson,
    metadata: {
      accountId,
      formKey,
      isNew: !existing,
    },
  }).catch(() => {});

  return res.status(200).json({
    draftId: row.id,
    updatedAt: row.updated_at,
  });
}
