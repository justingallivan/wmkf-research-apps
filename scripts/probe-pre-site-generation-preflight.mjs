#!/usr/bin/env node

/**
 * Read-only preflight for cycle-wide Pre-Site Visit draft generation.
 *
 * Lists the cycle's advancing requests through the SAME visibility predicate
 * the Request list uses, then for each one runs the producer's own read-only
 * checks — current draft status and the exact input loader — so a request
 * that passes here will pass the producer's preflight, and one that fails
 * here fails for the same reason (same error codes).
 *
 * Prints request numbers, draft state, input-snapshot schema, and the block
 * reason code/message. No document content, credentials, or unrelated data.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-pre-site-generation-preflight.mjs --cycle=D26
 *   (add --include-test to keep request 1002788)
 */

import fs from 'fs';
import './lib/use-extensionless.mjs';

for (const file of ['.env', '.env.local']) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    }
  } catch {}
}

const args = process.argv.slice(2);
const cycle = (args.find((a) => a.startsWith('--cycle='))?.slice(8) || 'D26').toUpperCase();
const includeTest = args.includes('--include-test');
const TEST_REQUEST = '1002788';
if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
  throw new Error('Production read requires DATAVERSE_ALLOW_PROD_READS=yes (owner-run).');
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { withDalContext } = await import('../lib/dataverse/core/context.js');
const { cycleCodeToOdataFilter } = await import('../lib/utils/cycle-code.js');
const { buildVisibilityFilter } = await import('../shared/config/workbenchVisibility.js');
const { getPreSiteVisitArtifactStatus } = await import('../lib/services/pre-site-visit/artifact-service.js');
const { loadPreSiteVisitInputs } = await import('../lib/services/pre-site-visit/proposal-core-service.js');
const { REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } = await import('../shared/config/requestDocument.js');

enterDynamicsBypassForScript('probe-pre-site-generation-preflight');

const LIFECYCLE = Object.fromEntries(Object.entries(REQUEST_DOCUMENT_LIFECYCLE_STATE).map(([k, v]) => [v, k]));
const OPERATION = Object.fromEntries(Object.entries(REQUEST_DOCUMENT_OPERATION_STATUS).map(([k, v]) => [v, k]));

async function main() {
  const cycleFilter = cycleCodeToOdataFilter(cycle);
  if (!cycleFilter) throw new Error(`Unknown cycle code ${cycle}`);
  const { records } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,wmkf_triagestatus,akoya_requeststatus,_wmkf_programdirector_value',
    filter: `${cycleFilter} and ${buildVisibilityFilter(false)}`,
    orderby: 'akoya_requestnum asc',
  });
  const requests = records.filter((r) => includeTest || String(r.akoya_requestnum) !== TEST_REQUEST);

  const rows = [];
  for (const request of requests) {
    const entry = { request: String(request.akoya_requestnum), pd: request._wmkf_programdirector_value_formatted || null };
    try {
      const status = await getPreSiteVisitArtifactStatus({ requestId: request.akoya_requestid });
      const current = status.currentArtifact;
      const pending = status.pendingArtifact;
      entry.draft = current
        ? { lifecycle: LIFECYCLE[current.lifecycleState], operation: OPERATION[current.operationStatus], warnings: current.warnings?.length || 0 }
        : null;
      entry.pending = pending ? { operation: OPERATION[pending.operationStatus], retryable: pending.retryable } : null;
      if (current && current.lifecycleState !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
        entry.plan = 'LOCKED (already shared or final) — producer refuses regeneration';
        rows.push(entry); continue;
      }
    } catch (error) {
      entry.plan = `STATUS ERROR: ${error.code || ''} ${error.message}`.trim();
      rows.push(entry); continue;
    }
    try {
      const inputs = await loadPreSiteVisitInputs({ requestId: request.akoya_requestid });
      entry.inputs = {
        cycle: inputs.context?.cycleCode || null,
        personnel: inputs.context?.personnel?.length || 0,
        narrativeChars: inputs.proposalNarrative?.text?.length || null,
        institutionalFundingHistory: inputs.context?.documentFields?.institutionalFundingHistory ? 'present' : null,
      };
      entry.plan = entry.draft
        ? 'HAS DRAFT — producer reuses it if inputs+prompt unchanged, else regenerates (old row superseded)'
        : 'GENERATE';
    } catch (error) {
      entry.plan = `BLOCKED: ${error.code || 'error'} — ${error.message}`;
    }
    rows.push(entry);
  }

  const tally = { advancing: rows.length, generate: 0, hasDraft: 0, locked: 0, blocked: 0, statusError: 0 };
  for (const r of rows) {
    if (r.plan === 'GENERATE') tally.generate += 1;
    else if (r.plan.startsWith('HAS DRAFT')) tally.hasDraft += 1;
    else if (r.plan.startsWith('LOCKED')) tally.locked += 1;
    else if (r.plan.startsWith('BLOCKED')) tally.blocked += 1;
    else tally.statusError += 1;
  }
  console.log(JSON.stringify({ cycle, excludedTestRequest: includeTest ? null : TEST_REQUEST, tally, requests: rows }, null, 2));
}

await withDalContext('probe-pre-site-generation-preflight', main).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
