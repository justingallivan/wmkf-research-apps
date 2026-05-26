#!/usr/bin/env node
/**
 * One-off: find the akoya_request field(s) whose AkoyaGO display name
 * contains "Program Area Served", and dump option set values if they are picklists.
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [rawKey, ...valueParts] = trimmed.split('=');
      const key = rawKey.trim();
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=').trim();
        if (value.startsWith('"')) {
          const endQuote = value.indexOf('"', 1);
          if (endQuote > 0) value = value.slice(1, endQuote);
        }
        process.env[key] = value;
      }
    }
  });
}

const { DynamicsService } = require('../lib/services/dynamics-service');
const { enterDynamicsBypassForScript } = require('../lib/services/dynamics-context');

async function main() {
  const TABLE = 'akoya_request';
  const NEEDLE = 'Program Area Served';

  // Bypass the user-scoped restriction system for this admin-only one-off.
  enterDynamicsBypassForScript('find-program-area-field-script');

  console.log(`Fetching attributes for ${TABLE}...`);
  const attrs = await DynamicsService.getEntityAttributes(TABLE);
  console.log(`  ${attrs.length} attributes total`);

  const matches = attrs.filter(a =>
    (a.displayName || '').toLowerCase().includes(NEEDLE.toLowerCase()) ||
    (a.logicalName || '').toLowerCase().includes('program') ||
    (a.logicalName || '').toLowerCase().includes('progarea')
  );

  console.log(`\nMatches (${matches.length}):`);
  for (const m of matches) {
    console.log(`  - ${m.displayName}  [${m.logicalName}]  (${m.type})`);
  }

  // For each picklist / multi-select picklist, fetch option-set values.
  const token = await DynamicsService.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL?.replace(/^"|"$/g, '');

  for (const m of matches) {
    if (m.type !== 'Picklist' && m.type !== 'Virtual') continue;

    // Try MultiSelectPicklist first (common for "served" multi-tag fields), fall back to Picklist
    for (const cast of ['MultiSelectPicklistAttributeMetadata', 'PicklistAttributeMetadata']) {
      const url = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${TABLE}')/Attributes(LogicalName='${m.logicalName}')/Microsoft.Dynamics.CRM.${cast}?$select=LogicalName&$expand=OptionSet($select=Options)`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
        },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const opts = data?.OptionSet?.Options || [];
      if (!opts.length) continue;

      console.log(`\n  Options for ${m.logicalName} (${cast}):`);
      for (const o of opts) {
        const label = o.Label?.UserLocalizedLabel?.Label || '(no label)';
        console.log(`    ${o.Value}: ${label}`);
      }
      break;
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
