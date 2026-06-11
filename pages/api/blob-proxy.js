/**
 * API Route: /api/blob-proxy
 *
 * Authenticated proxy for Vercel Blob URLs. Forces a session cookie before
 * serving content that lives on Vercel's "public" blob CDN — without this,
 * a leaked blob URL would be readable from anywhere on the internet.
 *
 * Intended scope: shared organizational assets (review-email templates and
 * additional cycle attachments configured via `/api/reviewer-finder/grant-cycles`,
 * surfaced through `proxifyBlobUrl` in `lib/utils/blob-proxy.js`). These are
 * staff-wide, not user-owned. The host allowlist is the security boundary;
 * there is intentionally no per-record ownership check.
 *
 * Do NOT extend this proxy to serve user-owned blobs. Per-user data should go
 * through a dedicated, scoped endpoint (see `/api/review-manager/download-review`
 * for the record-aware pattern). If a future caller needs scoped blob access,
 * add a route that resolves blob URL → owning record → caller permission and
 * stream from there, instead of expanding this generic proxy.
 *
 * GET /api/blob-proxy?url={encoded-blob-url}
 */

import { requireAuth } from '../../lib/utils/auth';

// Valid Vercel Blob hostname pattern
const BLOB_HOST_PATTERN = /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication
  const session = await requireAuth(req, res);
  if (!session) return;

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url parameter is required' });
  }

  // Validate the URL is a legitimate Vercel Blob URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (parsedUrl.protocol !== 'https:' || !BLOB_HOST_PATTERN.test(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'URL is not a valid Vercel Blob URL' });
  }

  try {
    const blobResponse = await fetch(url);

    if (!blobResponse.ok) {
      return res.status(blobResponse.status).json({
        error: `Blob fetch failed: ${blobResponse.statusText}`
      });
    }

    // Forward content headers
    const contentType = blobResponse.headers.get('content-type');
    const contentDisposition = blobResponse.headers.get('content-disposition');
    const contentLength = blobResponse.headers.get('content-length');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // A blob stored as text/html or image/svg+xml would execute script under
    // our origin if a leaked-then-authenticated proxy URL were opened inline.
    // Force download for inline-renderable types; honor the upstream
    // disposition otherwise. Always send nosniff so the browser cannot
    // MIME-sniff a declared-safe type into an executable one. (These blobs are
    // email templates / attachments — downloaded, never inline media.)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const RENDERABLE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/i;
    if (contentType && RENDERABLE.test(contentType)) {
      res.setHeader('Content-Disposition', 'attachment');
    } else if (contentDisposition) {
      res.setHeader('Content-Disposition', contentDisposition);
    }

    // Cache for 5 minutes (authenticated users only)
    res.setHeader('Cache-Control', 'private, max-age=300');

    // Stream the response body. res.send of a fetched buffer is the intended
    // behavior for a binary blob proxy; nosniff + forced-download (above)
    // neutralize the inline-XSS vector Semgrep flags here.
    const buffer = await blobResponse.arrayBuffer();
    // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Blob proxy error:', error);
    return res.status(502).json({ error: 'Failed to fetch blob content' });
  }
}
