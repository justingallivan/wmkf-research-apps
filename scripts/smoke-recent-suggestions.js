#!/usr/bin/env node
/**
 * Smoke: pull the most recently created wmkf_appreviewersuggestion rows
 * and dump the linked potentialreviewer + researcher.
 *
 * Usage:
 *   node scripts/smoke-recent-suggestions.js [count]  # default 5
 */

require('./../lib/dataverse/client').loadEnvLocal();

(async () => {
  const count = parseInt(process.argv[2], 10) || 5;
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
  return bypassDynamicsRestrictions('smoke', async () => {

  const { records: suggestions } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
    select: [
      'wmkf_appreviewersuggestionid',
      'wmkf_suggestionlabel',
      'wmkf_grantcyclecode',
      'wmkf_programarea',
      'wmkf_relevancescore',
      'wmkf_matchreason',
      'wmkf_sources',
      'wmkf_selected',
      'createdon',
      '_wmkf_potentialreviewer_value',
      '_wmkf_request_value',
    ].join(','),
    orderby: 'createdon desc',
    top: count,
  });

  console.log(`\n=== ${suggestions.length} most recent suggestions ===\n`);

  for (const s of suggestions) {
    const prId = s._wmkf_potentialreviewer_value;
    const reqId = s._wmkf_request_value;

    // S213: bibliometrics live on the person now (wmkf_appresearcher dropped).
    const pr = prId
      ? await DynamicsService.getRecord('wmkf_potentialreviewerses', prId, {
          select: 'wmkf_name,wmkf_emailaddress,wmkf_organizationname,wmkf_areaofexpertise,wmkf_whyreviewerwaschosen,wmkf_primaryaffiliation,wmkf_orcid,wmkf_googlescholarid,wmkf_hindex,wmkf_totalcitations,wmkf_metricsupdatedat',
        }).catch(() => null)
      : null;

    console.log('---');
    console.log('suggestion:', s.wmkf_suggestionlabel || '(no label)');
    console.log('  id:           ', s.wmkf_appreviewersuggestionid);
    console.log('  request:      ', reqId);
    console.log('  cycle/area:   ', `${s.wmkf_grantcyclecode || '-'} / ${s.wmkf_programarea || '-'}`);
    console.log('  score/sources:', `${s.wmkf_relevancescore} | ${s.wmkf_sources}`);
    console.log('  selected:     ', s.wmkf_selected);
    console.log('  createdon:    ', s.createdon);
    console.log('  reason:       ', (s.wmkf_matchreason || '').slice(0, 120));
    if (pr) {
      console.log('  potentialReviewer:');
      console.log('    name:        ', pr.wmkf_name);
      console.log('    email:       ', pr.wmkf_emailaddress);
      console.log('    org:         ', pr.wmkf_organizationname);
      console.log('    expertise:   ', (pr.wmkf_areaofexpertise || '').slice(0, 100));
    } else {
      console.log('  potentialReviewer: (not found)');
    }
    if (pr) {
      console.log('  bibliometrics (on the person):');
      console.log('    h-index/cites:', `${pr.wmkf_hindex ?? '-'} / ${pr.wmkf_totalcitations ?? '-'}`);
      console.log('    orcid/scholar:', `${pr.wmkf_orcid ?? '-'} / ${pr.wmkf_googlescholarid ?? '-'}`);
      console.log('    affiliation: ', pr.wmkf_primaryaffiliation);
      console.log('    metricsAt:   ', pr.wmkf_metricsupdatedat);
    }
  }
  });
})().catch((e) => {
  console.error('Smoke failed:', e.message);
  process.exit(1);
});
