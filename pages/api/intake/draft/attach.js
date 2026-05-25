/**
 * POST /api/intake/draft/attach
 *
 * Applicant intake portal — third leg of the three-call attachment
 * dance. After the browser PUTs bytes to private Blob using the token
 * from /api/intake/draft/upload-token, this endpoint downloads the
 * bytes, recomputes sha256/size, magic-byte validates, scans, and
 * either promotes the entry from pending_attachments to attachments
 * (clean) or deletes the Blob (infected / oversized) / leaves it for
 * operator inspection (magic mismatch).
 *
 * Contract: docs/INTAKE_ATTACH_CHUNK5_DESIGN.md (Codex pre-impl round-1
 * locked) + docs/INTAKE_ATTACH_BUILD_SCOPING.md § A1-A7.
 *
 * Request body (no other fields permitted):
 *   { draftId: <number>, attachmentId: <uuid v4> }
 *
 * Responses:
 *   200 { status: 'attached' | 'already_attached', attachmentId }
 *   400 body validation
 *   401 not applicant / identity_bridge_invalid
 *   403 no membership
 *   404 draft_not_found | pending_not_found
 *   409 draft_submitted | identity_conflict | bytes_not_uploaded
 *   413 size_exceeds_field_max
 *   422 magic_mismatch | infected | field_already_has_attachment |
 *       field_max_files_exceeded
 *   500 scan_misconfigured | blob_misconfigured | form_schema_unknown |
 *       (internal)
 *   502 Identity bridge failed
 *   503 scan_unavailable | blob_unavailable | identity_service_initializing
 */

import crypto from 'crypto';
import { getServerSession } from 'next-auth/next';
import { get as blobGet, del as blobDel } from '@vercel/blob';
import { authOptions } from '../../auth/[...nextauth]';
import { hasLiveMembership } from '../../../../lib/services/membership-service';
import IntakeDraftService from '../../../../lib/services/intake-draft-service';
import IntakeAuditService from '../../../../lib/services/intake-audit-service';
import { resolveContactForSession } from '../../../../lib/services/contact-bridge-service';
import { scanBytes } from '../../../../lib/services/cloudmersive-scan';
import { isVirusScanEnabled } from '../../../../lib/utils/virus-scan-config';
import { validateIntakeAttachment } from '../../../../lib/utils/file-magic';
import { getIntakeBlobToken } from '../../../../lib/utils/intake-blob';
import { getFormSchema, findFileField, countFieldEntries } from '../../../../lib/utils/form-schema';
import { buildNoResponseError } from '../../../../lib/utils/service-error';

const ALLOWED_FIELDS = new Set(['draftId', 'attachmentId']);

const FORBIDDEN_FIELDS = [
  'pathname',
  'filename',
  'contentType',
  'fieldKey',
  'accountId',
  'formKey',
  'requestId',
  'contactOid',
  'draftJson',
];

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

function auditFireAndForget(row) {
  IntakeAuditService.log(row).catch((err) => {
    console.warn('[attach] audit insert failed:', err?.message ?? err);
  });
}

export default async function handler(req, res) {
  // 1) Method
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

  // 3) Body validation + forbidden-field guard + closed-set allow-list
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  for (const f of FORBIDDEN_FIELDS) {
    if (body[f] != null) {
      return jsonError(res, 400, `${f} is not accepted on this endpoint`);
    }
  }
  for (const k of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(k) && !FORBIDDEN_FIELDS.includes(k)) {
      return jsonError(res, 400, `unexpected field: ${k}`);
    }
  }
  const { draftId, attachmentId } = body;
  if (typeof draftId !== 'number' || !Number.isSafeInteger(draftId) || draftId <= 0) {
    return jsonError(res, 400, 'draftId must be a positive safe integer');
  }
  if (typeof attachmentId !== 'string' || !UUID_V4_RE.test(attachmentId)) {
    return jsonError(res, 400, 'attachmentId must be a UUIDv4');
  }

  // 4) Load draft
  let draft;
  try {
    draft = await IntakeDraftService.getById(draftId);
  } catch (err) {
    console.error('[attach] getById failed:', err);
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
      bridgeResult = await resolveContactForSession({
        oid: contactOid,
        email: session.user.contactEmail,
        name: session.user.contactName,
      });
    } catch (err) {
      if (err?.altKeyNotActive) {
        console.warn('[attach] bridge altKeyNotActive:', err.message);
        res.setHeader('Retry-After', '30');
        return jsonError(res, 503, 'identity_service_initializing', {
          message: 'The identity service is still initializing. Please retry in a moment.',
        });
      }
      console.error('[attach] bridge failed:', err);
      return jsonError(res, 502, 'Identity bridge failed; please retry');
    }
    if (!bridgeResult.ok) {
      if (bridgeResult.reason === 'conflict') {
        return jsonError(res, 409, 'identity_conflict', {
          message: 'Your account is already linked to a different portal identity. Please contact staff to resolve.',
        });
      }
      console.warn('[attach] bridge ok:false reason=' + bridgeResult.reason, bridgeResult.message);
      return jsonError(res, 401, 'identity_bridge_invalid');
    }
    const contactId = bridgeResult.contactId;

    // 7) Membership
    let allowed;
    try {
      allowed = await hasLiveMembership(contactId, draft.account_id);
    } catch (err) {
      console.error('[attach] membership check failed:', err);
      return jsonError(res, 502, 'Membership lookup failed; please retry');
    }
    if (!allowed) {
      auditFireAndForget({
        actorOid: contactOid,
        actorType: 'applicant',
        action: 'draft.attach.ownership_denied',
        targetEntity: 'intake_drafts',
        targetId: draftId,
        payload: {},
        metadata: { draftId, attachmentId, accountIdAttempted: draft.account_id },
      });
      return jsonError(res, 403, 'No live membership on this institution');
    }
  }

  // 8) Q4 reject — submitted drafts are frozen
  if (draft.request_id != null) {
    return jsonError(res, 409, 'draft_submitted', {
      message: 'This draft has been submitted and is no longer editable.',
    });
  }

  // 9) A2 dual-lookup — attachments[] first, then pending_attachments
  const attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
  const already = attachments.find((a) => a && a.attachmentId === attachmentId);
  if (already) {
    return res.status(200).json({ status: 'already_attached', attachmentId });
  }
  const pendingArr = Array.isArray(draft.pending_attachments) ? draft.pending_attachments : [];
  const pending = pendingArr.find((p) => p && p.attachmentId === attachmentId);
  if (!pending) {
    return jsonError(res, 404, 'pending_not_found');
  }

  // 10) Schema lookup — fail loud if the draft's form/field is gone.
  //     Mint-time should have guaranteed both exist; seeing them missing
  //     here is real drift (form retired, schema edited mid-flight).
  const schema = getFormSchema(draft.form_key);
  if (!schema) {
    return jsonError(res, 500, 'form_schema_unknown');
  }
  const fieldOrShim = findFileField(schema, pending.fieldKey);
  if (!fieldOrShim || fieldOrShim._notUploadable) {
    return jsonError(res, 500, 'field_not_uploadable');
  }
  const field = fieldOrShim;

  // 11) Blob download — wrap unstructured errors per drain prior art.
  const blobToken = (() => {
    try {
      return getIntakeBlobToken();
    } catch (err) {
      console.error('[attach] INTAKE_BLOB_RW_TOKEN unset:', err.message);
      return null;
    }
  })();
  if (!blobToken) {
    return jsonError(res, 500, 'blob_misconfigured');
  }

  let blobResult;
  try {
    blobResult = await blobGet(pending.pathname, {
      access: 'private',
      useCache: false,
      token: blobToken,
    });
  } catch (rawErr) {
    const wrapped = rawErr?.serviceName ? rawErr : buildNoResponseError('blob', rawErr);
    if (wrapped.isTransient === true) {
      console.warn('[attach] blobGet transient:', wrapped.message);
      return jsonError(res, 503, 'blob_unavailable');
    }
    console.error('[attach] blobGet non-transient:', wrapped);
    auditFireAndForget({
      actorOid: contactOid,
      actorType: 'applicant',
      action: 'draft.attach_blob_misconfigured',
      targetEntity: 'intake_drafts',
      targetId: draftId,
      payload: { filename: pending.filename },
      metadata: {
        draftId, attachmentId, fieldKey: pending.fieldKey, pathname: pending.pathname,
        contentType: pending.contentType,
        serviceName: wrapped.serviceName,
        status: wrapped.status,
        isTransient: wrapped.isTransient,
      },
    });
    return jsonError(res, 500, 'blob_misconfigured');
  }

  if (!blobResult || !blobResult.stream) {
    return jsonError(res, 409, 'bytes_not_uploaded');
  }

  // 12) Read bytes
  let buffer;
  try {
    buffer = Buffer.from(await new Response(blobResult.stream).arrayBuffer());
  } catch (err) {
    console.error('[attach] reading Blob stream failed:', err);
    return jsonError(res, 503, 'blob_unavailable');
  }

  // 13) Compute sha256 + size (over actual bytes; client claim discarded)
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const size = buffer.length;

  // Helper: delete Blob, swallow + log on failure for callers that
  // shouldn't propagate the deletion error to the client. Returns the
  // structured error (or null) so audit rows can include it.
  async function delBlobSilent() {
    try {
      await blobDel(pending.pathname, { token: blobToken });
      return null;
    } catch (rawErr) {
      const wrapped = rawErr?.serviceName ? rawErr : buildNoResponseError('blob', rawErr);
      console.warn('[attach] del failed for', pending.pathname, wrapped.message);
      return wrapped;
    }
  }

  async function removePendingSilent() {
    try {
      await IntakeDraftService.removePending(draftId, attachmentId);
    } catch (err) {
      console.warn('[attach] removePending failed:', err?.message ?? err);
    }
  }

  // 14) Magic-byte validation — use the field's full accept[] (not the
  //     single pending.contentType — Codex pre-impl round-1 catch).
  const accept = Array.isArray(field.accept) ? field.accept : [];
  const magic = validateIntakeAttachment(pending.filename, buffer, accept);
  if (!magic.ok) {
    // Blob NOT deleted (operator-decision posture per scoping doc).
    // Pending entry removed so the cardinality slot frees up.
    await removePendingSilent();
    auditFireAndForget({
      actorOid: contactOid,
      actorType: 'applicant',
      action: 'draft.attach_magic_mismatch',
      targetEntity: 'intake_drafts',
      targetId: draftId,
      payload: { filename: pending.filename },
      metadata: {
        draftId, attachmentId, fieldKey: pending.fieldKey, pathname: pending.pathname,
        sha256, size,
        declaredContentType: pending.contentType,
        accept,
        reason: magic.reason,
      },
    });
    return jsonError(res, 422, 'magic_mismatch', { reason: magic.reason });
  }

  // 15) Cardinality re-check — chunk-4's mint-time gate could now be at
  //     cap if concurrent attaches succeeded. Defense in depth.
  const currentCount = countFieldEntries(draft, pending.fieldKey);
  if (field.multiple === true) {
    const cap = typeof field.maxFiles === 'number' ? field.maxFiles : Infinity;
    if (currentCount >= cap) {
      await delBlobSilent();
      await removePendingSilent();
      return jsonError(res, 422, 'field_max_files_exceeded', {
        maxFiles: cap, current: currentCount,
      });
    }
  } else {
    if (currentCount > 0) {
      await delBlobSilent();
      await removePendingSilent();
      return jsonError(res, 422, 'field_already_has_attachment', {
        current: currentCount,
      });
    }
  }

  // 16) Size cap
  if (size > pending.maxBytes) {
    await delBlobSilent();
    await removePendingSilent();
    auditFireAndForget({
      actorOid: contactOid,
      actorType: 'applicant',
      action: 'draft.attach_size_exceeded',
      targetEntity: 'intake_drafts',
      targetId: draftId,
      payload: { filename: pending.filename },
      metadata: {
        draftId, attachmentId, fieldKey: pending.fieldKey, pathname: pending.pathname,
        sha256, size, maxBytes: pending.maxBytes,
        contentType: pending.contentType,
      },
    });
    return jsonError(res, 413, 'size_exceeds_field_max', {
      size, maxBytes: pending.maxBytes,
    });
  }

  // 17) Scanner posture (A7)
  let scanResult; // { scan_result: 'clean'|'infected', foundViruses, scannedAt, scanner }
  if (!isVirusScanEnabled()) {
    scanResult = {
      scan_result: 'clean',
      foundViruses: [],
      scannedAt: new Date().toISOString(),
      scanner: 'skipped',
    };
  } else {
    try {
      scanResult = await scanBytes(buffer, pending.filename);
    } catch (err) {
      // scanBytes throws structured errors with serviceName='cloudmersive'
      // + isTransient discriminator. Map transient → 503, non-transient → 500.
      const wrapped = err?.serviceName ? err : buildNoResponseError('cloudmersive', err);
      const transient = wrapped.isTransient === true;
      const action = transient
        ? 'draft.attach_scan_unavailable'
        : 'draft.attach_scan_misconfigured';
      auditFireAndForget({
        actorOid: contactOid,
        actorType: 'applicant',
        action,
        targetEntity: 'intake_drafts',
        targetId: draftId,
        payload: { filename: pending.filename },
        metadata: {
          draftId, attachmentId, fieldKey: pending.fieldKey, pathname: pending.pathname,
          sha256, size, contentType: pending.contentType,
          serviceName: wrapped.serviceName,
          status: wrapped.status,
          isTransient: wrapped.isTransient,
        },
      });
      if (transient) {
        return jsonError(res, 503, 'scan_unavailable');
      }
      return jsonError(res, 500, 'scan_misconfigured');
    }
  }

  // 18) Map scan result
  if (scanResult.scan_result === 'infected') {
    const virusName = scanResult.foundViruses?.[0]?.virusName ?? 'unknown';
    const delErr = await delBlobSilent();
    await removePendingSilent();
    if (delErr) {
      // Q3 reversal: audit cleanup failure so operator knows infected
      // bytes still sit in Blob until sweep.
      auditFireAndForget({
        actorOid: contactOid,
        actorType: 'applicant',
        action: 'draft.attach_infected_del_failed',
        targetEntity: 'intake_drafts',
        targetId: draftId,
        payload: { filename: pending.filename },
        metadata: {
          draftId, attachmentId, fieldKey: pending.fieldKey, pathname: pending.pathname,
          virusName,
          delError: {
            serviceName: delErr.serviceName,
            status: delErr.status,
            isTransient: delErr.isTransient,
            message: delErr.message,
          },
        },
      });
    }
    auditFireAndForget({
      actorOid: contactOid,
      actorType: 'applicant',
      action: 'draft.attach_infected',
      targetEntity: 'intake_drafts',
      targetId: draftId,
      payload: { filename: pending.filename },
      metadata: {
        draftId, attachmentId, fieldKey: pending.fieldKey, pathname: pending.pathname,
        sha256, size,
        scanner: scanResult.scanner,
        scan_result: 'infected',
        virusName,
        scannedAt: scanResult.scannedAt,
        contentType: pending.contentType,
      },
    });
    return jsonError(res, 422, 'infected');
  }

  // 19) Clean → promote
  const cleanRow = {
    attachmentId,
    fieldKey: pending.fieldKey,
    filename: pending.filename,
    pathname: pending.pathname,
    blob_url: blobResult?.blob?.url ?? null,
    sha256,
    size,
    contentType: pending.contentType,
    scan_result: 'clean',
    scanner: scanResult.scanner,
    scanned_at: scanResult.scannedAt,
  };

  let promotion;
  try {
    promotion = await IntakeDraftService.promoteToClean(draftId, attachmentId, cleanRow);
  } catch (err) {
    console.error('[attach] promoteToClean failed:', err);
    return jsonError(res, 500, 'promote_failed');
  }

  if (promotion.promoted) {
    auditFireAndForget({
      actorOid: contactOid,
      actorType: 'applicant',
      action: 'draft.attach',
      targetEntity: 'intake_drafts',
      targetId: draftId,
      payload: { filename: pending.filename },
      metadata: {
        draftId, attachmentId, fieldKey: pending.fieldKey, pathname: pending.pathname,
        sha256, size,
        scanner: scanResult.scanner,
        scan_result: scanResult.scan_result,
        scannedAt: scanResult.scannedAt,
        contentType: pending.contentType,
      },
    });
    return res.status(200).json({ status: 'attached', attachmentId });
  }

  // Non-promoted outcomes
  switch (promotion.reason) {
    case 'race_already_promoted':
      // A2 idempotency through racing call — original draft.attach row
      // exists, no audit needed.
      return res.status(200).json({ status: 'already_attached', attachmentId });
    case 'pending_not_found':
      // Sweep removed entry during scan window. No audit.
      return jsonError(res, 404, 'pending_not_found');
    case 'draft_not_found':
      // Draft deleted between load and promote. No audit.
      return jsonError(res, 404, 'draft_not_found');
    default:
      console.error('[attach] unexpected promotion reason:', promotion.reason);
      return jsonError(res, 500, 'promote_unexpected_reason');
  }
}
