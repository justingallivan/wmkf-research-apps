import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/050_expertise_roster_contact_link.sql'),
  'utf8',
);
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');

const ACTIVE_CONTACT_INDEX = /CREATE UNIQUE INDEX IF NOT EXISTS idx_expertise_roster_active_contact\s+ON expertise_roster \(dataverse_contact_id\)\s+WHERE dataverse_contact_id IS NOT NULL AND is_active = true/;

test('migration 050 and fresh install both declare the nullable Contact link', () => {
  expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS dataverse_contact_id UUID/);
  expect(setup).toMatch(/dataverse_contact_id UUID/);
});

test('migration 050 and fresh install use the same active-row-only unique index', () => {
  expect(migration).toMatch(ACTIVE_CONTACT_INDEX);
  expect(setup).toMatch(ACTIVE_CONTACT_INDEX);
});
