/**
 * POST /api/review-manager/upload-review
 *
 * Staff path for landing a completed review on the canonical suggestion row.
 * Shares the same core (`writeReviewFiles`) as the public token-authenticated
 * endpoint so the two flows can never drift on validation, file layout, or
 * Dataverse writes.
 *
 * Multipart body:
 *   - suggestionId           (string)  required
 *   - files                  (file[])  1..5
 *   - affiliation            (string)  required (review form field)
 *   - impact, risk, overallRating  (numeric strings)  required
 *
 * Replaces the previous Vercel Blob path; the legacy fallback was retired
 * 2026-05-03 (zero rows still pointing at Blob storage in prod).
 */

import Busboy from 'busboy';
import { requireAppAccess } from '../../../lib/utils/auth';
import { writeReviewFiles } from '../../../lib/services/review-upload';
import { respondForFailedReviewUpload } from '../../../lib/utils/review-upload-response';
import { withDalContext } from '../../../lib/dataverse/core/context';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 5;

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  try {
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
    const suggestionId = fields.suggestionId;
    if (!suggestionId) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId is required.'] });
    }
    if (files.length === 0) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['At least one file is required.'] });
    }

    // The shared core revalidates the structured fields against the schema;
    // strip the suggestionId before passing through so it isn't treated as
    // form data.
    const { suggestionId: _ignored, ...structuredData } = fields;

    const result = await withDalContext('review-manager-upload', () =>
      writeReviewFiles({
        suggestionId,
        files,
        structuredData,
        opts: {
          source: 'staff_upload',
          performedBy: access.profileId,
          actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
        },
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
  } catch (error) {
    console.error('[review-manager upload-review] error:', error);
    return res.status(500).json({
      ok: false,
      reason: 'server_error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fieldSize: 4096, fields: 50 },
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
