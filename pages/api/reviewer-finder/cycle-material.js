/**
 * GET /api/reviewer-finder/cycle-material?cycleId=<guid>&pathname=<blob-pathname>
 *
 * Authenticated, RECORD-SCOPED download proxy for a grant cycle's PRIVATE blob
 * materials (review-email template + additional attachments) — Phase 1
 * private-blob migration. This is the record-aware proxy the org-asset
 * `pages/api/blob-proxy.js` header points to: it does NOT serve arbitrary
 * pathnames. The requested `pathname` must actually belong to the named cycle
 * (its template or one of its attachments), so an authenticated reviewer-finder
 * user can only read a material attached to a cycle they can see — not any
 * private blob whose pathname they happen to know.
 *
 * Why a new route (not blob-proxy): `blob-proxy.js` is auth-only + host-allowlist
 * over the PUBLIC store, explicitly "do NOT extend to user-owned blobs." Private
 * cycle materials live in the dedicated `wmkf-uploads-private` store and have no
 * auth-free URL, so they are read server-side by pathname via the shared
 * `readUploadedBlobBuffer` helper (fail-closed if the store token is unset).
 *
 * Back-compat: legacy cycles store a PUBLIC https blob URL in
 * `reviewTemplateBlobUrl` / attachment `blobUrl`; those keep rendering through
 * `blob-proxy.js` and are NOT served here. Only private refs (a bare pathname +
 * `access:'private'`) route to this proxy.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { findById } from '../../../lib/services/grant-cycles-dataverse';
import { readUploadedBlobBuffer } from '../../../lib/utils/uploaded-blob';

// A private ref is a bare blob pathname; a legacy/public ref is an http(s) URL.
function isPrivatePathname(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const lower = value.toLowerCase();
  return !lower.startsWith('http://') && !lower.startsWith('https://');
}

// Collect the cycle's private materials as pathname → { filename }. This is the
// record-scope allowlist: only these pathnames may be served for this cycle.
function privateMaterialsOf(cycle) {
  const map = new Map();
  if (isPrivatePathname(cycle?.reviewTemplateBlobUrl)) {
    map.set(cycle.reviewTemplateBlobUrl, { filename: cycle.reviewTemplateFilename || 'review-template' });
  }
  const atts = Array.isArray(cycle?.additionalAttachments) ? cycle.additionalAttachments : [];
  for (const att of atts) {
    if (att && att.access === 'private' && typeof att.pathname === 'string' && att.pathname) {
      map.set(att.pathname, { filename: att.filename || 'attachment' });
    }
  }
  return map;
}

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function contentTypeFor(filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function sanitizeFilename(name) {
  // \x22 is the double-quote char; written as a hex escape so no literal `"`
  // appears in source ahead of the handler (a stray quote here would pair with
  // the `filename="…"` quote below and hide this file's requireAppAccess call
  // from the comment/string-stripping endpoint counter — see check-fact-consistency).
  return String(name || 'download').replace(/[\x22\r\n]/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const { cycleId, pathname } = req.query;
  if (!cycleId || typeof cycleId !== 'string') {
    return res.status(400).json({ error: 'cycleId is required' });
  }
  if (!pathname || typeof pathname !== 'string') {
    return res.status(400).json({ error: 'pathname is required' });
  }

  let cycle;
  try {
    cycle = await findById(cycleId);
  } catch (e) {
    console.error('[cycle-material] cycle lookup failed:', e);
    return res.status(500).json({ error: 'Failed to resolve grant cycle' });
  }
  if (!cycle) {
    return res.status(404).json({ error: 'Grant cycle not found' });
  }

  // RECORD-SCOPE: the pathname must belong to this cycle. A miss is a 404 (do not
  // distinguish "not a material of this cycle" from "no such blob" — no leak).
  const allowed = privateMaterialsOf(cycle);
  const material = allowed.get(pathname);
  if (!material) {
    return res.status(404).json({ error: 'Material not found for this cycle' });
  }

  let buffer;
  try {
    buffer = await readUploadedBlobBuffer({ access: 'private', pathname });
  } catch (e) {
    // Missing private-store token is a server misconfiguration (helper fails
    // closed) → 503; anything else (not-found, read failure) → 404.
    const status = /UPLOADS_BLOB_RW_TOKEN/.test(e.message || '') ? 503 : 404;
    console.error('[cycle-material] private read failed:', e);
    return res.status(status).json({ error: 'Failed to read cycle material' });
  }

  res.setHeader('Content-Type', contentTypeFor(material.filename));
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(material.filename)}"`);
  res.setHeader('Content-Length', buffer.length);
  // A material stored as an inline-renderable type could execute script under our
  // origin if opened inline; force download + nosniff (the cited download-review.js
  // pattern omits nosniff, so it is pinned here by a test).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(buffer);
}

export const config = {
  api: { responseLimit: '60mb' },
};
