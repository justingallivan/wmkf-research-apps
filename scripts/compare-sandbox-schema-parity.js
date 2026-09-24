#!/usr/bin/env node
/**
 * Compare production and sandbox Dataverse schema (read-only).
 *
 * Reads, from both environments, every wmkf_ and akoya_ table (plus account,
 * contact, systemuser), their wmkf_ columns with types, and every wmkf_ choice
 * / multi-choice column's options. Reports tables and columns missing from
 * the sandbox, column type differences, and choice values missing, relabelled
 * or sandbox-only. GET requests only; no records are read.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/compare-sandbox-schema-parity.js --out=<file.json>
 *
 * The production read needs owner authorization. --out feeds
 * scripts/apply-sandbox-choice-parity.js. See
 * docs/plans/SANDBOX_SCHEMA_PARITY_2026-09-24.md.
 */

const fs = require('fs');
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

loadEnvLocal();

const SANDBOX = 'https://orgd9e66399.crm.dynamics.com';
const INCLUDED = (name) => /^(wmkf_|akoya_)/.test(name) || ['account', 'contact', 'systemuser'].includes(name);
const label = (o) => (o.Label && o.Label.UserLocalizedLabel && o.Label.UserLocalizedLabel.Label) || '';

async function read(resourceUrl) {
  const c = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const get = async (p) => {
    const r = await c.get(p);
    if (!r.ok) throw new Error(`GET ${p} ${r.status} ${r.text.slice(0, 200)}`);
    return r.body;
  };
  const tables = {};
  const choices = {};
  const defs = (await get('/EntityDefinitions?$select=LogicalName')).value.filter((e) => INCLUDED(e.LogicalName));
  for (const { LogicalName: e } of defs) {
    const E = `/EntityDefinitions(LogicalName='${e}')`;
    const attrs = (await get(`${E}/Attributes?$select=LogicalName,AttributeType`)).value;
    tables[e] = Object.fromEntries(attrs.filter((a) => a.LogicalName.startsWith('wmkf_')).map((a) => [a.LogicalName, a.AttributeType]));
    for (const cast of ['PicklistAttributeMetadata', 'MultiSelectPicklistAttributeMetadata']) {
      const rows = (await get(`${E}/Attributes/Microsoft.Dynamics.CRM.${cast}?$select=LogicalName&$expand=OptionSet($select=Name,IsGlobal,Options),GlobalOptionSet($select=Name,IsGlobal,Options)`)).value;
      for (const a of rows) {
        if (!a.LogicalName.startsWith('wmkf_')) continue;
        const os = (a.GlobalOptionSet && a.GlobalOptionSet.IsGlobal) ? a.GlobalOptionSet : a.OptionSet;
        choices[`${e}.${a.LogicalName}`] = { global: !!os.IsGlobal, name: os.Name, options: Object.fromEntries(os.Options.map((o) => [o.Value, label(o)])) };
      }
    }
  }
  return { tables, choices };
}

function compare(prod, sandbox) {
  const missingTables = Object.keys(prod.tables).filter((e) => !sandbox.tables[e]).sort();
  const missingColumns = [];
  const typeDiffs = [];
  for (const [e, cols] of Object.entries(prod.tables)) {
    const s = sandbox.tables[e];
    if (!s) continue;
    for (const [c, t] of Object.entries(cols)) {
      if (!(c in s)) missingColumns.push(`${e}.${c}`);
      else if (s[c] !== t) typeDiffs.push(`${e}.${c} ${t}/${s[c]}`);
    }
  }
  const missingValues = [];
  const labelDiffs = [];
  const sandboxOnlyValues = [];
  for (const [key, p] of Object.entries(prod.choices)) {
    const s = sandbox.choices[key];
    if (!s) continue;
    for (const [v, l] of Object.entries(p.options)) {
      if (!(v in s.options)) missingValues.push({ key, global: s.global, name: s.name, value: Number(v), label: l });
      else if (s.options[v] !== l) labelDiffs.push(`${key} ${v}: "${l}" / "${s.options[v]}"`);
    }
    for (const v of Object.keys(s.options)) if (!(v in p.options)) sandboxOnlyValues.push(`${key} ${v} "${s.options[v]}"`);
  }
  return { missingTables, missingColumns, typeDiffs, missingValues, labelDiffs, sandboxOnlyValues };
}

(async () => {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const prod = await read(process.env.DYNAMICS_URL);
  const sandbox = await read(process.env.DYNAMICS_SANDBOX_URL || SANDBOX);
  const report = compare(prod, sandbox);
  console.log(`tables missing from sandbox: ${report.missingTables.length} (${report.missingTables.filter((e) => e.startsWith('wmkf_')).length} wmkf_)`);
  for (const e of report.missingTables.filter((x) => x.startsWith('wmkf_'))) console.log(`  table ${e}`);
  console.log(`columns missing on shared tables: ${report.missingColumns.length}`);
  for (const c of report.missingColumns) console.log(`  column ${c}`);
  console.log(`column type differences: ${report.typeDiffs.length}`);
  for (const d of report.typeDiffs) console.log(`  type ${d}`);
  console.log(`choice values missing from sandbox: ${report.missingValues.length}; label differences: ${report.labelDiffs.length}; sandbox-only values: ${report.sandboxOnlyValues.length}`);
  for (const d of report.labelDiffs) console.log(`  label ${d}`);
  if (outArg) fs.writeFileSync(outArg.slice('--out='.length), `${JSON.stringify(report, null, 1)}\n`);
})().catch((e) => { console.error(e.message); process.exit(1); });
