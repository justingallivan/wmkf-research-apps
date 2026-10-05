/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/069_staff_discussion_transcript_type.sql'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8'));

test('069 re-declares both post-presentation artifact-type constraints with 100000013 added and nothing dropped', () => {
  const list = 'artifact_type IN (100000005, 100000006, 100000007, 100000010, 100000011, 100000012, 100000013)';
  for (const name of ['presentation_material_uploads_artifact_type_check', 'presentation_material_slot_leases_artifact_type_check']) {
    expect(migration).toContain(`DROP CONSTRAINT IF EXISTS ${name}`);
    expect(migration).toContain(`ADD CONSTRAINT ${name} CHECK (\n    ${list}\n  )`);
  }
});

test('069 is tracked by the manifest after 068', () => {
  expect(manifest.files.indexOf('069_staff_discussion_transcript_type.sql'))
    .toBeGreaterThan(manifest.files.indexOf('068_presentation_transcript_boundary.sql'));
});
