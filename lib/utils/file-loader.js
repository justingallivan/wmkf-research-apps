/**
 * Shared document loader for FileRef objects used across multiple Dynamics-
 * integrated apps (Grant Reporting, Phase I Summary with writeback, etc.).
 *
 * FileRef shapes:
 *   { source: "upload",     fileUrl, filename, pathname?, access? }
 *   { source: "sharepoint", library, folder, filename }
 *
 * Upload refs: a legacy ref carries only `fileUrl` (a public blob URL, fetched
 * directly). A Phase-1 private ref carries `access: "private"` + `pathname` and
 * is read server-side from the private store. Both go through the shared
 * `readUploadedBlobBuffer` helper, so consumers flip to private by passing
 * `access`/`pathname` from the uploader descriptor — no change here per consumer.
 *
 * Throws HTTP-tagged errors (err.status) on validation / parse failure so
 * API handlers can surface them cleanly.
 */

import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { readUploadedBlobBuffer } from './uploaded-blob.js';
import { GraphService } from '../services/graph-service.js';
import { BASE_CONFIG } from '../../shared/config/baseConfig.js';

const MAX_TEXT_LENGTH = BASE_CONFIG?.FILE_PROCESSING?.MAX_TEXT_LENGTH || 1_000_000;

// Hard cap on raw buffer size before we hand it to pdf-parse / mammoth.
// Defense against zip-bombs, malformed PDFs, and pathological DOCX files —
// if we ever see a legitimate document above this threshold the cap can be
// raised, but the upstream API routes all enforce 1–10 MB body caps so any
// buffer this large signals something abnormal.
const MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB

// Timeout for the text-extraction step. PDF parsers in particular can stall
// on malformed input; without this, a single bad file could tie up a serverless
// function until the platform kills it.
const PARSE_TIMEOUT_MS = 30_000;

const ALLOWED_SOURCES = new Set(['upload', 'sharepoint']);

export async function loadFile(ref) {
  if (!ref || typeof ref !== 'object') {
    throw httpError(400, 'Invalid file reference');
  }
  if (!ALLOWED_SOURCES.has(ref.source)) {
    throw httpError(400, `Unsupported file source: ${String(ref.source)}`);
  }

  let buffer;
  let filename;
  let mimeType = null;

  if (ref.source === 'upload') {
    if (!ref.filename) {
      throw httpError(400, 'Upload file reference requires a filename');
    }
    if (!ref.fileUrl && !ref.pathname) {
      throw httpError(400, 'Upload file reference requires fileUrl (public) or pathname (private)');
    }
    try {
      buffer = await readUploadedBlobBuffer({
        access: ref.access,
        pathname: ref.pathname,
        url: ref.fileUrl,
      });
    } catch (e) {
      // A missing private-store token is a server misconfiguration (the helper
      // fails closed) → 503; anything else (not-found, fetch failure) is a 400,
      // matching the legacy upload-fetch behavior.
      const status = /UPLOADS_BLOB_RW_TOKEN/.test(e.message || '') ? 503 : 400;
      throw httpError(status, `Failed to read uploaded file: ${e.message}`);
    }
    filename = ref.filename;
  } else {
    // sharepoint
    if (!ref.library || !ref.folder || !ref.filename) {
      throw httpError(400, 'SharePoint file reference requires library, folder, and filename');
    }
    const downloaded = await GraphService.downloadFileByPath(ref.library, ref.folder, ref.filename);
    buffer = downloaded.buffer;
    filename = downloaded.filename || ref.filename;
    mimeType = downloaded.mimeType;
  }

  if (buffer.length > MAX_BUFFER_BYTES) {
    throw httpError(
      413,
      `${filename}: file is too large to parse (${buffer.length} bytes > ${MAX_BUFFER_BYTES})`,
    );
  }

  const text = await extractTextFromBuffer(buffer, filename, mimeType);

  if (!text || text.trim().length < 100) {
    throw httpError(400, `${filename}: file appears to be empty or contains insufficient text`);
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw httpError(
      413,
      `${filename}: extracted text exceeds maximum size (${text.length} > ${MAX_TEXT_LENGTH} chars)`,
    );
  }

  return { text: text.trim(), filename };
}

export async function extractTextFromBuffer(buffer, filename, mimeType) {
  const lower = (filename || '').toLowerCase();
  const isPdf = lower.endsWith('.pdf') || mimeType === 'application/pdf';
  const isDocx =
    lower.endsWith('.docx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isDoc = lower.endsWith('.doc') || mimeType === 'application/msword';

  if (isPdf) {
    const data = await withTimeout(pdf(buffer), PARSE_TIMEOUT_MS, filename, 'PDF');
    return data.text || '';
  }
  if (isDocx || isDoc) {
    const result = await withTimeout(
      mammoth.extractRawText({ buffer }),
      PARSE_TIMEOUT_MS,
      filename,
      'DOCX',
    );
    return result.value || '';
  }
  throw httpError(400, `Unsupported file type for "${filename}". Use PDF, DOCX, or DOC.`);
}

// pdf-parse and mammoth don't expose AbortController hooks, so we race them
// against a timer. On timeout the parser keeps running in the background until
// GC — not ideal, but bounded by the serverless function's own max duration.
function withTimeout(promise, ms, filename, kind) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(httpError(408, `${filename}: ${kind} parsing exceeded ${ms}ms timeout`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
