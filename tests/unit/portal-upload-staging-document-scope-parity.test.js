import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('migration 043 and fresh install both admit the site_visit_material staging scope', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/043_portal_upload_staging_document_scope.sql'), 'utf8');
  const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');
  for (const source of [migration, setup]) {
    expect(source).toContain('portal_upload_staging_scope_check');
    expect(source).toMatch(/'grantee_image',\s*'staff_grantee_image',\s*'site_visit_material'/);
  }
  expect(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8')).toContain('043_portal_upload_staging_document_scope.sql');
});
