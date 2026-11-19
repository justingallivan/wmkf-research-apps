#!/usr/bin/env node
/**
 * Owner-run, read-only discovery of existing Request triage-reason fields.
 * Compares only the 36 owner-supplied requests with their workbook flags.
 * Searches metadata names/display labels and ALL choice option labels, then
 * checks readable text/choice fields in batches. Never prints unrelated prose.
 * No Dataverse writes; does not provision schema or change scoring decisions.
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-request-triage-reasons.cjs --target=prod
 * Run --self-test for offline fixtures (no credentials or network).
 * A missing match is not proof that the workbook's values exist nowhere:
 * this probe covers akoya_request only, not related tables or documents.
 */
const REASONS = [
  'Too applied or translational', 'Limited impact or incremental',
  'Unclear basic science question', 'Feasibility', 'Overlap with existing funding',
  'Overlap with a recent Keck award', 'Other',
];
const GROUPS = [
  [0, '1002851 1002869 1002882 1002884 1002891 1002911 1002914 1002923'],
  [1, '1002808 1002817 1002819 1002827 1002829 1002840 1002848 1002849 1002865 1002876 1002883 1002885 1002887 1002893 1002894 1002895 1002904 1002909 1002910 1002915 1002918 1002920 1002928 1002932 1002935'],
  [2, '1002881'], [3, '1002846 1002899'],
];
const EXPECTED = new Map(GROUPS.flatMap(([i, numbers]) => numbers.split(' ').map(n => [n, REASONS[i]])));
const normalize = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const labels = x => [...new Set([x?.UserLocalizedLabel?.Label, ...(x?.LocalizedLabels || []).map(l => l.Label)].filter(Boolean))];
const choiceType = a => a.AttributeTypeName?.Value === 'MultiSelectPicklistType' ? 'MultiSelectPicklist' : a.AttributeType;
const knownReason = value => REASONS.find(r => normalize(r) === normalize(value));
function classify(row, field, expected) {
  const raw = row[field];
  const formatted = row[`${field}@OData.Community.Display.V1.FormattedValue`];
  if (raw == null && formatted == null) return 'blank-or-unreadable';
  if ([raw, formatted].some(v => normalize(v) === normalize(expected))) return 'exact';
  if ([raw, formatted].some(v => typeof v === 'string' && v.split(';').some(part => normalize(part) === normalize(expected)))) return 'multi-value';
  if ([raw, formatted].some(v => typeof v === 'string' && normalize(v).includes(normalize(expected)))) return 'embedded-text';
  return 'different';
}
async function probe(get, emit = console.log) {
  const def = "/EntityDefinitions(LogicalName='akoya_request')";
  async function all(path) {
    const rows = [];
    const seen = new Set();
    while (path) {
      if (seen.has(path) || seen.size >= 100) throw new Error('Pagination limit reached; probe incomplete');
      seen.add(path);
      const page = await get(path);
      if (!Array.isArray(page.value)) throw new Error('Invalid collection response; probe incomplete');
      rows.push(...page.value);
      path = page['@odata.nextLink'];
    }
    return rows;
  }
  const attrs = await all(`${def}/Attributes?$select=LogicalName,AttributeType,AttributeTypeName,DisplayName,IsValidForRead`);
  const candidates = new Set();
  const metadata = new Map(attrs.map(a => [a.LogicalName, a]));
  emit('# Candidate metadata (names/display labels or matching option labels)');
  for (const a of attrs) {
    const names = [a.LogicalName, ...labels(a.DisplayName)].join(' ');
    if (/triage|declin|denial|reason|rationale|flag|scor/i.test(names)) candidates.add(a.LogicalName);
  }
  for (const type of ['Picklist', 'MultiSelectPicklist', 'State', 'Status']) {
    const choices = await all(`${def}/Attributes/Microsoft.Dynamics.CRM.${type}AttributeMetadata?$select=LogicalName&$expand=OptionSet`);
    for (const a of choices) {
      const options = a.OptionSet?.Options || [];
      if (options.some(o => labels(o.Label).some(knownReason))) candidates.add(a.LogicalName);
      if (candidates.has(a.LogicalName)) {
        emit(JSON.stringify({ field: a.LogicalName, type, options: options.map(o => ({ value: o.Value, labels: labels(o.Label) })) }));
      }
    }
  }
  for (const field of [...candidates].sort()) {
    const a = metadata.get(field);
    emit(JSON.stringify({ field, type: a && choiceType(a), display: labels(a?.DisplayName), readable: a?.IsValidForRead }));
  }
  const fields = attrs.filter(a => a.IsValidForRead === true &&
    ['String', 'Memo', 'Picklist', 'MultiSelectPicklist', 'State', 'Status'].includes(choiceType(a))).map(a => a.LogicalName);
  const records = new Map();
  const { eq } = require('../lib/dataverse/core/odata.js');
  const filter = encodeURIComponent([...EXPECTED.keys()].map(n => eq('akoya_requestnum', n)).join(' or '));
  const rejected = new Set();
  // Verify the filter and identity columns first: a base-query failure is fatal,
  // rather than incorrectly attributing it to every optional field.
  async function readFields(batch) {
    const select = [...new Set(['akoya_requestid', 'akoya_requestnum', ...batch])].join(',');
    let rows;
    try { rows = await all(`/akoya_requests?$select=${select}&$filter=${filter}`); }
    catch (error) {
      if (error.status !== 400 || !batch.length) throw error;
      if (batch.length === 1) {
        rejected.add(batch[0]);
        emit(JSON.stringify({ field: batch[0], excluded: true, error: 'HTTP 400 selecting this field' }));
        return;
      }
      const middle = Math.ceil(batch.length / 2);
      await readFields(batch.slice(0, middle));
      await readFields(batch.slice(middle));
      return;
    }
    for (const row of rows) {
      if (!EXPECTED.has(String(row.akoya_requestnum))) throw new Error('Unexpected request returned; probe incomplete');
      records.set(row.akoya_requestid, { ...records.get(row.akoya_requestid), ...row });
    }
  }
  await readFields([]);
  for (let i = 0; i < fields.length; i += 30) await readFields(fields.slice(i, i + 30));
  emit(`\n# Coverage: ${EXPECTED.size} workbook requests; ${records.size} rows; ${fields.length - rejected.size} fields read; ${rejected.size} fields excluded`);
  const unique = new Map();
  for (const [number] of EXPECTED) {
    const rows = [...records.values()].filter(r => String(r.akoya_requestnum) === number);
    if (rows.length !== 1) emit(JSON.stringify({ request: number, rows: rows.length, excluded: true }));
    else unique.set(number, rows[0]);
  }
  for (const field of fields) {
    if (rejected.has(field)) continue;
    const results = [...unique].map(([number, row]) => ({ request: number, result: classify(row, field, EXPECTED.get(number)) }));
    if (candidates.has(field) && ['Picklist', 'MultiSelectPicklist'].includes(choiceType(metadata.get(field)))) {
      emit(JSON.stringify({ field, storedChoices: [...unique].map(([number, row]) => ({
        request: number, expected: EXPECTED.get(number), value: row[field] ?? null,
        label: row[`${field}@OData.Community.Display.V1.FormattedValue`] ?? null,
      })) }));
    }
    const matches = results.filter(r => ['exact', 'multi-value', 'embedded-text'].includes(r.result));
    if (!candidates.has(field) && !matches.length) continue;
    emit(JSON.stringify({ field, display: labels(metadata.get(field)?.DisplayName), counts: results.reduce((counts, r) => {
      counts[r.result] = (counts[r.result] || 0) + 1; return counts;
    }, {}), requests: results }));
  }
  emit('\nExact matches are evidence of stored flags; embedded-text matches are leads only. Blank may also mean field-security restrictions. No matches does not rule out related tables or workbook-only values.');
}
async function main() {
  if (process.argv.includes('--self-test')) {
    const assert = require('node:assert/strict');
    assert.equal(EXPECTED.size, 36);
    assert.equal(classify({ f: 42, 'f@OData.Community.Display.V1.FormattedValue': 'Feasibility' }, 'f', 'Feasibility'), 'exact');
    assert.equal(classify({ f: '  Limited impact or  incremental ' }, 'f', REASONS[1]), 'exact');
    assert.equal(classify({ f: 'Feasibility; Other' }, 'f', 'Feasibility'), 'multi-value');
    assert.equal(classify({ f: 'Concern: feasibility remains uncertain' }, 'f', 'Feasibility'), 'embedded-text');
    assert.equal(classify({ f: 'Other' }, 'f', 'Feasibility'), 'different');
    assert.equal(classify({}, 'f', 'Feasibility'), 'blank-or-unreadable');
    const output = [];
    await probe(async path => {
      if (path.includes('/Attributes?')) return { value: [
        { LogicalName: 'wmkf_unknownflag', AttributeType: 'Picklist', IsValidForRead: true },
        { LogicalName: 'wmkf_unrelated', AttributeType: 'Memo', IsValidForRead: true },
        { LogicalName: 'wmkf_bad', AttributeType: 'String', IsValidForRead: true },
      ] };
      if (path.includes('.PicklistAttributeMetadata')) return { value: [{ LogicalName: 'wmkf_unknownflag',
        OptionSet: { Options: [{ Value: 42, Label: { LocalizedLabels: [{ Label: REASONS[1] }] } }] } }] };
      if (path.includes('/Attributes/')) return { value: [] };
      if (path.startsWith('/akoya_requests?') && path.includes('wmkf_bad')) throw Object.assign(new Error('Fixture 400'), { status: 400 });
      if (path.startsWith('/akoya_requests?')) return { value: [{ akoya_requestid: 'fixture', akoya_requestnum: '1002808',
        wmkf_unknownflag: 42, 'wmkf_unknownflag@OData.Community.Display.V1.FormattedValue': REASONS[1],
        wmkf_unrelated: 'PRIVATE UNRELATED PROSE' }] };
      throw new Error('Unexpected fixture URL');
    }, line => output.push(line));
    assert(output.some(line => line.includes('"exact":1')));
    assert(output.some(line => line.includes('"field":"wmkf_bad","excluded":true')));
    assert(!output.some(line => line.includes('"field":"wmkf_bad"') && line.includes('counts')));
    assert(output.some(line => line.includes('"rows":0')));
    assert(!output.join('\n').includes('PRIVATE UNRELATED PROSE'));
    console.log('PASS: 36 supplied requests; comparison cases, metadata discovery, missing requests and unrelated-prose suppression.');
    return;
  }
  if (process.argv.length !== 3 || process.argv[2] !== '--target=prod') throw new Error('Specify --target=prod or --self-test');
  // Require explicit shell opt-in BEFORE loading local configuration.
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Owner must set DATAVERSE_ALLOW_PROD_READS=yes');
  const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
  const { classifyTarget } = require('../lib/dataverse/core/interlock.js');
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL;
  if (classifyTarget(resourceUrl) !== 'production') throw new Error('Target must be the registered Production host');
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), dryRun: true });
  const base = `${resourceUrl.replace(/\/$/, '')}/api/data/v9.2/`;
  await probe(async path => {
    const url = new URL(path.startsWith('/') ? `${resourceUrl.replace(/\/$/, '')}/api/data/v9.2${path}` : path);
    if (!url.href.startsWith(base)) throw new Error('Unexpected pagination target');
    const result = await client.get(url.href, { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' });
    if (!result.ok) throw Object.assign(new Error(`HTTP ${result.status}; probe incomplete`), { status: result.status });
    return result.body;
  });
}
if (require.main === module) main().catch(error => {
  console.error(`Probe failed: ${/^(Specify|Owner must|Target must|HTTP |Unexpected|Pagination|Invalid)/.test(error.message) ? error.message : 'authentication or transport failure (details withheld)'}`);
  process.exitCode = 1;
});
module.exports = { probe, classify, EXPECTED };
