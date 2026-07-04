/**
 * POST /api/external/review/[token]/upload
 *
 * Multipart form-data: 1..5 files plus structured form fields. Token
 * verification gives us the suggestion id; everything else (file
 * validation, SharePoint write, Dataverse PATCH, rollback) goes through
 * the shared `writeReviewFiles` core so the staff and self-serve paths
 * can never drift.
 */

import Busboy from 'busboy';
import { verifySuggestionToken, tokenHasOp } from '../../../../../lib/external/verify-suggestion-token';
import { writeReviewFiles } from '../../../../../lib/services/review-upload';
import { respondForFailedReviewUpload } from '../../../../../lib/utils/review-upload-response';
import { bypassDynamicsRestrictions } from '../../../../../lib/services/dynamics-context';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 5;

export const config = {
  api: {
    bodyParser: false, // busboy needs the raw stream
  },
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
    const verified = await verifySuggestionToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({
        ok: false,
        reason: verified.reason,
      });
    }

    // Fail closed on the token's ops claim: a token minted without
    // 'upload_review' (or with a missing/malformed ops array) must not be able
    // to write a review file, even if the row/hash/expiry checks above passed.
    if (!tokenHasOp(verified, 'upload_review')) {
      return res.status(403).json({ ok: false, reason: 'op_not_permitted' });
    }

    // Finality guard (Codex P0-1): the reviewer-token upload path is hidden from
    // the Phase-2 UI but still reachable directly. A submitted review is final —
    // refuse a reviewer-token (self-serve) upload once wmkf_reviewreceivedat is
    // set, so the legacy file path can't overwrite a completed in-browser review.
    // The staff path (staff_upload, a different route) is unaffected.
    if (verified.suggestion.wmkf_reviewreceivedat) {
      return res.status(409).json({
        ok: false,
        reason: 'review_received_locked',
        message: 'This review has already been submitted. To make a change, please contact your Program Director.',
      });
    }

    let parsed;
    try {
      parsed = await parseMultipart(req);
    } catch (e) {
      if (e.code === 'FILE_TOO_LARGE') {
        return res.status(413).json({
          ok: false,
          reason: 'file_too_large',
          errors: [`Each file must be under ${MAX_FILE_BYTES / 1024 / 1024} MB.`],
        });
      }
      if (e.code === 'TOO_MANY_FILES') {
        return res.status(413).json({
          ok: false,
          reason: 'too_many_files',
          errors: [`Max ${MAX_FILES} files per upload.`],
        });
      }
      throw e;
    }

    const { files, fields } = parsed;
    if (files.length === 0) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['At least one file is required.'] });
    }

    const result = await bypassDynamicsRestrictions('external-upload', () =>
      writeReviewFiles({
        suggestionId: verified.suggestion.wmkf_appreviewersuggestionid,
        files,
        structuredData: fields,
        opts: { source: 'reviewer_self_token', performedBy: null },
      }),
    );

    if (!result.ok) {
      return respondForFailedReviewUpload(res, result);
    }

    return res.status(200).json({
      ok: true,
      folder: result.folder,
      files: result.files.map(f => ({ name: f.name, size: f.size })),
    });
  } catch (e) {
    console.error('[external upload] error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

/**
 * Stream-parse multipart/form-data into in-memory file Buffers + scalar fields.
 * Caps enforced here:
 *   - per-file size (busboy's `limits.fileSize`)
 *   - total file count (`limits.files`)
 *
 * `writeReviewFiles` re-validates magic bytes and counts as a defense in
 * depth — the parser caps are about not buffering attacker-sized payloads
 * into memory in the first place.
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: {
          fileSize: MAX_FILE_BYTES,
          files: MAX_FILES,
          fieldSize: 4096,
          fields: 50,
        },
      });
    } catch (e) {
      return reject(e);
    }

    const files = [];
    const fields = {};
    let aborted = false;

    busboy.on('file', (_fieldname, fileStream, info) => {
      if (aborted) {
        fileStream.resume();
        return;
      }
      const chunks = [];
      let truncated = false;
      fileStream.on('data', chunk => chunks.push(chunk));
      fileStream.on('limit', () => {
        truncated = true;
        aborted = true;
        const err = new Error('FILE_TOO_LARGE');
        err.code = 'FILE_TOO_LARGE';
        reject(err);
      });
      fileStream.on('end', () => {
        if (aborted || truncated) return;
        files.push({
          filename: info.filename,
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
        });
      });
    });

    busboy.on('filesLimit', () => {
      aborted = true;
      const err = new Error('TOO_MANY_FILES');
      err.code = 'TOO_MANY_FILES';
      reject(err);
    });

    busboy.on('field', (name, value) => {
      // Coerce numeric picklist strings to numbers; review-form-schema also
      // tolerates strings, but we normalize here to keep the shape clean.
      const numeric = Number(value);
      fields[name] = value !== '' && !Number.isNaN(numeric) && /^-?\d+$/.test(value)
        ? numeric
        : value;
    });

    busboy.on('error', reject);
    busboy.on('finish', () => {
      if (aborted) return;
      resolve({ files, fields });
    });

    req.pipe(busboy);
  });
}
