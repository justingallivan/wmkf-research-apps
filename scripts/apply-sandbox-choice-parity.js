#!/usr/bin/env node
/**
 * Insert into the SANDBOX the choice values production has and the sandbox
 * lacks, from a report written by scripts/compare-sandbox-schema-parity.js.
 * Dry run unless --execute. Refuses any host other than the registered
 * sandbox. Adds values only: label differences and sandbox-only values are
 * reported by the compare script and never changed here.
 *
 * Usage:
 *   node scripts/apply-sandbox-choice-parity.js --report=<file.json>            # dry run
 *   node scripts/apply-sandbox-choice-parity.js --report=<file.json> --execute
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

loadEnvLocal();

const SANDBOX = 'https://orgd9e66399.crm.dynamics.com';
const SOLUTION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'dataverse', 'schema', 'solution.json'), 'utf8')).uniqueName;

(async () => {
  const reportArg = process.argv.find((a) => a.startsWith('--report='));
  if (!reportArg) throw new Error('--report=<file.json> is required');
  const execute = process.argv.includes('--execute');
  const { missingValues } = JSON.parse(fs.readFileSync(reportArg.slice('--report='.length), 'utf8'));

  // A global option set shared by several columns needs each value once.
  const seen = new Set();
  const inserts = missingValues.filter((m) => {
    const id = m.global ? `global:${m.name}:${m.value}` : `${m.key}:${m.value}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const i of inserts) console.log(`  + ${i.global ? `global:${i.name}` : i.key} ${i.value} "${i.label}"`);
  console.log(`${inserts.length} value(s) to insert.`);
  if (!execute) { console.log('Dry run. Re-run with --execute.'); return; }

  const url = process.env.DYNAMICS_SANDBOX_URL || SANDBOX;
  if (new URL(url).host !== new URL(SANDBOX).host) throw new Error(`Refusing non-sandbox target ${url}`);
  const c = createClient({ resourceUrl: url, token: await getAccessToken(url) });
  for (const i of inserts) {
    const [entity, attribute] = i.key.split('.');
    const r = await c.post('/InsertOptionValue', {
      Value: i.value,
      Label: { LocalizedLabels: [{ Label: i.label, LanguageCode: 1033 }] },
      SolutionUniqueName: SOLUTION,
      ...(i.global ? { OptionSetName: i.name } : { EntityLogicalName: entity, AttributeLogicalName: attribute }),
    });
    if (!r.ok) throw new Error(`InsertOptionValue ${i.key} ${i.value}: ${r.status} ${r.text.slice(0, 300)}`);
    console.log(`  ✓ ${i.key} ${i.value}`);
  }
  const p = await c.post('/PublishAllXml', {});
  if (!p.ok) throw new Error(`PublishAllXml ${p.status} ${p.text.slice(0, 200)}`);
  console.log('Published.');
})().catch((e) => { console.error(e.message); process.exit(1); });
