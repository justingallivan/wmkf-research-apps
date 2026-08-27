import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/036_scheduled_email_messages.sql'),
  'utf8',
);
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');

const CONSTRAINT_NAMES = [
  'scheduled_email_workflow_check',
  'scheduled_email_status_check',
  'scheduled_email_recipient_shape',
  'scheduled_email_attempt_count_check',
  'scheduled_email_lease_shape',
  'scheduled_email_sent_shape',
  'scheduled_email_stopped_shape',
  'scheduled_email_source_unique',
];

test('migration 036 and fresh install declare the same scheduled-email constraints', () => {
  for (const name of CONSTRAINT_NAMES) {
    expect(migration).toContain(`CONSTRAINT ${name}`);
    expect(setup).toContain(`CONSTRAINT ${name}`);
  }
});

test('migration 036 and fresh install retain the approval, recovery, and audit columns', () => {
  for (const column of [
    'approval_required',
    'recipient_contact_ids',
    'digest_fyi_at',
    'actioned_by_profile_id',
    'dynamics_email_id',
    'send_requested_at',
    'finalized_at',
    'lease_token',
  ]) {
    expect(migration).toContain(column);
    expect(setup).toContain(column);
  }
});

test('the retired review-window/notification columns stay out of both shapes', () => {
  for (const column of [
    'review_available_at',
    'review_lead_days',
    'notification_email_id',
    'notification_lease_token',
    'notified_at',
  ]) {
    expect(migration).not.toContain(column);
    expect(setup).not.toContain(column);
  }
});

test('migration 036 and fresh install keep the same source-level uniqueness contract', () => {
  expect(migration).toContain('CONSTRAINT scheduled_email_source_unique UNIQUE (workflow_type, source_record_id)');
  expect(setup).toContain('CONSTRAINT scheduled_email_source_unique UNIQUE (workflow_type, source_record_id)');
});

test('migration 036 and fresh install both create the per-PD VIP flag table', () => {
  const table = 'CREATE TABLE IF NOT EXISTS scheduled_email_vip_flags';
  const pair = 'PRIMARY KEY (pd_systemuser_id, contact_id)';
  expect(migration).toContain(table);
  expect(setup).toContain(table);
  expect(migration).toContain(pair);
  expect(setup).toContain(pair);
});

test('migration 037 and fresh install both create the reviewer VIP flag table keyed on the person row', () => {
  const migration037 = fs.readFileSync(
    path.join(ROOT, 'lib/db/migrations/037_reviewer_vip_flags.sql'),
    'utf8',
  );
  const table = 'CREATE TABLE IF NOT EXISTS scheduled_email_reviewer_vip_flags';
  // Person-keyed by design: candidates have no CRM contact pre-acceptance (S389).
  const key = 'PRIMARY KEY (pd_systemuser_id, potential_reviewer_id)';
  for (const fragment of [table, key]) {
    expect(migration037).toContain(fragment);
    expect(setup).toContain(fragment);
  }
  expect(migration037).not.toContain('contact_id');
});

test('migration 036 and fresh install both create the digest run ledger with the per-day claim key', () => {
  const table = 'CREATE TABLE IF NOT EXISTS scheduled_email_digest_runs';
  const claimKey = 'PRIMARY KEY (pd_systemuser_id, digest_day)';
  const membershipShape = 'CONSTRAINT scheduled_email_digest_membership_shape';
  for (const fragment of [table, claimKey, membershipShape, 'fyi_message_ids', 'fyi_stamped_at']) {
    expect(migration).toContain(fragment);
    expect(setup).toContain(fragment);
  }
});
