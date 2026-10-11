/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(__dirname, '../..');
const sql = fs.readFileSync(path.join(root, 'lib/db/migrations/078_zoom_attendance_attribution.sql'), 'utf8');
it('078 is additive, bounded, and included in the manifest-driven fresh install', () => {
  expect(sql).not.toMatch(/\b(?:DROP|DELETE|UPDATE)\b/i);
  for (const name of ['attendance_review', 'discussion_attribution', 'frozen_discussion_attribution']) {
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${name} JSONB`);
    expect(sql).toContain(`pg_column_size(${name}) <= 524288`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'lib/db/migrations-manifest.json')));
  expect(manifest.files).toContain('078_zoom_attendance_attribution.sql');
  expect(fs.readFileSync(path.join(root, 'scripts/setup-database.js'), 'utf8')).toContain('bootstrapFreshDatabase');
  expect(fs.readFileSync(path.join(root, 'scripts/lib/fresh-database-bootstrap.js'), 'utf8')).toContain('readMigrationManifest');
});
