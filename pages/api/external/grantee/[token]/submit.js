/**
 * POST /api/external/grantee/[token]/submit
 *
 * Chunk 5 of the Grantee Deliverables Portal — the grantee returns the edited
 * abstract + a graphical image + caption. Public, token-authed (NOT app-authed);
 * parallel grantee variant of the reviewer upload route.
 *
 * Order (fail-fast): method → rate-limit → verify token (aud:'grantee') → record
 * outcome → editable-status guard → parse multipart → writeGranteeDeliverables
 * (validate image magic → scan → upload → ETag-conditional PATCH + rollback).
 *
 * The publish-image waiver is a client-side submit gate (chunk 4) — nothing about
 * it is sent or persisted; a submitted package IS the consent record.
 */

import Busboy from 'busboy';
import { verifyGranteeToken } from '../../../../../lib/external/verify-grantee-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { bypassDynamicsRestrictions } from '../../../../../lib/services/dynamics-context';
import { writeGranteeDeliverables, MAX_IMAGE_BYTES } from '../../../../../lib/services/grantee-upload';
import { isGranteeEditableStatus } from '../../../../../shared/config/granteeDeliverableStatus';

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

    const verified = await verifyGranteeToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({ ok: false, reason: verified.reason });
    }

    const { request } = verified;
    // Fail-closed editable-status guard. The ETag-conditional PATCH in the service
    // closes the TOCTOU window (a staff status change after this read → 412 → 409).
    if (!isGranteeEditableStatus(request.wmkf_granteedeliverablestatus)) {
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

    const result = await bypassDynamicsRestrictions('grantee-submit', () =>
      writeGranteeDeliverables({ request, editedAbstract, caption, imageFile }));

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
