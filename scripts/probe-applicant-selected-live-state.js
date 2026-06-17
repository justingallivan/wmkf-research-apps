#!/usr/bin/env node
/**
 * READ-ONLY probe for the S264 applicant-suggested promotion redesign.
 *
 * Layer 6 of the spec proposes a blanket migration: demote EVERY
 * wmkf_appreviewersuggestion row where
 *   wmkf_applicantdisposition = 100000000 (applicant-"recommended")
 *   AND wmkf_selected = true
 * back to wmkf_selected = false.
 *
 * The spec asserts this is "all-or-nothing confirmed safe: no PD has manually
 * promoted any applicant-suggested reviewer" — i.e. none of those selected
 * applicant rows are actually LIVE candidate/invite/accepted reviewers. Codex's
 * review flagged that if that assertion is wrong, the migration would silently
 * yank a live reviewer out of the candidate pool / Invite tab (and leave any
 * external portal token un-revoked).
 *
 * This script verifies the assertion. It writes nothing. It lists, for every
 * applicant-recommended + selected row, whether it carries any live lifecycle
 * signal:
 *   invited / accepted / declined / materials-sent / external-token-issued
 *   (and not revoked) / review-received / honorarium-linked.
 *
 * Usage: node scripts/probe-applicant-selected-live-state.js
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
  'wmkf_reviewstatus',
  'wmkf_externaltokenissued',
  'wmkf_externaltokenrevoked',
  'wmkf_proposalfirstaccessed',
  'wmkf_applicantdisposition',
  '_wmkf_request_value',
  '_wmkf_honorariumrequest_value',
  'createdon',
].join(',');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function queryAll(client, entitySet, params) {
  const rows = [];
  let path = `/${entitySet}?${new URLSearchParams(params).toString()}`;
  while (path) {
    const res = await client.get(path);
    if (!res.ok) fail(`GET ${path} failed (${res.status}): ${res.text}`);
    rows.push(...(res.body?.value || []));
    const next = res.body?.['@odata.nextLink'];
    path = next || null;
  }
  return rows;
}

// Returns the list of live-lifecycle signals a row carries (empty = inert).
function liveSignals(r) {
  const signals = [];
  if (r.wmkf_invited === true) signals.push('invited');
  if (r.wmkf_accepted === true) signals.push('accepted');
  if (r.wmkf_declined === true) signals.push('declined');
  if (r.wmkf_materialssentat) signals.push('materials-sent');
  if (r.wmkf_reviewreceivedat) signals.push('review-received');
  if (r.wmkf_externaltokenissued && !r.wmkf_externaltokenrevoked) signals.push('token-live');
  if (r.wmkf_proposalfirstaccessed) signals.push('proposal-accessed');
  if (r._wmkf_honorariumrequest_value) signals.push('honorarium-linked');
  return signals;
}

async function main() {
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) fail('Missing DYNAMICS_URL or DATAVERSE_URL');

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });

  // All applicant-recommended rows (selected and not) for context.
  const allRecommended = await queryAll(client, SUGGESTION_SET, {
    '$select': SELECT,
    '$filter': `wmkf_applicantdisposition eq ${DISPOSITION_RECOMMENDED}`,
    '$orderby': 'createdon desc',
  });

  const selected = allRecommended.filter((r) => r.wmkf_selected === true);
  const unselected = allRecommended.filter((r) => r.wmkf_selected !== true);

  console.log('=== Applicant-recommended (wmkf_applicantdisposition = 100000000) ===');
  console.log(`Total recommended rows:        ${allRecommended.length}`);
  console.log(`  selected = true:             ${selected.length}  <-- Layer 6 would demote these`);
  console.log(`  selected = false/null:       ${unselected.length}`);
  console.log();

  const live = selected.map((r) => ({ r, sig: liveSignals(r) })).filter((x) => x.sig.length > 0);
  const inert = selected.filter((r) => liveSignals(r).length === 0);

  console.log('=== Safety check on the rows Layer 6 would flip to selected=false ===');
  console.log(`  inert (no live lifecycle signal) — SAFE to demote:  ${inert.length}`);
  console.log(`  LIVE (carry lifecycle signal)    — UNSAFE to demote: ${live.length}`);
  console.log();

  if (live.length > 0) {
    console.log('!!! Layer 6 blanket demotion is NOT safe as written. Live rows:');
    for (const { r, sig } of live) {
      console.log(`  - ${r.wmkf_appreviewersuggestionid}` +
        ` label="${(r.wmkf_suggestionlabel || '').slice(0, 50)}"` +
        ` request=${r._wmkf_request_value}` +
        ` status=${r.wmkf_reviewstatus ?? '-'}` +
        ` signals=[${sig.join(', ')}]`);
    }
  } else {
    console.log('Spec assertion HOLDS: every selected applicant-recommended row is inert.');
    console.log('A blanket demotion would not disturb any live candidate/invite/review row.');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Probe failed:', e?.stack || e?.message || e);
  process.exit(1);
});
