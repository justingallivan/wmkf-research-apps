#!/usr/bin/env node
/**
 * Phase 2.5 feasibility spike — does Dataverse Web API $batch with an atomic
 * changeset work in THIS environment? (docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §5a.)
 *
 * A prior author left a comment that "Dataverse has no $batch transaction"
 * (pages/api/admin/prompts/[name].js) and built a non-atomic mirror instead, so
 * this is a real binary question that gates Phase 3's submit design:
 *   - $batch + changeset WORKS  → Phase 3 uses the clean atomic path.
 *   - it does NOT               → fall back to the §5a non-atomic path (which
 *                                 still has the two unsolved P0-R1/P0-R2 controls).
 *
 * What it answers (on --execute):
 *   1. Does the $batch endpoint accept a multipart/mixed body with one changeset
 *      and COMMIT a multi-op changeset? (Changeset A: two creates.)
 *   2. Is the changeset ATOMIC — does one failing op roll back the whole set?
 *      (Changeset B: a create + a deliberately-404 delete → the create must NOT
 *      persist.)
 *   3. Is per-op If-Match honored inside a changeset? (Changeset C: a PATCH with
 *      a stale etag → must 412.)
 * Then it CLEANS UP every row it created and prints a verdict.
 *
 * Target: the new (empty) wmkf_appreviewanswer table — our own, disposable. The
 * required parent lookup is satisfied by a real wmkf_appreviewersuggestion GUID
 * you pass via --suggestion (the probe rows are tagged wmkf_questionkey="__probe*"
 * and deleted at the end).
 *
 * Usage:
 *   node scripts/probe-dataverse-batch-changeset.mjs --suggestion=<guid>            # DRY RUN (read-only: resolves set name, validates target, prints the $batch body)
 *   node scripts/probe-dataverse-batch-changeset.mjs --suggestion=<guid> --execute  # sends the changesets (prod writes, then cleans up)
 *   node scripts/probe-dataverse-batch-changeset.mjs --target=prod --suggestion=<guid> --execute
 *
 * To find a test suggestion GUID:
 *   (a row on the D26 test request 1002788, or any suggestion you're OK scribbling probe rows under and deleting)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken } = require('../lib/dataverse/client');

loadEnvLocal();

const CRLF = '\r\n';
const PROBE_PREFIX = '__probe'; // every row this script creates is tagged so cleanup is exact
const BOGUS_GUID = '00000000-0000-0000-0000-000000000000';
const BOGUS_ETAG = 'W/"00000000-0000-0000-0000-000000000000"';

function parseArgs(argv) {
  const out = { target: 'prod', suggestion: null, execute: false };
  for (const a of argv.slice(2)) {
    if (a === '--execute') out.execute = true;
    else if (a.startsWith('--target=')) out.target = a.slice('--target='.length);
    else if (a.startsWith('--suggestion=')) out.suggestion = a.slice('--suggestion='.length);
    else if (a === '--help' || a === '-h') { console.log('See header for usage.'); process.exit(0); }
    else { console.error(`Unknown flag: ${a}`); process.exit(1); }
  }
  return out;
}

function resourceUrl(target) {
  if (target === 'prod') {
    if (!process.env.DYNAMICS_URL) throw new Error('DYNAMICS_URL not set');
    return process.env.DYNAMICS_URL;
  }
  if (target === 'sandbox') {
    if (!process.env.DYNAMICS_SANDBOX_URL) throw new Error('DYNAMICS_SANDBOX_URL not set');
    return process.env.DYNAMICS_SANDBOX_URL;
  }
  throw new Error(`Unknown target: ${target}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getJson(baseUrl, token, path) {
  const resp = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
  });
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { ok: resp.ok, status: resp.status, body, text };
}

async function deleteRow(baseUrl, token, entitySet, id) {
  const resp = await fetch(`${baseUrl}/${entitySet}(${id})`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'OData-Version': '4.0' },
  });
  return resp.status;
}

/**
 * Build one inner changeset operation block (an embedded HTTP request).
 * `op` = { method, url, contentId, body?, headers? }.
 */
function buildOp(op, changesetBoundary, baseUrl) {
  const lines = [];
  lines.push(`--${changesetBoundary}`);
  lines.push('Content-Type: application/http');
  lines.push('Content-Transfer-Encoding: binary');
  lines.push(`Content-ID: ${op.contentId}`);
  lines.push(''); // blank line before the embedded request
  const url = op.url.startsWith('http') ? op.url : `${baseUrl}/${op.url}`;
  lines.push(`${op.method} ${url} HTTP/1.1`);
  lines.push('OData-Version: 4.0');
  lines.push('Accept: application/json');
  for (const [k, v] of Object.entries(op.headers || {})) lines.push(`${k}: ${v}`);
  if (op.body !== undefined) {
    lines.push('Content-Type: application/json');
    lines.push('');
    lines.push(JSON.stringify(op.body));
  } else {
    lines.push('');
  }
  return lines.join(CRLF);
}

/** Build the full multipart/mixed $batch body (one changeset of ops). */
function buildBatchBody(ops, batchBoundary, changesetBoundary, baseUrl) {
  const parts = [];
  parts.push(`--${batchBoundary}`);
  parts.push(`Content-Type: multipart/mixed; boundary=${changesetBoundary}`);
  parts.push(''); // blank line before the changeset
  for (const op of ops) parts.push(buildOp(op, changesetBoundary, baseUrl));
  parts.push(`--${changesetBoundary}--`);
  parts.push(`--${batchBoundary}--`);
  parts.push('');
  return parts.join(CRLF);
}

/** Send a $batch request and return { httpStatus, opStatuses[], raw }. */
async function sendBatch(baseUrl, token, ops) {
  const id = require('crypto').randomUUID();
  const batchBoundary = `batch_${id}`;
  const changesetBoundary = `changeset_${id}`;
  const body = buildBatchBody(ops, batchBoundary, changesetBoundary, baseUrl);
  const resp = await fetch(`${baseUrl}/$batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'Content-Type': `multipart/mixed; boundary=${batchBoundary}`,
    },
    body,
  });
  const raw = await resp.text();
  // Lightweight parse: pull every embedded "HTTP/1.1 <status>" from the response.
  const opStatuses = [...raw.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));
  return { httpStatus: resp.status, opStatuses, raw };
}

function createOp(entitySet, suggestionId, questionKey, contentId) {
  return {
    method: 'POST',
    url: entitySet,
    contentId,
    body: {
      'wmkf_AppReviewerSuggestion@odata.bind': `/wmkf_appreviewersuggestions(${suggestionId})`,
      wmkf_questionkey: questionKey,
    },
  };
}

async function findProbeRows(baseUrl, token, entitySet, suggestionId) {
  const r = await getJson(
    baseUrl,
    token,
    `/${entitySet}?$select=wmkf_appreviewanswerid,wmkf_questionkey&$filter=_wmkf_appreviewersuggestion_value eq ${suggestionId} and startswith(wmkf_questionkey,'${PROBE_PREFIX}')`,
  );
  if (!r.ok) throw new Error(`probe-row query failed (${r.status}): ${r.text.slice(0, 300)}`);
  return r.body?.value || [];
}

(async () => {
  const args = parseArgs(process.argv);
  const resource = resourceUrl(args.target);
  const baseUrl = `${resource}/api/data/v9.2`;
  console.log(`Target:     ${args.target} (${resource})`);
  console.log(`Mode:       ${args.execute ? 'EXECUTE (will write + clean up)' : 'DRY-RUN (read-only)'}`);

  if (!args.suggestion || !UUID_RE.test(args.suggestion)) {
    console.error('\nFATAL: --suggestion=<guid> is required (a wmkf_appreviewersuggestion GUID to attach probe rows to).');
    process.exit(1);
  }
  console.log(`Suggestion: ${args.suggestion}\n`);

  const token = await getAccessToken(resource);

  // Resolve the entity set name from metadata (don't assume the pluralization).
  const meta = await getJson(baseUrl, token, `/EntityDefinitions(LogicalName='wmkf_appreviewanswer')?$select=EntitySetName`);
  if (!meta.ok) {
    console.error(`FATAL: could not read wmkf_appreviewanswer metadata (${meta.status}): ${meta.text.slice(0, 300)}`);
    process.exit(1);
  }
  const entitySet = meta.body.EntitySetName;
  console.log(`Resolved entity set: ${entitySet}`);

  // Validate the target suggestion exists (fail fast with a clear message).
  const sug = await getJson(baseUrl, token, `/wmkf_appreviewersuggestions(${args.suggestion})?$select=wmkf_appreviewersuggestionid`);
  if (!sug.ok) {
    console.error(`FATAL: suggestion ${args.suggestion} not found/readable (${sug.status}). Pass a valid wmkf_appreviewersuggestion GUID.`);
    process.exit(1);
  }
  console.log('Target suggestion: OK (exists)\n');

  // Build the changesets up front so dry-run can print them.
  const id = 'EXAMPLE';
  const batchBoundary = `batch_${id}`;
  const changesetBoundary = `changeset_${id}`;
  const changesetA = [
    createOp(entitySet, args.suggestion, `${PROBE_PREFIX}_a1`, 1),
    createOp(entitySet, args.suggestion, `${PROBE_PREFIX}_a2`, 2),
  ];

  if (!args.execute) {
    console.log('━━━ DRY RUN — example $batch body for Changeset A (two atomic creates) ━━━\n');
    console.log(buildBatchBody(changesetA, batchBoundary, changesetBoundary, baseUrl));
    console.log('\n(dry run — nothing was written. Re-run with --execute to send the changesets and clean up.)');
    return;
  }

  const verdict = {};

  // ── Changeset A: two creates, expect atomic commit ──────────────────────────
  console.log('━━━ Changeset A: two creates (expect commit) ━━━');
  const a = await sendBatch(baseUrl, token, changesetA);
  console.log(`  $batch HTTP ${a.httpStatus}; embedded op statuses: [${a.opStatuses.join(', ')}]`);
  let rows = await findProbeRows(baseUrl, token, entitySet, args.suggestion);
  console.log(`  probe rows now present: ${rows.length} (expect 2)`);
  verdict.batchSupported = a.httpStatus === 200 && rows.length === 2;
  if (!verdict.batchSupported && a.httpStatus >= 400) {
    console.log(`  RESPONSE (first 800 chars):\n${a.raw.slice(0, 800)}`);
  }

  // ── Changeset B: create + bad delete, expect atomic rollback ────────────────
  console.log('\n━━━ Changeset B: create + delete-nonexistent (expect rollback) ━━━');
  const b = await sendBatch(baseUrl, token, [
    createOp(entitySet, args.suggestion, `${PROBE_PREFIX}_b1`, 1),
    { method: 'DELETE', url: `${entitySet}(${BOGUS_GUID})`, contentId: 2 },
  ]);
  console.log(`  $batch HTTP ${b.httpStatus}; embedded op statuses: [${b.opStatuses.join(', ')}]`);
  rows = await findProbeRows(baseUrl, token, entitySet, args.suggestion);
  const b1Present = rows.some((r) => r.wmkf_questionkey === `${PROBE_PREFIX}_b1`);
  console.log(`  __probe_b1 persisted after the failed changeset? ${b1Present ? 'YES (NOT atomic!)' : 'no (rolled back)'}`);
  verdict.atomicRollback = !b1Present;

  // ── Changeset C: stale If-Match PATCH, expect 412 ───────────────────────────
  console.log('\n━━━ Changeset C: PATCH with stale If-Match (expect 412) ━━━');
  if (rows.length > 0) {
    const targetRow = rows[0].wmkf_appreviewanswerid;
    const c = await sendBatch(baseUrl, token, [
      {
        method: 'PATCH',
        url: `${entitySet}(${targetRow})`,
        contentId: 1,
        headers: { 'If-Match': BOGUS_ETAG },
        body: { wmkf_questionorder: 99 },
      },
    ]);
    console.log(`  $batch HTTP ${c.httpStatus}; embedded op statuses: [${c.opStatuses.join(', ')}]`);
    verdict.ifMatchHonored = c.opStatuses.includes(412);
    console.log(`  per-op If-Match honored (saw 412)? ${verdict.ifMatchHonored ? 'YES' : 'NO'}`);
  } else {
    console.log('  skipped (no probe rows to PATCH).');
    verdict.ifMatchHonored = null;
  }

  // ── Cleanup: delete every probe row ─────────────────────────────────────────
  console.log('\n━━━ Cleanup ━━━');
  rows = await findProbeRows(baseUrl, token, entitySet, args.suggestion);
  for (const r of rows) {
    const st = await deleteRow(baseUrl, token, entitySet, r.wmkf_appreviewanswerid);
    console.log(`  deleted ${r.wmkf_questionkey} (${r.wmkf_appreviewanswerid}) → ${st}`);
  }
  const leftover = await findProbeRows(baseUrl, token, entitySet, args.suggestion);
  verdict.cleanupClean = leftover.length === 0;
  console.log(`  probe rows remaining after cleanup: ${leftover.length}`);

  // ── Verdict ─────────────────────────────────────────────────────────────────
  console.log('\n═══ VERDICT ═══');
  console.log(`  $batch + changeset supported (multi-op commit): ${verdict.batchSupported ? 'YES' : 'NO'}`);
  console.log(`  changeset is atomic (failed op rolls back):      ${verdict.atomicRollback ? 'YES' : 'NO'}`);
  console.log(`  per-op If-Match honored:                         ${verdict.ifMatchHonored === null ? 'N/A' : verdict.ifMatchHonored ? 'YES' : 'NO'}`);
  console.log(`  cleanup left the table clean:                    ${verdict.cleanupClean ? 'YES' : 'NO — MANUAL CLEANUP NEEDED'}`);
  const go = verdict.batchSupported && verdict.atomicRollback;
  console.log(`\n  → ${go ? 'GO: build DynamicsService.executeChangeset on the atomic path (Phase 3).' : 'NO-GO: fall back to the §5a non-atomic path (design P0-R1/P0-R2 first).'}`);
})().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
