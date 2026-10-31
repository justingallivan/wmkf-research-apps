#!/usr/bin/env node
/**
 * Owner-run close-out of D26 reviewer invitations that never got a response
 * (owner, 2026-10-30: "The D26 reviewer cycle is over").
 *
 * The daily /api/cron/sweep-stale-invites does exactly this, but only once the
 * parent request's linked Grant Cycle Board date has passed (D26: 2026-12-10).
 * This script closes D26 out now through the same per-row writer
 * (`reviewer-engagement/expire-invitation.js`): each row is re-read and must
 * still be a pending invitation with a concrete ETag, its parent's linked
 * cycle Board date is re-read, and the write is ETag-conditional. The row
 * becomes wmkf_responsetype = No Response with wmkf_responsereceivedat = now.
 * No email is sent.
 *
 * Scope: suggestions coded D26 that match the sweep's discovery filter, on
 * ordinary (non-test) requests only, as the scheduled sweep does. The cutoff is
 * fixed at 2026-12-11T00:00Z, so only a parent whose linked cycle Board date
 * is on or before 2026-12-10 can be written; a D26-coded row whose parent is
 * linked to a later cycle is skipped.
 *
 * `--only <suggestionId,...>` limits the run to those invitations and, because
 * the owner named them, includes rows on test requests (owner, 2026-10-30:
 * close the two D26 test-request invitations).
 *
 * Default is a dry run (reads only). `--execute` writes and needs the same-day
 * write acknowledgement:
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/close-out-d26-open-invitations.mjs
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes \
 *   DATAVERSE_PROD_WRITE_ACK="D26 invitation close-out $(date -u +%F)" \
 *     node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/close-out-d26-open-invitations.mjs --execute
 */
import './lib/use-extensionless.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');

const CYCLE = 'D26';
const CUTOFF_ISO = '2026-12-11T00:00:00.000Z';

async function main() {
  const execute = process.argv.includes('--execute');
  const onlyArg = process.argv[process.argv.indexOf('--only') + 1];
  const only = process.argv.includes('--only')
    ? new Set(String(onlyArg || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean))
    : null;
  if (only && only.size === 0) throw new Error('--only needs a comma-separated list of suggestion ids');
  loadEnvLocal();
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const { notExcludedFilter, queryAllSuggestions } = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
  const { queryRequests } = await import('../lib/dataverse/adapters/grant-request.js');
  const { linkedCycleBoardDate, linkedCycleBoardDateExpand } = await import('../lib/dataverse/adapters/operations-grant-cycle.js');
  const { createRequestTestStateLookup } = await import('../lib/services/test-requests/request-test-state.js');
  const { expireInvitation } = await import('../lib/services/reviewer-engagement/expire-invitation.js');
  const { isDataverseRecordNotFound } = await import('../lib/dataverse/core/errors.js');

  await withDalContext('local-d26-invitation-close-out', async () => {
    const { records: candidates } = await queryAllSuggestions({
      select: 'wmkf_appreviewersuggestionid,wmkf_emailsentat,_wmkf_request_value,wmkf_accepted,wmkf_declined,wmkf_responsetype',
      filter: `wmkf_grantcyclecode eq '${CYCLE}' and wmkf_selected eq true and wmkf_emailsentat ne null and (wmkf_accepted eq false or wmkf_accepted eq null) and (wmkf_declined eq false or wmkf_declined eq null) and wmkf_responsetype eq null and ${notExcludedFilter()}`,
    });

    const testState = createRequestTestStateLookup();
    const ordinary = [];
    let testRows = 0;
    for (const s of candidates) {
      if (only) {
        if (only.has(String(s.wmkf_appreviewersuggestionid).toLowerCase())) ordinary.push(s);
        continue;
      }
      if ((await testState(s._wmkf_request_value)).kind === 'ordinary') ordinary.push(s);
      else testRows += 1;
    }
    if (only && ordinary.length !== only.size) {
      console.log(`Note: ${only.size} id(s) named, ${ordinary.length} matched the D26 pending-invitation filter.`);
    }

    const boardDates = {};
    for (const id of [...new Set(ordinary.map((s) => s._wmkf_request_value).filter(Boolean))]) {
      const { records } = await queryRequests({
        select: 'akoya_requestid,akoya_requestnum',
        expand: linkedCycleBoardDateExpand(),
        filter: `akoya_requestid eq ${id}`,
        top: 1,
      });
      const r = records[0];
      boardDates[id] = { number: r?.akoya_requestnum || null, boardDate: linkedCycleBoardDate(r) || null };
    }
    const inScope = ordinary.filter((s) => {
      const d = boardDates[s._wmkf_request_value]?.boardDate;
      return d && new Date(d).toISOString() < CUTOFF_ISO;
    });

    console.log(JSON.stringify({
      cycle: CYCLE,
      discovered: candidates.length,
      testRequestRowsLeftAlone: testRows,
      ordinaryRows: ordinary.length,
      parentBoardDateOnOrBefore20261210: inScope.length,
      otherParents: ordinary.length - inScope.length,
      requests: [...new Set(inScope.map((s) => boardDates[s._wmkf_request_value].number))].sort(),
    }, null, 2));

    if (!execute) {
      console.log('Dry run: nothing written. Pass --execute to close these out.');
      return;
    }

    const nowIso = new Date().toISOString();
    const result = { closedOut: 0, skipped: 0, errors: [] };
    for (const s of inScope) {
      try {
        const { outcome } = await expireInvitation({ suggestion: s, cutoffIso: CUTOFF_ISO, nowIso, actingUserSystemId: null });
        if (outcome === 'swept') result.closedOut += 1;
        else result.skipped += 1;
      } catch (e) {
        if (isDataverseRecordNotFound(e) || e?.status === 412) result.skipped += 1;
        else result.errors.push({ id: s.wmkf_appreviewersuggestionid, message: String(e?.message || e).slice(0, 240) });
      }
    }
    console.log(JSON.stringify(result, null, 2));
  });
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
