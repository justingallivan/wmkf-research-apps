/**
 * POST /api/intake/draft/upload-token
 *
 * Applicant intake portal — first leg of the three-call attachment
 * dance. Mints a Vercel Blob client-upload token pre-issued to an
 * opaque, server-controlled pathname. The browser uses this token
 * with `put()` from `@vercel/blob/client` to PUT the bytes directly
 * to the private Blob store, then calls /api/intake/draft/attach to
 * finalize (download + scan + promote).
 *
 * Contract: docs/INTAKE_ATTACH_CHUNK4_DESIGN.md (Codex round-1
 * locked) + docs/INTAKE_ATTACH_BUILD_SCOPING.md § A1-A7.
 *
 * Request body (no other fields permitted):
 *   { draftId: <number>, fieldKey: <string>,
 *     filename: <string>, contentType: <string> }
 *
 * Forbidden body fields (server-derived; reject 400 if present):
 *   attachmentId, pathname, accountId, formKey, requestId,
 *   contactOid, draftJson
 *
 * Response 200:
 *   { attachmentId, token, pathname, filename, validUntil }
 *
 * See § 2 of the chunk-4 design for the full step-by-step + error
 * taxonomy. The full 9-step sequence is implemented below.
 */

import crypto from 'crypto';
import { getServerSession } from 'next-auth/next';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { authOptions } from '../../auth/[...nextauth]';
import { hasLiveMembership } from '../../../../lib/services/membership-service';
import IntakeDraftService from '../../../../lib/services/intake-draft-service';
import IntakeAuditService from '../../../../lib/services/intake-audit-service';
import { resolveContactForSession } from '../../../../lib/services/contact-bridge-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { sanitizeBlobFilename } from '../../../../lib/utils/blob-filename';
import { getIntakeBlobToken } from '../../../../lib/utils/intake-blob';
import { checkIntakeRateLimit } from '../../../../lib/intake/rate-limit';
import { getFormSchema, findFileField, countFieldEntries } from '../../../../lib/utils/form-schema';

const FORBIDDEN_FIELDS = [
  'attachmentId',
  'pathname',
  'accountId',
  'formKey',
  'requestId',
  'contactOid',
  'draftJson',
];

// Closed-set allow-list — any field not here is rejected with 400.
// Codex chunk-4 post-impl LOW-2: permissive request shape hides client
// drift; explicit allow-list catches it.
const ALLOWED_FIELDS = new Set([
  'draftId',
  'fieldKey',
  'filename',
  'contentType',
]);

function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'Method not allowed');
  }

  // 2) Auth — applicant session
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || session.user.userType !== 'applicant') {
    return jsonError(res, 401, 'Authentication required (applicant)');
  }
  const contactOid = session.user.contactOid;
  if (!contactOid) {
    return jsonError(res, 401, 'Session missing contactOid');
  }

  // Rate limit BEFORE any body validation, draft fetch, or token mint.
  const rl = await checkIntakeRateLimit(req, contactOid, 'upload-token');
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limited', { scope: rl.scope });
  }

  // 3) Body validation + forbidden-field guard + closed-set allow-list
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  for (const f of FORBIDDEN_FIELDS) {
    if (body[f] != null) {
      return jsonError(res, 400, `${f} is not accepted on this endpoint`);
    }
  }
  // Reject any unexpected fields — Codex post-impl LOW-2.
  for (const k of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(k) && !FORBIDDEN_FIELDS.includes(k)) {
      return jsonError(res, 400, `unexpected field: ${k}`);
    }
  }
  const { draftId, fieldKey, filename, contentType } = body;
  // Codex post-impl MOD-2: require safe integer so very large JSON
  // numbers can't round during JSON parse and silently target a
  // different draft.
  if (typeof draftId !== 'number' || !Number.isSafeInteger(draftId) || draftId <= 0) {
    return jsonError(res, 400, 'draftId must be a positive safe integer');
  }
  if (typeof fieldKey !== 'string' || !fieldKey) {
    return jsonError(res, 400, 'fieldKey is required');
  }
  if (typeof filename !== 'string' || !filename) {
    return jsonError(res, 400, 'filename is required');
  }
  if (typeof contentType !== 'string' || !contentType) {
    return jsonError(res, 400, 'contentType is required');
  }

  // 4) Load draft
  let draft;
  try {
    draft = await IntakeDraftService.getById(draftId);
  } catch (err) {
    console.error('[upload-token] getById failed:', err);
    return jsonError(res, 500, 'Draft lookup failed');
  }
  if (!draft) {
    return jsonError(res, 404, 'draft_not_found');
  }

  // 5-7) Ownership: direct-owner short-circuit, else bridge + membership.
  const isDirectOwner = draft.contact_oid === contactOid;
  if (!isDirectOwner) {
    // 6) Bridge
    let bridgeResult;
    try {
      bridgeResult = await bypassDynamicsRestrictions('intake-upload-token-bridge', () =>
        resolveContactForSession({
          oid: contactOid,
          email: session.user.contactEmail,
          name: session.user.contactName,
        })
      );
    } catch (err) {
      if (err?.altKeyNotActive) {
        console.warn('[upload-token] bridge altKeyNotActive:', err.message);
        res.setHeader('Retry-After', '30');
        return jsonError(res, 503, 'identity_service_initializing', {
          message: 'The identity service is still initializing. Please retry in a moment.',
        });
      }
      console.error('[upload-token] bridge failed:', err);
      return jsonError(res, 502, 'Identity bridge failed; please retry');
    }
    if (!bridgeResult.ok) {
      if (bridgeResult.reason === 'conflict') {
        return jsonError(res, 409, 'identity_conflict', {
          message: 'Your account is already linked to a different portal identity. Please contact staff to resolve.',
        });
      }
      // Codex post-impl LOW-1: don't surface bridgeResult.message (may
      // contain operator-oriented identity text). Log server-side, return
      // a stable applicant-safe message.
      console.warn('[upload-token] bridge ok:false reason=' + bridgeResult.reason, bridgeResult.message);
      return jsonError(res, 401, 'identity_bridge_invalid');
    }
    const contactId = bridgeResult.contactId;

    // 7) Membership
    let allowed;
    try {
      allowed = await bypassDynamicsRestrictions('intake-upload-token-membership', () =>
        hasLiveMembership(contactId, draft.account_id)
      );
    } catch (err) {
      console.error('[upload-token] membership check failed:', err);
      return jsonError(res, 502, 'Membership lookup failed; please retry');
    }
    if (!allowed) {
      // Audit ownership-denial as a security signal (Codex Q3).
      IntakeAuditService.log({
        actorOid: contactOid,
        actorType: 'applicant',
        action: 'draft.upload_token.ownership_denied',
        targetEntity: 'intake_drafts',
        targetId: draftId,
        payload: {},
        metadata: { draftId, fieldKey, accountIdAttempted: draft.account_id },
      }).catch(() => {});
      return jsonError(res, 403, 'No live membership on this institution');
    }
  }

  // 8) Q4 reject — submitted drafts are frozen
  if (draft.request_id != null) {
    return jsonError(res, 409, 'draft_submitted', {
      message: 'This draft has been submitted and is no longer editable.',
    });
  }

  // 9) fieldKey resolution
  const schema = getFormSchema(draft.form_key);
  if (!schema) {
    // Schema not in static map — shouldn't happen for a draft that
    // /submit accepted, but defensive.
    return jsonError(res, 500, 'form_schema_unknown');
  }
  const fieldOrShim = findFileField(schema, fieldKey);
  if (!fieldOrShim) {
    return jsonError(res, 422, 'unknown_field_key');
  }
  if (fieldOrShim._notUploadable) {
    return jsonError(res, 422, 'field_not_uploadable');
  }
  const field = fieldOrShim;

  // 10) contentType validation
  const accept = Array.isArray(field.accept) ? field.accept : [];
  if (!accept.includes(contentType)) {
    return jsonError(res, 422, 'content_type_not_allowed', { allowed: accept });
  }

  // 11) Per-field cardinality gate (Codex Q1)
  const currentCount = countFieldEntries(draft, fieldKey);
  if (field.multiple === true) {
    const cap = typeof field.maxFiles === 'number' ? field.maxFiles : Infinity;
    if (currentCount >= cap) {
      return jsonError(res, 422, 'field_max_files_exceeded', { maxFiles: cap, current: currentCount });
    }
  } else {
    if (currentCount > 0) {
      return jsonError(res, 422, 'field_already_has_attachment', { current: currentCount });
    }
  }

  // 12) Filename sanitization. Don't leak sanitizer's internal error
  //     message — return a stable code instead. Codex post-impl LOW-5.
  let sanitizedFilename;
  try {
    sanitizedFilename = sanitizeBlobFilename(filename);
  } catch (err) {
    console.warn('[upload-token] sanitizer rejected:', err.message);
    return jsonError(res, 422, 'filename_invalid');
  }

  // 13) maxBytes — missing maxSizeMb is a SCHEMA bug, not a defaultable
  //     condition; fail loud so an operator catches it instead of accepting
  //     the silent 10MB fallback. Codex chunk-4 post-impl MOD-1.
  if (typeof field.maxSizeMb !== 'number' || field.maxSizeMb <= 0) {
    console.error(`[upload-token] schema field ${fieldKey} missing maxSizeMb`);
    return jsonError(res, 500, 'form_schema_field_invalid', { detail: 'maxSizeMb missing' });
  }
  const maxBytes = field.maxSizeMb * 1024 * 1024;

  // 14) Mint identifiers
  const attachmentId = crypto.randomUUID();
  const pathname = `drafts/${draftId}/${attachmentId}`;
  const now = Date.now();
  const validUntilMs = now + 3600_000; // 1h per A6
  const createdAtIso = new Date(now).toISOString();
  const validUntilIso = new Date(validUntilMs).toISOString();

  // 15) Blob token — mint FIRST so a failure doesn't leave an orphan
  //     pending entry (Codex round-1 reorder).
  let token;
  try {
    const rwToken = getIntakeBlobToken();
    token = await generateClientTokenFromReadWriteToken({
      pathname,
      maximumSizeInBytes: maxBytes,
      allowedContentTypes: [contentType],
      validUntil: validUntilMs,
      addRandomSuffix: false,
      allowOverwrite: false,
      token: rwToken,
    });
  } catch (err) {
    console.error('[upload-token] Blob token mint failed:', err);
    IntakeAuditService.log({
      actorOid: contactOid,
      actorType: 'applicant',
      action: 'draft.upload_token.mint_failed',
      targetEntity: 'intake_drafts',
      targetId: draftId,
      payload: { filename: sanitizedFilename },
      metadata: { draftId, fieldKey, attachmentId, pathname, contentType, maxBytes, validUntil: validUntilIso },
    }).catch(() => {});
    return jsonError(res, 500, 'upload_token_mint_failed');
  }

  // 16) Pending entry append
  const entry = {
    attachmentId,
    fieldKey,
    filename: sanitizedFilename,
    pathname,
    contentType,
    maxBytes,
    createdAt: createdAtIso,
    validUntil: validUntilIso,
  };
  let appendResult;
  try {
    appendResult = await IntakeDraftService.appendPending(draftId, entry);
  } catch (err) {
    console.error('[upload-token] appendPending failed:', err);
    return jsonError(res, 500, 'pending_append_failed');
  }
  if (appendResult === null) {
    // Race: draft deleted between step 4 (getById) and step 16. No
    // Blob compensation needed — bytes haven't been PUT.
    return jsonError(res, 404, 'draft_not_found');
  }
  // Codex post-impl LOW-4: verify the helper's caller contract — the
  // returned pending array MUST contain the freshly-minted attachmentId.
  // If it doesn't, the helper regressed or a duplicate-collision elided
  // the append; either way, returning a token for an entry /attach
  // can't find later is worse than a 500 here.
  const inPending = Array.isArray(appendResult.pending)
    && appendResult.pending.some(p => p && p.attachmentId === attachmentId);
  if (!inPending) {
    console.error('[upload-token] appendPending returned without minted attachmentId', { draftId, attachmentId });
    return jsonError(res, 500, 'pending_append_invariant_violated');
  }

  // 17) Audit (best-effort, never blocks the response). Codex post-impl
  //     MOD-5: include draftId in metadata for forensics queries even
  //     though it's also on targetId — A3 classifies draftId as
  //     queryable, and a query that filters only on attachmentId across
  //     all rows shouldn't need to JOIN targetId.
  IntakeAuditService.log({
    actorOid: contactOid,
    actorType: 'applicant',
    action: 'draft.upload_token.mint',
    targetEntity: 'intake_drafts',
    targetId: draftId,
    payload: { filename: sanitizedFilename },
    metadata: { draftId, fieldKey, attachmentId, pathname, contentType, maxBytes, validUntil: validUntilIso },
  }).catch(() => {});

  // 18) Response
  return res.status(200).json({
    attachmentId,
    token,
    pathname,
    filename: sanitizedFilename,
    validUntil: validUntilMs,
  });
}
