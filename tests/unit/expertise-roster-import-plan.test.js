/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planImport } = require('../../scripts/lib/expertise-roster-import-plan.cjs');
const HOST = 'orgd9e66399.crm.dynamics.com';
const DATASET = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PROFILE = '44444444-4444-4444-8444-444444444444';
function fixture() {
  const row = { id: 1, name: 'Synthetic Board Example', role_type: 'Board', is_active: true, dataverse_contact_id: null };
  for (const f of ['role','affiliation','orcid','preferred_email','primary_fields','keywords','subfields_specialties','methods_techniques','distinctions','expertise','keck_affiliation','keck_affiliation_details']) row[f] = null;
  row.expertise = 'Synthetic broad expertise'; row.keywords = '';
  return { source: { version: 1, datasetId: DATASET, rows: [row] }, target: { version: 1, complete: true, targetHost: HOST, profiles: [] }, mapping: { version: 1, datasetId: DATASET, targetHost: HOST, rows: [{ legacyId: 1, confirmed: true, staffUserGuid: null, contactGuid: null, active: true, leadPdEligible: false }] } };
}
const run = f => planImport(f.source, f.target, f.mapping, [HOST]);
test('permanent unlinked Board row preserves null/empty text and has deterministic retry identity', () => {
  const f = fixture(); const r = run(f);
  expect(r.blocked).toBe(false); expect(r.executionAuthorized).toBe(false);
  expect(r.rows[0].creationKey).toBe(`legacy_${DATASET}_1`);
  expect(r.rows[0].values.wmkf_keywords).toBe(''); expect(r.rows[0].values.wmkf_affiliation).toBeNull();
  expect(run(f)).toEqual(r);
  f.target.profiles.push({ profileGuid: PROFILE, values: r.rows[0].values });
  expect(run(f).rows[0].action).toBe('unchanged');
  f.target.profiles[0].values.wmkf_expertise = 'Changed after import';
  expect(run(f).rows[0].errors.join()).toMatch(/reconcile/);
});
test('never blindly carries a Production Contact GUID into sandbox', () => {
  const f = fixture(); f.source.rows[0].dataverse_contact_id = CONTACT;
  const r = run(f); expect(r.rows[0].values.wmkf_contactguid).toBeNull();
  expect(r.rows[0].warnings.join()).toMatch(/differs/);
});
test('missing owner confirmation blocks rather than inferring eligibility', () => {
  const f = fixture(); f.mapping.rows[0].confirmed = false;
  expect(run(f).blocked).toBe(true);
  f.mapping.rows = []; expect(run(f).rows[0].action).toBe('blocked');
});
test.each([
  ['inactive', f => { f.mapping.rows[0].active = false; }],
  ['no User', f => { f.mapping.rows[0].staffUserGuid = null; }],
  ['non-staff', f => { f.source.rows[0].role_type = 'Board'; }],
])('lead eligibility fails closed for %s', (_, change) => {
  const f = fixture(); f.source.rows[0].role_type = 'Research Program Staff';
  Object.assign(f.mapping.rows[0], { leadPdEligible: true, staffUserGuid: USER }); change(f);
  expect(run(f).blocked).toBe(true);
});
test('duplicate links block BOTH imported people, including inactive holders', () => {
  const f = fixture(); f.mapping.rows[0].contactGuid = CONTACT;
  f.source.rows.push({ ...f.source.rows[0], id: 2 });
  f.mapping.rows.push({ ...f.mapping.rows[0], legacyId: 2, active: false });
  const r = run(f); expect(r.summary.blocked).toBe(2); expect(r.summary.create).toBe(0);
});
test('a target person link owned by a different creation key is a conflict', () => {
  const f = fixture(); f.mapping.rows[0].contactGuid = CONTACT;
  f.target.profiles = [{ profileGuid: PROFILE, values: { wmkf_name: 'Other', wmkf_creationkey: 'direct_other', wmkf_contactguid: CONTACT, wmkf_staffuser: null } }];
  expect(run(f).rows[0].errors.join()).toMatch(/different target/);
});
test('unknown source columns, categories, overlong fields and missing export columns are blocked', () => {
  for (const mutate of [r => { r.role_type = 'Other'; }, r => { r.surprise = 'data'; }, r => { r.expertise = 'x'.repeat(100001); }, r => { delete r.keywords; }]) {
    const f = fixture(); mutate(f.source.rows[0]); expect(run(f).blocked).toBe(true);
  }
});
test('target completeness, namespace and duplicate source keys cannot silently pass', () => {
  const f = fixture(); f.target.complete = false; expect(() => run(f)).toThrow(/complete/);
  f.target.complete = true; f.target.targetHost = 'unknown.crm.dynamics.com'; expect(() => run(f)).toThrow(/unregistered/);
  f.target.targetHost = HOST; f.mapping.datasetId = PROFILE; expect(() => run(f)).toThrow(/mismatch/);
  f.mapping.datasetId = DATASET; f.source.rows.push({ ...f.source.rows[0] }); expect(run(f).blocked).toBe(true);
});
test('CLI refuses execution mode and protects report files from overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-plan-'));
  try {
    const f = fixture(), args = [];
    for (const k of ['source','target','mapping']) { const file = path.join(dir, `${k}.json`); fs.writeFileSync(file, JSON.stringify(f[k])); args.push(`--${k}`, file); }
    const output = path.join(dir, 'report.json'); args.push('--output', output);
    const cli = path.resolve(__dirname, '../../scripts/plan-expertise-roster-import.cjs');
    expect(spawnSync(process.execPath, [cli, '--execute'], { encoding: 'utf8' }).status).toBe(1);
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    expect(result.status).toBe(0); expect(fs.statSync(output).mode & 0o777).toBe(0o600);
    const original = fs.readFileSync(output, 'utf8');
    expect(spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }).status).toBe(1);
    expect(fs.readFileSync(output, 'utf8')).toBe(original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('incomplete target identity projections fail closed', () => {
  const f = fixture();
  f.target.profiles = [{ profileGuid: PROFILE, values: { wmkf_name: 'Other', wmkf_creationkey: 'direct_other', wmkf_contactguid: null } }];
  expect(() => run(f)).toThrow(/missing identity projection/);
});
test('same-name profiles require human review without merging unlinked people', () => {
  const f = fixture();
  f.source.rows.push({ ...f.source.rows[0], id: 2 });
  f.mapping.rows.push({ ...f.mapping.rows[0], legacyId: 2 });
  f.target.profiles = [{ profileGuid: PROFILE, values: { wmkf_name: f.source.rows[0].name, wmkf_creationkey: 'direct_other', wmkf_contactguid: null, wmkf_staffuser: null } }];
  const report = run(f);
  expect(report.summary.create).toBe(2);
  for (const row of report.rows) {
    expect(row.warnings.join()).toMatch(/Possible duplicate name/);
    expect(row.warnings.join()).toContain(PROFILE);
  }
});
