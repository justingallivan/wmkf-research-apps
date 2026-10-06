#!/usr/bin/env node
/**
 * Owner-run, READ-ONLY preview of what Staff Deliberations automatic
 * preparation would do for the given cycles if it were switched on now.
 *
 * Replays the worker's due-scan classification (preparation-worker.js
 * scanDueReceipts / processReceipt) over every Workbench-visible ordinary
 * request in each cycle, across all programs and request statuses, so the
 * owner can choose allowlists. The worker has no age limit: any eligible
 * presentation whose end has passed is due, so `daysAgo` shows how far back
 * a cycle allowlist would reach. It never imports the generator, the
 * transition service, or the receipt store, and performs no writes.
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/review-staff-deliberations-preparation-cohort.mjs --cycle=J26 --cycle=D26
 */
import './lib/use-extensionless.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');

// Production pairs verified 2026-10-05 (status-clarity plan :217); the
// configured env value wins when present.
const VERIFIED_PAIRS = '[[0,1,true],[1,2,true],[2,3,false],[3,4,true]]';
const DAY_MS = 24 * 60 * 60 * 1000;

function parseCycles(argv) {
  const cycles = argv.map((value) => value.match(/^--cycle=([JD]\d{2})$/i)).filter(Boolean)
    .map((match) => match[1].toUpperCase());
  if (!cycles.length) throw new Error('Usage: --cycle=<J26|D26|...> (repeatable)');
  return [...new Set(cycles)];
}

async function main() {
  const cycleCodes = parseCycles(process.argv.slice(2));
  loadEnvLocal();
  const grantRequestAdapter = await import('../lib/dataverse/adapters/grant-request.js');
  const siteVisitAdapter = await import('../lib/dataverse/adapters/site-visit.js');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const { cycleCodeToOdataFilter } = await import('../lib/utils/cycle-code.js');
  const { buildVisibilityFilter } = await import('../shared/config/workbenchVisibility.js');
  const { readScheduledPreparationStateStatusPairs } = await import('../shared/config/siteVisit.js');
  const { withTestRequestIsolationSelect, withOrdinaryTestRequestODataFilter } = await import('../lib/services/test-requests/isolation.js');
  const { getPreSiteVisitArtifactStatus } = await import('../lib/services/pre-site-visit/artifact-reader.js');
  const { REQUEST_DOCUMENT_LIFECYCLE_STATE: LIFE } = await import('../shared/config/requestDocument.js');

  const pairs = readScheduledPreparationStateStatusPairs(
    process.env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS || VERIFIED_PAIRS,
  );
  // The worker refuses to run without TEST_REQUEST_ISOLATION=on, so it never
  // sees marked TEST requests; mirror that regardless of local configuration.
  const isolationEnv = { ...process.env, TEST_REQUEST_ISOLATION: 'on' };
  const nowMs = Date.now();
  const ended = (visit) => Number.isFinite(Date.parse(visit.scheduledend)) && Date.parse(visit.scheduledend) <= nowMs;

  const scanCycle = async (cycleCode) => {
    const filter = withOrdinaryTestRequestODataFilter(
      [cycleCodeToOdataFilter(cycleCode), buildVisibilityFilter(false)].map((c) => `(${c})`).join(' and '),
      isolationEnv,
    );
    const result = await grantRequestAdapter.queryAllRequests({
      select: withTestRequestIsolationSelect([
        'akoya_requestid', 'akoya_requestnum', 'akoya_requeststatus', 'wmkf_meetingdate',
        '_wmkf_grantprogram_value', '_wmkf_currentpresitevisit_value',
      ], isolationEnv),
      filter,
      orderby: 'akoya_requestnum asc',
    });
    if (result?.capped || result?.hasMore) throw new Error(`${cycleCode}: request scan capped`);
    const requests = result.records || [];
    const visits = requests.length
      ? await siteVisitAdapter.findSummariesByRequests(requests.map((r) => r.akoya_requestid))
      : { records: [] };
    if (visits?.capped || visits?.hasMore) throw new Error(`${cycleCode}: site visit scan capped`);
    const byRequest = new Map();
    for (const visit of visits.records || []) {
      const key = String(visit._regardingobjectid_value || '').toLowerCase();
      if (!byRequest.has(key)) byRequest.set(key, []);
      byRequest.get(key).push(visit);
    }
    const out = [];
    for (const request of requests) {
      const list = byRequest.get(String(request.akoya_requestid).toLowerCase()) || [];
      const classified = list.map((visit) => ({
        visit,
        pair: pairs.find((p) => p.stateCode === Number(visit.statecode) && p.statusCode === Number(visit.statuscode)) || null,
      }));
      const eligible = classified.filter(({ pair }) => pair?.eligible).map(({ visit }) => visit);
      const ambiguous = classified.some(({ pair }) => !pair) || eligible.length > 1;
      const endedVisits = list.filter(ended);
      const latestEnd = (eligible.length === 1 ? eligible : endedVisits)
        .map((visit) => Date.parse(visit.scheduledend)).filter(Number.isFinite).sort((a, b) => b - a)[0];
      const row = {
        cycle: cycleCode,
        num: request.akoya_requestnum,
        program: request['_wmkf_grantprogram_value@OData.Community.Display.V1.FormattedValue'] || request._wmkf_grantprogram_value,
        status: request.akoya_requeststatus || '',
        end: latestEnd ? new Date(latestEnd).toISOString().slice(0, 10) : '',
        daysAgo: latestEnd && latestEnd <= nowMs ? Math.floor((nowMs - latestEnd) / DAY_MS) : '',
        outcome: '',
      };
      if (!list.length) row.outcome = 'not due: no presentation event';
      else if (ambiguous && endedVisits.length) row.outcome = 'BLOCKED: schedule needs reconciliation';
      else if (ambiguous) row.outcome = 'not due: ambiguous events, none ended';
      else if (!eligible.length) row.outcome = 'not due: only cancelled events';
      else if (!ended(eligible[0])) row.outcome = 'not due: presentation not ended';
      else {
        try {
          const status = await getPreSiteVisitArtifactStatus({ requestId: request.akoya_requestid });
          const current = status.currentArtifact;
          if (current?.correction?.cycleId) row.outcome = 'correction in progress';
          else if (!current) row.outcome = status.pendingArtifact ? 'BLOCKED?: generation already pending' : 'GENERATE (paid AI) then prepare';
          else if (current.lifecycleState === LIFE.DRAFT) row.outcome = 'PREPARE existing Word file (no AI)';
          else row.outcome = 'already past preparation (no-op)';
        } catch (error) {
          row.outcome = `BLOCKED: document read failed (${error?.code || error?.message})`;
        }
      }
      out.push(row);
    }
    return out;
  };

  const rows = await withDalContext('local-staff-deliberations-cohort-review', async () => {
    const all = [];
    for (const cycleCode of cycleCodes) all.push(...await scanCycle(cycleCode));
    return all;
  });

  console.log(`READ-ONLY · cycles ${cycleCodes.join(', ')} · ${rows.length} ordinary Workbench-visible requests · now ${new Date(nowMs).toISOString()}`);
  console.table(rows);
  const tally = new Map();
  for (const row of rows) {
    const key = `${row.cycle} | ${row.program} | ${row.status} | ${row.outcome.split(':')[0]}`;
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  console.log('\ncycle | program | request status | outcome → count');
  for (const [key, count] of [...tally].sort()) console.log(`${key} → ${count}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
