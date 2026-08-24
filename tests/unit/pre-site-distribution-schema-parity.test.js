import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/034_pre_site_distribution_attempts.sql'),
  'utf8',
);
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');
const logisticsMigration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/035_site_visit_logistics.sql'),
  'utf8',
);

const CONSTRAINT_NAMES = [
  'pre_site_distribution_mode_check',
  'pre_site_distribution_state_check',
  'pre_site_distribution_recipient_shape',
  'pre_site_distribution_hash_shape',
  'pre_site_distribution_attempt_count_nonnegative',
  'pre_site_distribution_prepared_shape',
  'pre_site_distribution_lease_shape',
  'pre_site_distribution_sent_shape',
];

test('fresh-install and migration sources declare the same named distribution constraints', () => {
  for (const name of CONSTRAINT_NAMES) {
    expect(migration).toContain(`CONSTRAINT ${name}`);
    expect(setup).toContain(`CONSTRAINT ${name}`);
  }
});

test('migration 034 reconciles the legacy anonymous fresh-install constraint names', () => {
  expect(migration).toContain('pre_site_distribution_attempts_attachment_mode_check');
  expect(migration).toContain('pre_site_distribution_attempts_attempt_count_check');
  for (let suffix = 0; suffix <= 4; suffix += 1) {
    const name = suffix === 0
      ? 'pre_site_distribution_attempts_check'
      : `pre_site_distribution_attempts_check${suffix}`;
    expect(migration).toContain(name);
  }
  expect(migration).toContain('RENAME CONSTRAINT');
});

test('migration 035 and fresh install declare the same calendar/link extension constraints', () => {
  for (const name of [
    'pre_site_distribution_hash_shape',
    'pre_site_distribution_material_links_shape',
    'pre_site_distribution_calendar_shape',
  ]) {
    expect(logisticsMigration).toContain(`CONSTRAINT ${name}`);
    expect(setup).toContain(`CONSTRAINT ${name}`);
  }
  for (const column of [
    'preferred_email',
    'calendar_enabled',
    'site_visit_id',
    'site_visit_etag',
    'site_visit_snapshot',
    'material_links',
    'calendar_byte_hash',
    'calendar_attached_at',
  ]) {
    expect(logisticsMigration).toContain(column);
    expect(setup).toContain(column);
  }
});
