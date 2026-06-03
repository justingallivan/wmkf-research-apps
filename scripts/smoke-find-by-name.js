#!/usr/bin/env node
/**
 * Search potential reviewers and suggestions by name fragment.
 * Usage: node scripts/smoke-find-by-name.js <nameFragment>
 */
require('./../lib/dataverse/client').loadEnvLocal();
(async () => {
  const frag = process.argv[2];
  if (!frag) { console.error('name fragment required'); process.exit(1); }
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
  return bypassDynamicsRestrictions('smoke', async () => {

  const escaped = frag.replace(/'/g, "''");

  const { records: prs } = await DynamicsService.queryRecords('wmkf_potentialreviewerses', {
    // S213: bibliometrics live on the person now (no wmkf_appresearcher sidecar).
    select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_organizationname,wmkf_primaryaffiliation,wmkf_hindex,wmkf_totalcitations,createdon,modifiedon',
    filter: `contains(wmkf_name,'${escaped}')`,
    top: 10,
  });
  console.log(`\n=== ${prs.length} potentialreviewer rows matching "${frag}" ===`);
  for (const p of prs) {
    console.log(`  ${p.wmkf_name} | ${p.wmkf_emailaddress} | ${p.wmkf_organizationname}`);
    console.log(`    id: ${p.wmkf_potentialreviewersid}  created: ${p.createdon}`);

    const { records: sgs } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
      select: 'wmkf_appreviewersuggestionid,wmkf_suggestionlabel,wmkf_selected,createdon,_wmkf_request_value',
      filter: `_wmkf_potentialreviewer_value eq ${p.wmkf_potentialreviewersid}`,
      top: 10,
    });
    console.log(`    suggestions: ${sgs.length}`);
    for (const s of sgs) {
      console.log(`      - ${s.wmkf_suggestionlabel} | request ${s._wmkf_request_value} | created ${s.createdon}`);
    }

    console.log(`    bibliometrics: h-index ${p.wmkf_hindex ?? '-'} / cites ${p.wmkf_totalcitations ?? '-'} / aff ${p.wmkf_primaryaffiliation ?? '-'}`);
  }
  });
})().catch((e) => { console.error(e.message); process.exit(1); });
