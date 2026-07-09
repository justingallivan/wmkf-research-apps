/**
 * POST /api/external/grantee/[token]/submit
 *
 * Chunk 5 of the Grantee Deliverables Portal — the grantee returns the edited
 * abstract + a graphical image + caption. Public, token-authed (NOT app-authed);
 * parallel grantee variant of the reviewer upload route.
 *
 * Order (fail-fast): method → rate-limit → verify token (aud:'grantee') → record
 * outcome → editable-status guard → parse multipart → verify waiver render token →
 * writeGranteeDeliverables (validate image magic → scan → upload → atomic changeset).
 *
 * Publication waiver (as of 2026-07-09): the checkbox is still a client-side submit
 * gate, but the ACKNOWLEDGED VERSION is now recorded. The client echoes the signed
 * render token minted by /context; this route verifies it, confirms it was minted
 * for THIS request, and passes the bound version id to the service, which pins it
 * on the deliverable row (wmkf_WaiverPolicyVersion + wmkf_waiverackedat).
 */

import Busboy from 'busboy';
import { verifyGranteeToken } from '../../../../../lib/external/verify-grantee-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { writeGranteeDeliverables, MAX_IMAGE_BYTES } from '../../../../../lib/services/grantee-upload';
import { verifyWaiverRenderToken } from '../../../../../lib/services/external-token';
import { WAIVER_SLOT_CODE } from '../../../../../lib/external/grantee-waiver-policy';
import { isGuid } from '../../../../../lib/utils/guid';
import NotificationService from '../../../../../lib/services/notification-service';
import { isGranteeEditableStatus } from '../../../../../shared/config/granteeDeliverableStatus';

/**
 * Best-effort operator alert when a grantee submit is blocked by a waiver-token
 * failure that looks suspicious (bad signature/claim, request mismatch, or a
 * malformed version) rather than plain client staleness. Carries the slot code so
 * a mis-seed / wrong-env / post-deploy breakage is visible, not silently blocking
 * grantees. Wrapped in a trusted DAL context so the admin-email path can send.
 */
async function alertWaiverBlock({ requestId, detail }) {
  try {
    await withDalContext('grantee-waiver-alert', () => NotificationService.notify({
      type: 'grantee_waiver_block',
      severity: 'warning',
      emailAdmins: true,
      autoResolveKey: `grantee_waiver_block:${WAIVER_SLOT_CODE}`,
      title: 'Grantee waiver submit blocked (fail-closed)',
      message:
        `A grantee submission was blocked because the ${WAIVER_SLOT_CODE} waiver render token `
        + `failed verification (${detail}). Confirm the slot is seeded + active and the portal `
        + `deploy matches the seeded environment.`,
      metadata: { requestId, slotCode: WAIVER_SLOT_CODE, detail },
      source: 'grantee-waiver',
      category: 'ops',
    }));
  } catch (err) {
    console.error('[grantee/submit] waiver-block alert failed (non-fatal):', err?.message || err);
  }
}

export const config = {
  api: { bodyParser: false }, // busboy needs the raw stream
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const token = req.query.token;
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }

    // S333 Stage 4b: trust-model tightening — this route now establishes
    // the trusted context itself (label byte-preserved from the wrap that
    // used to live inside verifyGranteeToken() itself).
    const verified = await withDalContext('grantee-token-verify', () => verifyGranteeToken(token));
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({ ok: false, reason: verified.reason });
    }

    const { request, deliverable } = verified;
    // Fail-closed editable-status guard. The ETag-conditional PATCH in the service
    // closes the TOCTOU window (a staff status change after this read → 412 → 409).
    if (!isGranteeEditableStatus(deliverable?.wmkf_deliverablestatus)) {
      return res.status(409).json({ ok: false, reason: 'not_editable' });
    }

    let parsed;
    try {
      parsed = await parseMultipart(req);
    } catch (e) {
      if (e.code === 'FILE_TOO_LARGE') return res.status(400).json({ ok: false, reason: 'image_too_large' });
      if (e.code === 'TOO_MANY_FILES') return res.status(400).json({ ok: false, reason: 'too_many_files' });
      return res.status(400).json({ ok: false, reason: 'bad_request' });
    }

    const editedAbstract = parsed.fields.editedAbstract || '';
    const caption = parsed.fields.caption || '';
    const imageFile = parsed.files[0] || null;

    // Verify the signed waiver render token → the exact version the grantee saw.
    // Fail closed: the version id comes from the VERIFIED payload (not raw input),
    // must be bound to THIS request, and must be a GUID before it reaches the
    // @odata.bind selector (check:trust-boundary-guid). A plain stale/expired token
    // just asks the grantee to reload; a suspicious failure also alerts operators.
    const waiver = await verifyWaiverRenderToken(parsed.fields.waiverToken || '');
    const waiverOk = waiver.valid
      && waiver.requestId === verified.requestId
      && isGuid(waiver.versionId);
    if (!waiverOk) {
      const clientStale = !waiver.valid && (waiver.reason === 'expired' || waiver.reason === 'no_token');
      if (!clientStale) {
        const detail = waiver.valid ? 'request_mismatch_or_bad_version' : waiver.reason;
        await alertWaiverBlock({ requestId: verified.requestId, detail });
      }
      return res.status(409).json({ ok: false, reason: 'waiver_invalid' });
    }

    const result = await withDalContext('grantee-submit', () =>
      writeGranteeDeliverables({
        request, deliverable, editedAbstract, caption, imageFile,
        waiverVersionId: waiver.versionId,
        waiverBodyHash: waiver.bodyHash,
      }));

    if (!result.ok) {
      // Generic, non-leaky reasons (service already logged specifics server-side).
      return res.status(result.status || 500).json({ ok: false, reason: result.reason });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[grantee/submit] unexpected error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

/**
 * Parse one image file + the text fields. Busboy caps: one file, image size cap,
 * bounded field size (the abstract is a few KB; 4KB would truncate it).
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fieldSize: 64 * 1024, fields: 5 },
      });
    } catch (e) {
      return reject(e);
    }

    const files = [];
    const fields = {};
    let aborted = false;

    busboy.on('file', (_fieldname, fileStream, info) => {
      if (aborted) { fileStream.resume(); return; }
      const chunks = [];
      fileStream.on('data', (chunk) => chunks.push(chunk));
      fileStream.on('limit', () => {
        aborted = true;
        const err = new Error('FILE_TOO_LARGE');
        err.code = 'FILE_TOO_LARGE';
        reject(err);
      });
      fileStream.on('end', () => {
        if (aborted) return;
        files.push({ filename: info.filename, buffer: Buffer.concat(chunks), mimeType: info.mimeType });
      });
    });

    busboy.on('filesLimit', () => {
      aborted = true;
      const err = new Error('TOO_MANY_FILES');
      err.code = 'TOO_MANY_FILES';
      reject(err);
    });

    busboy.on('field', (name, value) => { fields[name] = value; });
    busboy.on('error', reject);
    busboy.on('finish', () => { if (!aborted) resolve({ files, fields }); });

    req.pipe(busboy);
  });
}
