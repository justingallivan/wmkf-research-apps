import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/042_site_visit_material_collections.sql'), 'utf8');
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');

const CONSTRAINT_NAMES = [
  'site_visit_material_status_check',
  'site_visit_material_digest_shape',
  'site_visit_material_checklist_shape',
  'site_visit_material_contacts_shape',
  'site_visit_material_window_shape',
  'site_visit_material_reminders_nonnegative',
];

test('migration 042 and fresh install declare the collection table, its constraints, and the one-open-per-request index', () => {
  for (const source of [migration, setup]) {
    expect(source).toContain('CREATE TABLE IF NOT EXISTS site_visit_material_collections');
    for (const name of CONSTRAINT_NAMES) expect(source).toContain(`CONSTRAINT ${name}`);
    expect(source).toContain('site_visit_material_collections_open_request');
    expect(source).toMatch(/WHERE status <> 'closed'/);
  }
  expect(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8')).toContain('042_site_visit_material_collections.sql');
});
