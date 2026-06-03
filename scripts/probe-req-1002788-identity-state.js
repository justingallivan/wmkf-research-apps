#!/usr/bin/env node
/**
 * READ-ONLY recon for the S215 identity-resolver Workbench smoke.
 * Dumps every reviewer-suggestion junction row on req 1002788 and, for each
 * linked person, the wmkf_identity* decision fields + the resolver-sourced
 * identity-bearing fields (scholar/orcid/metrics). Tells us whether PR1 has
 * already run against this request's candidates and what the current gate state
 * looks like. No writes.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const REQNUM = process.argv[2] || '1002788';

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

const PERSON_SELECT = [
  'wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_emailaddress', 'wmkf_primaryaffiliation',
  // resolver-sourced identity-bearing fields
  'wmkf_googlescholarid', 'wmkf_googlescholarurl', 'wmkf_hindex', 'wmkf_i10index', 'wmkf_totalcitations',
  'wmkf_orcid', 'wmkf_orcidurl',
  // resolver decision fields (deployed S214)
  'wmkf_identitystatus', 'wmkf_identityconfidenceband', 'wmkf_identityresolverversion',
  'wmkf_identityresolvedat', 'wmkf_identityevidencesummary', 'wmkf_identityverifiedanchorsjson',
];

await bypassDynamicsRestrictions('probe-req-identity-state', async () => {
  const reqs = await DynamicsService.queryRecords('akoya_requests', {
    select: ['akoya_requestid', 'akoya_requestnum'],
    filter: `akoya_requestnum eq '${REQNUM}'`,
    top: 1,
  });
  if (!reqs.records.length) { console.log(`No akoya_request with akoya_requestnum=${REQNUM}`); return; }
  const requestId = reqs.records[0].akoya_requestid;
  console.log(`req ${REQNUM} → ${requestId}\n`);

  const sugs = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
    select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,wmkf_selected,wmkf_applicantdisposition,wmkf_matchreason,createdon',
    filter: `_wmkf_request_value eq ${requestId}`,
    top: 200,
  });
  console.log(`${sugs.records.length} suggestion junction row(s) on this request.\n`);

  const personIds = [...new Set(sugs.records.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const persons = new Map();
  for (const id of personIds) {
    try {
      const p = await DynamicsService.getRecord('wmkf_potentialreviewerses', id, { select: PERSON_SELECT.join(',') });
      persons.set(id, p);
    } catch (e) { persons.set(id, { _error: e.message }); }
  }

  for (const s of sugs.records) {
    const p = persons.get(s._wmkf_potentialreviewer_value) || {};
    console.log('─'.repeat(80));
    console.log(`person: ${p.wmkf_name || '(none)'}   [${s._wmkf_potentialreviewer_value || 'no person'}]`);
    console.log(`  suggestion: selected=${s.wmkf_selected} disposition=${s.wmkf_applicantdisposition} created=${s.createdon}`);
    if (s.wmkf_matchreason) console.log(`  matchReason: ${s.wmkf_matchreason}`);
    if (p._error) { console.log(`  PERSON FETCH ERROR: ${p._error}`); continue; }
    console.log(`  affiliation: ${p.wmkf_primaryaffiliation || '—'}`);
    console.log(`  IDENTITY: status=${p.wmkf_identitystatus || '—'} band=${p.wmkf_identityconfidenceband || '—'} ver=${p.wmkf_identityresolverversion || '—'} at=${p.wmkf_identityresolvedat || '—'}`);
    if (p.wmkf_identityevidencesummary) console.log(`    summary: ${p.wmkf_identityevidencesummary}`);
    if (p.wmkf_identityverifiedanchorsjson) console.log(`    anchors: ${p.wmkf_identityverifiedanchorsjson}`);
    console.log(`  SCHOLAR: id=${p.wmkf_googlescholarid || '—'} h=${p.wmkf_hindex ?? '—'} i10=${p.wmkf_i10index ?? '—'} cites=${p.wmkf_totalcitations ?? '—'}`);
    console.log(`    url=${p.wmkf_googlescholarurl || '—'}`);
    console.log(`  ORCID: ${p.wmkf_orcid || '—'}  url=${p.wmkf_orcidurl || '—'}`);
  }
  console.log('─'.repeat(80));
});
