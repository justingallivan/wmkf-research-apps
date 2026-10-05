/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/068_presentation_transcript_boundary.sql'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8'));

test('068 re-declares both post-presentation artifact-type constraints with the three planned types added', () => {
  const list = 'artifact_type IN (100000005, 100000006, 100000007, 100000010, 100000011, 100000012)';
  for (const name of ['presentation_material_uploads_artifact_type_check', 'presentation_material_slot_leases_artifact_type_check']) {
    expect(migration).toContain(`DROP CONSTRAINT IF EXISTS ${name}`);
    expect(migration).toContain(`ADD CONSTRAINT ${name} CHECK (\n    ${list}\n  )`);
  }
});

test('068 adds the frozen presentation end to the publication receipt, all-or-nothing', () => {
  for (const column of ['presentation_end_ms INTEGER', 'presentation_end_confirmed_by INTEGER REFERENCES user_profiles(id)', 'presentation_end_confirmed_at TIMESTAMPTZ']) {
    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
  }
  expect(migration).toContain('meeting_transcript_publications_presentation_end_shape');
  expect(migration).toMatch(/presentation_end_ms IS NULL AND presentation_end_confirmed_by IS NULL AND presentation_end_confirmed_at IS NULL/);
  expect(migration).toMatch(/presentation_end_ms >= 0 AND presentation_end_confirmed_by IS NOT NULL AND presentation_end_confirmed_at IS NOT NULL/);
});

test('068 is tracked by the manifest and the fresh-install bootstrap runs it after 055 (no inline mirror needed)', () => {
  expect(manifest.files).toContain('068_presentation_transcript_boundary.sql');
  expect(manifest.files.indexOf('068_presentation_transcript_boundary.sql')).toBeGreaterThan(manifest.files.indexOf('055_post_presentation_materials.sql'));
  const bootstrap = fs.readFileSync(path.join(ROOT, 'scripts/lib/fresh-database-bootstrap.js'), 'utf8');
  expect(bootstrap).toContain('readMigrationManifest');
});
