#!/usr/bin/env node
/**
 * Probe wmkf_appreviewersuggestion picklist columns to enumerate optionset
 * values. Uses raw fetch via DynamicsService token + headers helpers.
 */
require('./../lib/dataverse/client').loadEnvLocal();

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('probe');

  const token = await DynamicsService.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;

  for (const attr of ['wmkf_responsetype', 'wmkf_reviewstatus']) {
    const url = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')/Attributes(LogicalName='${attr}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`;
    const resp = await fetch(url, { headers: DynamicsService.buildHeaders(token) });
    if (!resp.ok) {
      console.error(`${attr}: ${resp.status} ${await resp.text()}`);
      continue;
    }
    const data = await resp.json();
    const opts = data?.OptionSet?.Options || [];
    console.log(`\n${attr}:`);
    for (const o of opts) {
      const label = o.Label?.UserLocalizedLabel?.Label || '(no label)';
      console.log(`  ${o.Value}  →  ${label}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
