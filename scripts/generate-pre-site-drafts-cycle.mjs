#!/usr/bin/env node

/**
 * Cycle-wide Pre-Site Visit draft generation (owner-run, D26).
 *
 * Drives the SAME producer the Workbench's "Generate Word Draft" button calls
 * (`generatePreSiteVisitArtifact`), once per advancing request in the cycle,
 * sequentially. Drafts are unattributed ("AI generated, no staff author") —
 * the producer's actor policy allows that. Generation is idempotent by input
 * fingerprint + prompt: re-running after a crash reuses Ready rows; a draft
 * already locked for sharing is refused by the producer (409) and reported.
 *
 * Reads and writes production Dataverse (registry rows, AI runs), calls the
 * LLM provider, and uploads Word files to production SharePoint. Dry-run by
 * default. Prints request numbers, outcomes, timings, warning counts, and
 * error codes. No document content, credentials, or unrelated data.
 *
 * Usage (dry-run lists the plan and writes nothing):
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/generate-pre-site-drafts-cycle.mjs --cycle=D26
 * Execute one request first, then the rest:
 *   DATAVERSE_ALLOW_PROD_READS=yes DATAVERSE_PROD_WRITE_ACK="pre-site D26 drafts YYYY-MM-DD" \
 *     node scripts/generate-pre-site-drafts-cycle.mjs --cycle=D26 --execute --only=1002821
 *   ... --execute            (all remaining)
 * Options: --only=<num,num>  --limit=N  --include-test  --ledger=<path.json>
 *
 * J27: the source contract (AI Materials/ProposalNarrative_{Request#}.pdf)
 * and the trigger mechanism both change — register J27-082. Do not reuse
 * this script for J27 without that decision.
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
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const cycle = (flag('cycle') || 'D26').toUpperCase();
const EXECUTE = args.includes('--execute');
const includeTest = args.includes('--include-test');
const only = flag('only') ? new Set(flag('only').split(',').map((s) => s.trim())) : null;
const limit = flag('limit') ? Number(flag('limit')) : null;
const ledgerPath = flag('ledger');
const TEST_REQUEST = '1002788';

if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
  throw new Error('Requires DATAVERSE_ALLOW_PROD_READS=yes (owner-run).');
}
if (EXECUTE && !process.env.DATAVERSE_PROD_WRITE_ACK) {
  throw new Error('--execute requires DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>" (today, UTC).');
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { withDalContext } = await import('../lib/dataverse/core/context.js');
const { cycleCodeToOdataFilter } = await import('../lib/utils/cycle-code.js');
const { buildVisibilityFilter } = await import('../shared/config/workbenchVisibility.js');
const { generatePreSiteVisitArtifact, getPreSiteVisitArtifactStatus } = await import('../lib/services/pre-site-visit/artifact-service.js');
const { REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } = await import('../shared/config/requestDocument.js');

enterDynamicsBypassForScript('generate-pre-site-drafts-cycle');

const LIFECYCLE = Object.fromEntries(Object.entries(REQUEST_DOCUMENT_LIFECYCLE_STATE).map(([k, v]) => [v, k]));
const OPERATION = Object.fromEntries(Object.entries(REQUEST_DOCUMENT_OPERATION_STATUS).map(([k, v]) => [v, k]));

function describe(artifact) {
  if (!artifact) return null;
  return {
    artifactId: artifact.artifactId,
    lifecycle: LIFECYCLE[artifact.lifecycleState],
    operation: OPERATION[artifact.operationStatus],
    warnings: Array.isArray(artifact.warnings) ? artifact.warnings.length : 0,
    file: artifact.file ? { name: artifact.file.name, versionId: artifact.file.versionId } : null,
  };
}

async function main() {
  const cycleFilter = cycleCodeToOdataFilter(cycle);
  if (!cycleFilter) throw new Error(`Unknown cycle code ${cycle}`);
  const { records } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum',
    filter: `${cycleFilter} and ${buildVisibilityFilter(false)}`,
    orderby: 'akoya_requestnum asc',
  });
  let targets = records.filter((r) => includeTest || String(r.akoya_requestnum) !== TEST_REQUEST);
  if (only) targets = targets.filter((r) => only.has(String(r.akoya_requestnum)));
  if (limit) targets = targets.slice(0, limit);

  console.error(`[plan] cycle=${cycle} mode=${EXECUTE ? 'EXECUTE' : 'dry-run'} targets=${targets.length}${only ? ` only=${[...only].join(',')}` : ''}${limit ? ` limit=${limit}` : ''}`);

  const ledger = [];
  const startedAll = Date.now();
  for (const request of targets) {
    const num = String(request.akoya_requestnum);
    const entry = { request: num, mode: EXECUTE ? 'execute' : 'dry-run' };
    const started = Date.now();
    try {
      const status = await getPreSiteVisitArtifactStatus({ requestId: request.akoya_requestid });
      entry.before = describe(status.currentArtifact);
      if (status.currentArtifact && status.currentArtifact.lifecycleState !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
        entry.outcome = 'skipped-locked';
      } else if (!EXECUTE) {
        entry.outcome = status.currentArtifact ? 'would-generate-or-reuse' : 'would-generate';
      } else {
        console.error(`[run] ${num} generating…`);
        const result = await generatePreSiteVisitArtifact({ requestId: request.akoya_requestid, actingUserSystemId: null });
        entry.after = describe(result.artifact);
        entry.reused = result.reused === true;
        entry.recovered = result.recovered === true;
        entry.outcome = result.reused ? 'reused' : entry.after?.operation === 'GENERATING' ? 'generating' : 'generated';
      }
    } catch (error) {
      entry.outcome = 'error';
      entry.error = { code: error.code || null, status: error.httpStatus || null, message: String(error.message || error).slice(0, 300) };
    }
    entry.ms = Date.now() - started;
    ledger.push(entry);
    console.error(`[done] ${num} ${entry.outcome} ${Math.round(entry.ms / 1000)}s${entry.after ? ` ${entry.after.lifecycle}/${entry.after.operation} w${entry.after.warnings}` : ''}${entry.error ? ` ${entry.error.code || ''}` : ''}`);
  }

  const tally = {};
  for (const e of ledger) tally[e.outcome] = (tally[e.outcome] || 0) + 1;
  const report = { cycle, mode: EXECUTE ? 'execute' : 'dry-run', totalSeconds: Math.round((Date.now() - startedAll) / 1000), tally, ledger };
  if (ledgerPath) fs.writeFileSync(ledgerPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

await withDalContext('generate-pre-site-drafts-cycle', main).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
