/**
 * Dataverse Power Tools — Track B — POST /api/dataverse-export/run
 *
 * The ONE retrieval path (build plan §5/§12). Body = the `resultToken` from
 * /preview (the stateless confirm gate — serverless has no shared state, so
 * the signed token IS the gate; /run executes the token's embedded spec, not
 * the request body). One SSE invocation: re-validate → resolve operational
 * labels live → backoff-hardened FetchXML paging → disclosure → workbook →
 * PRIVATE Vercel Blob → terminal {ready, downloadUrl, expiresInSec, bytes}.
 *
 * downloadUrl is the authenticated /download proxy (requireAppAccess + a
 * short-lived signed token), NOT a permanent public Blob URL (Codex S160
 * P1). Loud truncation; a terminal error writes NO Blob. The paging budget
 * is clamped to leave route headroom for count+build+upload (Codex S160 P1).
 */

import { put } from '@vercel/blob';
import { requireAppAccess } from '../../../lib/utils/auth';
import { compile, validateQuerySpec } from '../../../lib/services/dataverse-export/compiler';
import {
  fetchXmlAll, fetchXmlAggregateCount, FetchXmlError,
} from '../../../lib/services/dataverse-export/fetch-client';
import { testRequestIsolationEnabled } from '../../../lib/services/test-requests/isolation.js';
import { annotate } from '../../../lib/services/dataverse-export/disclosure';
import { buildWorkbook, WorkbookError } from '../../../lib/services/dataverse-export/workbook';
import { verifyResultToken, mintDownloadToken } from '../../../lib/services/dataverse-export/result-token';
import { fetchLiveTaxonomy, buildResolver } from '../../../lib/services/dataverse-export/live-taxonomy';

const ENTITY_SET = 'akoya_requests';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ROUTE_BUDGET_MS = 300_000; // Vercel maxDuration ceiling
const RESERVE_MS = 50_000; // headroom: count + workbook build + Blob upload
const MIN_PAGING_MS = 20_000; // floor — below this, don't even start paging

export const config = {
  api: { bodyParser: { sizeLimit: '256kb' }, responseLimit: false, externalResolver: true },
  maxDuration: 300,
};

export default async function handler(req, res) {
  const startedAt = Date.now();

  const access = await requireAppAccess(req, res, 'dataverse-bulk-export');
  if (!access) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Stateless confirm gate — verify BEFORE any SSE byte so a bad token gets
  // a clean JSON 4xx, not a half-stream.
  const verified = await verifyResultToken(req.body && req.body.resultToken);
  if (!verified.valid) {
    return res.status(403).json({
      error: 'CONFIRM_TOKEN_INVALID',
      reason: verified.reason,
      message: 'Run requires a valid resultToken minted by /preview — the '
        + 'run cannot execute a spec the user did not see previewed.',
    });
  }

  const markedIsolation = testRequestIsolationEnabled();
  if (verified.policy.markedIsolation !== markedIsolation) {
    return res.status(409).json({
      error: 'PREVIEW_POLICY_CHANGED',
      message: 'Test Request isolation changed after this export was previewed. '
        + 'Re-preview the export before running it.',
    });
  }

  const spec = verified.spec;
  // Defence in depth — §2.1 says preview & run run the identical matrix.
  const check = validateQuerySpec(spec);
  if (!check.valid) return res.status(check.status).json(check.body);

  // Resolve operational labels against the LIVE taxonomy and FAIL LOUD
  // pre-stream if excludeOperational can't be honored — never an SSE run
  // that silently includes operational rows (§3b/§9; Codex S160 P1).
  let compiled;
  try {
    const resolver = buildResolver(await fetchLiveTaxonomy());
    compiled = compile(spec, {
      resolver,
      excludeMarkedTestRequests: markedIsolation,
    });
  } catch (err) {
    console.error('[dataverse-export/run] taxonomy/compile failed:', err);
    return res.status(502).json({
      error: 'TAXONOMY_FETCH_FAILED',
      message: 'Could not resolve the live taxonomy needed to honor this '
        + 'spec. Refusing to run — retry.',
    });
  }
  if (spec.excludeOperational && compiled.requiresResolver) {
    return res.status(422).json({
      error: 'OPERATIONAL_EXCLUSION_UNRESOLVED',
      message: 'excludeOperational=true but operational labels did not '
        + 'resolve against the live taxonomy. Refusing to run a spec whose '
        + 'result would silently include operational rows.',
    });
  }

  // Dedicated PRIVATE Blob store token. The shared BLOB_READ_WRITE_TOKEN
  // points at a PUBLIC store (used by uploads/reviewer-finder/etc.) and
  // cannot serve a private blob — put({access:'private'}) on it throws
  // "Cannot use private access on a public store". This artifact is CRM
  // bulk data: it MUST live in a private store behind the gated /download
  // proxy (build plan §5; Codex S160 P1). Fail loud + pre-stream if unset
  // so a misconfig is a clean JSON 502, never a cryptic mid-SSE terminal
  // error that looks like a query failure.
  const blobToken = process.env.DVX_BLOB_RW_TOKEN;
  if (!blobToken) {
    return res.status(502).json({
      error: 'BLOB_STORE_UNCONFIGURED',
      message: 'The private export Blob store is not configured '
        + '(DVX_BLOB_RW_TOKEN missing). The export artifact must be written '
        + 'to a dedicated PRIVATE store, not the shared public store — '
        + 'refusing to run.',
    });
  }

  // SSE — only AFTER every pre-stream gate.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event, data) => {
    try { res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`); }
    catch { /* client disconnected */ }
  };

  try {
    const trueTotal = await fetchXmlAggregateCount(
      ENTITY_SET, compiled.countFetchXml, compiled.countAlias);
    send('progress', { stage: 'count', total: trueTotal, pages: 0, fetched: 0 });

    // Clamp the paging budget so count + workbook + upload still fit under
    // the route ceiling (Codex S160 P1: a full 240s page run + build/upload
    // could otherwise hit Vercel's hard timeout with no terminal frame).
    const remaining = ROUTE_BUDGET_MS - (Date.now() - startedAt) - RESERVE_MS;
    if (remaining < MIN_PAGING_MS) {
      send('error', {
        stage: 'budget',
        message: 'Insufficient time budget remained after the true-count '
          + 'step to safely page results. Retry, or narrow the filter.',
        retryable: true,
      });
      return res.end();
    }
    const hardBudgetMs = Math.min(240_000, remaining);

    const result = await fetchXmlAll(ENTITY_SET, compiled.fetchXml, {
      hardBudgetMs,
      onProgress: ({ pages, fetched }) =>
        send('progress', { stage: 'paging', pages, fetched, total: trueTotal }),
    });

    if (result.capped || result.truncatedByBudget) {
      send('truncated', {
        reason: result.capped ? 'cap' : 'budget',
        total: trueTotal,
        fetched: result.fetched,
      });
    }

    const { rows, summary } = annotate(result.rows, spec);
    const buf = await buildWorkbook({
      rows, summary, querySpec: spec,
      appliedRules: compiled.appliedRules,
      counts: {
        trueTotal,
        returned: result.fetched,
        capped: result.capped,
        truncatedByBudget: result.truncatedByBudget,
      },
    });

    // PRIVATE Blob (not public) + attachment disposition. Published only
    // after a fully successful build. Retrieval is the gated /download
    // proxy with a short-lived signed token — never a raw public URL.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `akoya-export-${stamp}-${result.fetched}rows.xlsx`;
    const blob = await put(`dataverse-export/${filename}`, buf, {
      access: 'private',
      token: blobToken,
      contentType: XLSX_MIME,
      contentDisposition: `attachment; filename="${filename}"`,
      addRandomSuffix: true,
    });

    const dl = await mintDownloadToken(blob.pathname);
    send('ready', {
      downloadUrl: `/api/dataverse-export/download?t=${encodeURIComponent(dl.token)}`,
      expiresInSec: dl.expiresInSec,
      bytes: buf.byteLength,
      rows: result.fetched,
      trueTotal,
      truncated: !!(result.capped || result.truncatedByBudget),
    });
    return res.end();
  } catch (err) {
    // Terminal failure — NO Blob written; nothing for the client to fetch.
    // Sanitized client message (raw error to the server log only — lower
    // layers can carry a truncated Dataverse body; Codex S160 P2).
    const stage = err instanceof WorkbookError ? 'workbook'
      : err instanceof FetchXmlError ? (err.stage || 'paging')
        : (err && err.status === 422 ? 'validation' : 'unknown');
    console.error('[dataverse-export/run] terminal error:', err);
    send('error', {
      stage,
      message: 'The export failed before any file was produced — nothing was '
        + 'published. Retry; if it persists, narrow the filter.',
      retryable: !!(err instanceof FetchXmlError && err.retryable),
    });
    return res.end();
  }
}
