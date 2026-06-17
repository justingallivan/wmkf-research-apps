#!/usr/bin/env node
/**
 * One-time S264 demotion for applicant-suggested reviewers.
 *
 * Finds wmkf_appreviewersuggestion rows where:
 *   wmkf_applicantdisposition = 100000000 (applicant recommended)
 *   wmkf_selected = true
 *
 * In dry-run mode (default), reports what would be demoted. With --apply, PATCHes
 * only inert rows to wmkf_selected=false. Rows with any live lifecycle signal are
 * skipped and logged; this script never revokes tokens.
 */

const { createRequire } = require('node:module');
const requireFromHere = createRequire(__filename);
const { loadEnvLocal, getAccessToken, createClient } = requireFromHere('../lib/dataverse/client.js');

const SUGGESTION_SET = 'wmkf_appreviewersuggestions';
const DISPOSITION_RECOMMENDED = 100000000;

const SELECT = [
  'wmkf_appreviewersuggestionid',
  'wmkf_suggestionlabel',
  'wmkf_selected',
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_materialssentat',
  'wmkf_reviewreceivedat',
  'wmkf_heldat',
  'wmkf_responsetype',
  'wmkf_responsereceivedat',
  'wmkf_reviewstatus',
  'wmkf_completedat',
  'wmkf_externaltokenissued',
  'wmkf_externaltokenrevoked',
  'wmkf_proposalfirstaccessed',
  'wmkf_withdrawnsufficientat',
  '_wmkf_request_value',
  '_wmkf_honorariumrequest_value',
  'createdon',
].join(',');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.log(`Usage: node scripts/demote-applicant-suggested-reviewers.js [--dry-run | --apply]

Default is dry-run (also selectable explicitly with --dry-run). --apply writes
wmkf_selected=false for inert rows only.`);
}

async function queryAll(client, entitySet, params) {
  const rows = [];
  let path = `/${entitySet}?${new URLSearchParams(params).toString()}`;
  while (path) {
    const res = await client.get(path);
    if (!res.ok) fail(`GET ${path} failed (${res.status}): ${res.text}`);
    rows.push(...(res.body?.value || []));
    path = res.body?.['@odata.nextLink'] || null;
  }
  return rows;
}

function liveSignals(r) {
  const signals = [];
  if (r.wmkf_invited === true) signals.push('invited');
  if (r.wmkf_accepted === true) signals.push('accepted');
  if (r.wmkf_declined === true) signals.push('declined');
  if (r.wmkf_materialssentat) signals.push('materials-sent');
  if (r.wmkf_reviewreceivedat) signals.push('review-received');
  if (r.wmkf_heldat) signals.push('held');
  if (r.wmkf_responsetype !== null && r.wmkf_responsetype !== undefined) signals.push('response-type');
  if (r.wmkf_responsereceivedat) signals.push('response-received');
  if (r.wmkf_reviewstatus !== null && r.wmkf_reviewstatus !== undefined) signals.push('review-status');
  if (r.wmkf_completedat) signals.push('completed');
  if (r.wmkf_externaltokenissued && !r.wmkf_externaltokenrevoked) signals.push('token-live');
  if (r.wmkf_proposalfirstaccessed) signals.push('proposal-accessed');
  if (r._wmkf_honorariumrequest_value) signals.push('honorarium-linked');
  if (r.wmkf_withdrawnsufficientat) signals.push('withdrawn-sufficient');
  return signals;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    usage();
    return;
  }
  const apply = args.has('--apply');
  for (const arg of args) {
    // --dry-run is the default and accepted explicitly as a no-op so an operator
    // who types it (the natural thing to do) isn't rejected as "unknown argument".
    if (arg !== '--apply' && arg !== '--dry-run') fail(`Unknown argument: ${arg}`);
  }

  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) fail('Missing DYNAMICS_URL or DATAVERSE_URL');

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });

  const rows = await queryAll(client, SUGGESTION_SET, {
    '$select': SELECT,
    '$filter': `wmkf_applicantdisposition eq ${DISPOSITION_RECOMMENDED} and wmkf_selected eq true`,
    '$orderby': 'createdon desc',
  });

  let demoted = 0;
  let skippedLive = 0;
  let failed = 0;

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Candidates: ${rows.length}`);

  for (const row of rows) {
    const id = row.wmkf_appreviewersuggestionid;
    const signals = liveSignals(row);
    if (signals.length > 0) {
      skippedLive += 1;
      console.log(`SKIP live id=${id} request=${row._wmkf_request_value || '-'} signals=[${signals.join(', ')}] label="${(row.wmkf_suggestionlabel || '').slice(0, 80)}"`);
      continue;
    }

    if (!apply) {
      demoted += 1;
      console.log(`WOULD demote id=${id} request=${row._wmkf_request_value || '-'} label="${(row.wmkf_suggestionlabel || '').slice(0, 80)}"`);
      continue;
    }

    const res = await client.patch(`/${SUGGESTION_SET}(${id})`, { wmkf_selected: false });
    if (res.ok) {
      demoted += 1;
      console.log(`DEMOTED id=${id} request=${row._wmkf_request_value || '-'}`);
    } else {
      failed += 1;
      console.error(`FAILED id=${id} request=${row._wmkf_request_value || '-'} (${res.status}): ${res.text}`);
    }
  }

  console.log('Summary:');
  console.log(`  candidates:    ${rows.length}`);
  console.log(`  demoted:       ${demoted}${apply ? '' : ' (dry-run)'}`);
  console.log(`  skipped-live:  ${skippedLive}`);
  console.log(`  failed:        ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Demotion failed:', e?.stack || e?.message || e);
  process.exit(1);
});
