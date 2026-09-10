import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/044_site_visit_material_slot_leases.sql'), 'utf8');
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');

test('migration 044 and fresh install add the same non-null empty-object slot lease column', () => {
  for (const source of [migration, setup]) {
    expect(source).toContain('ALTER TABLE site_visit_material_collections');
    expect(source).toContain("ADD COLUMN IF NOT EXISTS slot_leases JSONB NOT NULL DEFAULT '{}'::jsonb");
  }
  expect(setup).toContain('const v45Statements = [');
  expect(setup).toContain('Applying v45 schema updates - Applicant material slot leases');
  expect(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8')).toContain('044_site_visit_material_slot_leases.sql');
});
