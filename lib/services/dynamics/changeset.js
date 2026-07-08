// @ts-check
/**
 * DynamicsService decomposition — Stage 7 module (Checkpoint D, atomic $batch).
 *
 * Moved verbatim from lib/services/dynamics-service.js: the atomic multi-row
 * write cluster — the public `executeChangeset` plus the module-private
 * `$batch` builders/parsers (`BATCH_CRLF`, `buildChangesetOp`,
 * `buildChangesetBatchBody`, `extractBoundary`, `splitHeadersAndBody`,
 * `splitMultipart`, `parseEmbeddedHttp`, `collectHttpParts`,
 * `parseBatchResponse`). This is the highest-risk cluster: a subtle parser
 * drift would corrupt durable state silently (the reviewer submit flow writes
 * answer-snapshot child rows + the parent PATCH in one transaction here).
 *
 * `executeChangeset` gains the C1 svc-dispatch rewrite (`this.` → `svc.`) so
 * `svc.getAccessToken` / `svc._withCallerId` / `svc._writeFetch` still route
 * through the facade and its test spies. The 8 helpers carry no `this`, so they
 * move byte-for-byte as module-private functions (not exported).
 *
 * Load-bearing invariants preserved byte-identically (C11):
 *   - input validation runs BEFORE `assertTrustedDalContext` (C2) so malformed-
 *     input rejections keep their specific messages regardless of context;
 *   - the `failed`-op status is preferred over the outer HTTP status for precise
 *     412/400/409 classification;
 *   - the `allConfirmed` under-count guard THROWS rather than returning `ok` on
 *     an unprovable atomic commit (guards the parser itself, not just Dataverse);
 *   - Content-ID = 1-based index; CRLF request-body construction;
 *   - embedded response headers (`OData-EntityId`) are intentionally NOT
 *     surfaced — callers address rows by GUID / alternate key.
 *
 * Deps: crypto (`randomUUID`), dynamics-context (`assertTrustedDalContext`),
 * service-error (`buildServiceError`). `executeChangeset` reaches the network
 * via `svc._writeFetch` (not a direct http import) so the impersonation
 * fallback stays shared with the single-write path.
 */

import { randomUUID } from 'crypto';
import { assertTrustedDalContext } from '../dynamics-context.js';
import { buildServiceError } from '../../utils/service-error.js';

/**
 * The DynamicsService facade receiver (C1 svc-dispatch). Typed `any` here on
 * purpose: the facade's own typed coverage is deferred to the decomposition's
 * facade-finalize checkpoint. See docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md.
 * @typedef {any} Svc
 */

// Dataverse $batch wrapping a SINGLE changeset commits every operation or none
// of them — verified in prod, S301 (scripts/probe-dataverse-batch-changeset.mjs:
// multi-op commit + atomic rollback + per-op If-Match all confirmed). The
// reviewer submit flow uses this to write the answer-snapshot child rows and
// the parent PATCH in one transaction. This REFUTES the older "Dataverse has no
// $batch transaction" belief carried in pages/api/admin/prompts/[name].js — that
// flow's non-atomic mirror predates this verification.

/**
 * Execute several create/update/delete operations in ONE atomic Dataverse
 * changeset. Either every operation commits or none do (all-or-nothing).
 *
 * @param {Svc} svc
 * @param {Array<{method:'POST'|'PATCH'|'DELETE', url:string, body?:object, ifMatch?:string}>} operations
 *   Ordered list (Content-ID = 1-based index). `url` is a resource path
 *   relative to the v9.2 data root with NO leading slash — e.g.
 *   `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=<g>,wmkf_questionkey='q2')`
 *   (alternate-key upsert) or `akoya_requests(<guid>)`. POST/PATCH must carry a
 *   `body`; `ifMatch` adds a per-op `If-Match` precondition (412 if the row
 *   changed since it was read). Build URLs server-side — this helper does not
 *   GUID-validate them.
 * @param {object} [options]
 * @param {string} [options.actingUserSystemId] - MSCRMCallerID attribution for
 *   every op in the batch (same privilege-intersection fallback as single
 *   writes). Null/omitted for external-token flows (e.g. reviewer submit).
 * @returns {Promise<{ ok: true, operations: Array<{contentId:number|null, status:number, body:object|null}> }>}
 *   `body` is the parsed JSON op body when present (Dataverse create/PATCH ops
 *   in a changeset typically return 204 No Content, so `body` is usually null).
 *   This helper does NOT surface embedded response headers, so created-row IDs
 *   (`OData-EntityId`) are intentionally NOT returned — callers must address
 *   rows by GUID or alternate key they already hold, not by created-id
 *   read-back (the reviewer submit upserts answer rows by alternate key).
 * @throws {Error} structured service-error (buildServiceError shape) when the
 *   changeset is rejected OR when the parser cannot confirm a 2xx result for
 *   every op (fail-closed) — because the changeset is atomic, a throw means
 *   NOTHING was committed. `.status` is the failing op's HTTP status, so callers
 *   branch on 412 (If-Match conflict) exactly as they do for updateRecord/deleteRecord.
 */
export async function executeChangeset(svc, operations, { actingUserSystemId } = {}) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('executeChangeset: operations must be a non-empty array');
  }
  const ALLOWED_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
  operations.forEach((op, i) => {
    if (!op || !ALLOWED_METHODS.has(op.method)) {
      throw new Error(`executeChangeset: operations[${i}].method must be one of POST/PATCH/DELETE`);
    }
    if (!op.url || typeof op.url !== 'string') {
      throw new Error(`executeChangeset: operations[${i}].url is required`);
    }
    if ((op.method === 'POST' || op.method === 'PATCH') && (op.body === undefined || op.body === null)) {
      throw new Error(`executeChangeset: operations[${i}] (${op.method}) requires a body`);
    }
  });
  // Enforcement runs AFTER input validation (above) so malformed-input
  // rejections keep their existing, more specific messages regardless of
  // context — only a well-formed changeset needs a trusted context to run.
  assertTrustedDalContext('DynamicsService.executeChangeset');

  const token = await svc.getAccessToken();
  const baseUrl = `${process.env.DYNAMICS_URL}/api/data/v9.2`;
  const batchId = randomUUID();
  const batchBoundary = `batch_${batchId}`;
  const changesetBoundary = `changeset_${batchId}`;
  const body = buildChangesetBatchBody(operations, batchBoundary, changesetBoundary, baseUrl);

  const headers = svc._withCallerId({
    Authorization: `Bearer ${token}`,
    'OData-Version': '4.0',
    'OData-MaxVersion': '4.0',
    Accept: 'application/json',
    'Content-Type': `multipart/mixed; boundary=${batchBoundary}`,
  }, actingUserSystemId);

  const resp = await svc._writeFetch(`${baseUrl}/$batch`, {
    method: 'POST',
    headers,
    body,
  }, actingUserSystemId);

  const rawText = await resp.text();
  const contentType = resp.headers?.get ? resp.headers.get('content-type') : null;
  const parsed = parseBatchResponse(rawText, contentType);

  // The changeset is atomic, so a single failed embedded op == the whole batch
  // rolled back. Prefer the embedded status/body for precise 412/400/409
  // classification; fall back to the outer HTTP status when Dataverse returns a
  // bare (non-multipart) error envelope.
  const failed = parsed.find((p) => p.status >= 400);
  if (failed || !resp.ok) {
    const status = failed ? failed.status : resp.status;
    const errBody = failed ? failed.rawBody : rawText;
    throw buildServiceError('dataverse', { status }, errBody);
  }

  // Fail closed: a multipart success response MUST yield exactly one parsed 2xx
  // result per requested op. If the parser under-counts (skipped an unsplittable
  // part), or yields a non-2xx / unparseable status (status 0) that the `failed`
  // scan above didn't catch, we cannot prove the changeset committed — throw
  // rather than return ok and let the caller do post-commit work (e.g. delete
  // the reviewer draft) on an unconfirmed write. This guards the parser itself,
  // not just Dataverse's response.
  const allConfirmed =
    parsed.length === operations.length &&
    parsed.every((p) => p.status >= 200 && p.status < 300);
  if (!allConfirmed) {
    const statuses = parsed.map((p) => p.status).join(', ') || 'none';
    throw buildServiceError(
      'dataverse',
      { status: resp.status },
      `executeChangeset could not confirm an atomic commit: parsed ${parsed.length} of ` +
        `${operations.length} op result(s) [statuses: ${statuses}]. Raw response (truncated): ` +
        rawText.slice(0, 500),
    );
  }

  return {
    ok: true,
    operations: parsed.map((p) => ({ contentId: p.contentId, status: p.status, body: p.body })),
  };
}

// ───────── $batch changeset builders + response parser ─────────
//
// Adapted from the proven body builder in scripts/probe-dataverse-batch-changeset.mjs
// (the S301 feasibility spike). The request half is byte-for-byte the spike's
// shape; the response parser is net-new (the spike only regex-scanned status
// lines — executeChangeset needs per-op Content-ID + body for structured errors).

const BATCH_CRLF = '\r\n';

/**
 * Build one embedded operation (an application/http MIME part) inside a changeset.
 * @param {{ url: string, method: string, ifMatch?: string, body?: any }} op
 * @param {string} changesetBoundary
 * @param {string} baseUrl
 * @param {number} contentId
 */
function buildChangesetOp(op, changesetBoundary, baseUrl, contentId) {
  const lines = [];
  lines.push(`--${changesetBoundary}`);
  lines.push('Content-Type: application/http');
  lines.push('Content-Transfer-Encoding: binary');
  lines.push(`Content-ID: ${contentId}`);
  lines.push(''); // blank line before the embedded request
  const url = op.url.startsWith('http') ? op.url : `${baseUrl}/${op.url}`;
  lines.push(`${op.method} ${url} HTTP/1.1`);
  lines.push('OData-Version: 4.0');
  lines.push('Accept: application/json');
  if (op.ifMatch) lines.push(`If-Match: ${op.ifMatch}`);
  if (op.body !== undefined && op.body !== null) {
    lines.push('Content-Type: application/json');
    lines.push('');
    lines.push(JSON.stringify(op.body));
  } else {
    lines.push('');
  }
  return lines.join(BATCH_CRLF);
}

/**
 * Build the full multipart/mixed $batch body wrapping a single changeset of ops.
 * @param {Array<{ url: string, method: string, ifMatch?: string, body?: any }>} operations
 * @param {string} batchBoundary
 * @param {string} changesetBoundary
 * @param {string} baseUrl
 */
function buildChangesetBatchBody(operations, batchBoundary, changesetBoundary, baseUrl) {
  const parts = [];
  parts.push(`--${batchBoundary}`);
  parts.push(`Content-Type: multipart/mixed; boundary=${changesetBoundary}`);
  parts.push(''); // blank line before the changeset
  operations.forEach((op, i) => parts.push(buildChangesetOp(op, changesetBoundary, baseUrl, i + 1)));
  parts.push(`--${changesetBoundary}--`);
  parts.push(`--${batchBoundary}--`);
  parts.push('');
  return parts.join(BATCH_CRLF);
}

/**
 * Pull the multipart boundary token out of a Content-Type header value.
 * @param {string|null|undefined} contentType
 */
function extractBoundary(contentType) {
  if (!contentType) return null;
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  return m ? m[1].trim() : null;
}

/**
 * Split a string at its first blank line (the MIME header/body separator),
 * tolerant of CRLF or LF endings. Returns { headers, body } or null if there is
 * no blank-line separator.
 * @param {string} text
 */
function splitHeadersAndBody(text) {
  const m = text.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) return null;
  return { headers: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

/**
 * Split a multipart body into its constituent part strings (each part's MIME
 * headers + content), dropping the preamble, the closing `--boundary--`, and any
 * epilogue. Tolerant of CRLF or LF line endings from the wire.
 * @param {string} body
 * @param {string} boundary
 */
function splitMultipart(body, boundary) {
  const segments = body.split(`--${boundary}`);
  const parts = [];
  for (const seg of segments) {
    const stripped = seg.replace(/^\r?\n/, '');
    if (stripped.startsWith('--')) continue; // closing boundary marker
    if (!stripped.trim()) continue;          // preamble / blank
    parts.push(stripped);
  }
  return parts;
}

/**
 * Parse one embedded `application/http` response body into { status, body,
 * rawBody }. Shape: "HTTP/1.1 <status> <reason>\r\n<headers>\r\n\r\n<body>".
 * Embedded response headers (e.g. OData-EntityId on a create) are intentionally
 * NOT surfaced — see executeChangeset's JSDoc: callers identify rows by
 * alternate key, not by created-id read-back.
 * @param {string} text
 */
function parseEmbeddedHttp(text) {
  const statusMatch = text.match(/^HTTP\/1\.1\s+(\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const split = splitHeadersAndBody(text);
  const rawBody = split ? split.body.trim() : '';
  let body = null;
  if (rawBody) {
    try { body = JSON.parse(rawBody); } catch { /* non-JSON op body */ }
  }
  return { status, rawBody, body };
}

/**
 * Recursively walk the nested multipart structure, collecting every embedded HTTP op result.
 * @param {string} body
 * @param {string} boundary
 * @param {Array<{ contentId: number|null, status: number, body: any, rawBody: string }>} results
 */
function collectHttpParts(body, boundary, results) {
  for (const part of splitMultipart(body, boundary)) {
    const split = splitHeadersAndBody(part);
    if (!split) continue;
    const { headers: partHeaders, body: partBody } = split;
    const ctMatch = partHeaders.match(/Content-Type:\s*([^\r\n]+)/i);
    const ct = ctMatch ? ctMatch[1].trim() : '';
    const ctType = ct.toLowerCase(); // compare the MIME type case-insensitively…
    if (ctType.startsWith('multipart/mixed')) {
      const inner = extractBoundary(ct); // …but extract the boundary from the original (boundaries are case-sensitive)
      if (inner) collectHttpParts(partBody, inner, results);
    } else if (ctType.startsWith('application/http')) {
      const cidMatch = partHeaders.match(/Content-ID:\s*(\d+)/i);
      const contentId = cidMatch ? Number(cidMatch[1]) : null;
      results.push({ contentId, ...parseEmbeddedHttp(partBody) });
    }
  }
}

/**
 * Parse a Dataverse $batch response (batchresponse → changesetresponse →
 * application/http) into a flat per-op list. Returns [] when the response is not
 * multipart (Dataverse sometimes returns a bare JSON error for a rejected
 * changeset) — executeChangeset then falls back to the outer HTTP status.
 *
 * @param {string} rawText
 * @param {string|null|undefined} contentType
 * @returns {Array<{ contentId:number|null, status:number, body:object|null, rawBody:string }>}
 */
function parseBatchResponse(rawText, contentType) {
  const boundary = extractBoundary(contentType);
  if (!boundary || !rawText) return [];
  /** @type {Array<{ contentId: number|null, status: number, body: any, rawBody: string }>} */
  const results = [];
  collectHttpParts(rawText, boundary, results);
  return results;
}
