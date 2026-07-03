/**
 * scripts/probe-bill-option-set-values.js
 *
 * One-off probe to capture the Dataverse option-set int values for
 * `wmkf_exisitngbillcomaccount` so they can be set as env vars:
 *   BILLCOM_ACCOUNT_YES_VALUE
 *   BILLCOM_ACCOUNT_NO_VALUE
 *
 * Usage:
 *   node --env-file=.env.local scripts/probe-bill-option-set-values.js
 *
 * Output:
 *   For each label found on the field, prints "label = int" so they can be
 *   copy-pasted into Vercel env settings.
 */

import { DynamicsService } from '../lib/services/dynamics-service.js';

async function main() {
  const attribute = 'wmkf_exisitngbillcomaccount';
  const token = await DynamicsService.getAccessToken();
  const base = process.env.DYNAMICS_URL?.replace(/\/$/, '');
  if (!base) throw new Error('DYNAMICS_URL not set');
  const url = `${base}/api/data/v9.2/EntityDefinitions(LogicalName='akoya_request')` +
    `/Attributes(LogicalName='${attribute}')` +
    `/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`Metadata fetch failed: ${resp.status} ${await resp.text()}`);
  }
  const result = await resp.json();
  const options = result?.OptionSet?.Options || [];
  if (options.length === 0) {
    console.error('No options returned. Check that the attribute exists and your service account has metadata read.');
    process.exit(1);
  }

  console.log(`Found ${options.length} option(s) on ${attribute}:`);
  for (const opt of options) {
    const label = opt?.Label?.UserLocalizedLabel?.Label || '(no label)';
    console.log(`  ${label.padEnd(30)} = ${opt.Value}`);
  }

  console.log('\nSet these in Vercel env settings (production + preview):');
  for (const opt of options) {
    const label = (opt?.Label?.UserLocalizedLabel?.Label || '').trim();
    let envName = null;
    if (/^yes$/i.test(label)) envName = 'BILLCOM_ACCOUNT_YES_VALUE';
    else if (/^no$/i.test(label)) envName = 'BILLCOM_ACCOUNT_NO_VALUE';
    if (envName) console.log(`  ${envName}=${opt.Value}`);
  }
}

main().catch(err => {
  console.error('Probe failed:', err?.message || err);
  process.exit(1);
});
