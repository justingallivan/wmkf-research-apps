/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'lib/db/migrations/041_deliberation_agenda_sends.sql'),
  'utf8',
);
const setup = fs.readFileSync(path.join(root, 'scripts/setup-database.js'), 'utf8');
const store = fs.readFileSync(
  path.join(root, 'lib/services/meeting-tracker/agenda-store.js'),
  'utf8',
);

test('migration 041 and fresh install pin the agenda ledger columns and named constraints', () => {
  for (const field of [
    'operation_id UUID PRIMARY KEY',
    'session_id UUID NOT NULL',
    'agenda_snapshot JSONB NOT NULL',
    'to_recipients JSONB NOT NULL',
    "cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb",
    'subject TEXT NOT NULL',
    'body_text TEXT NOT NULL',
    'body_html TEXT NOT NULL',
    'from_email TEXT NOT NULL',
    'acting_user_system_id UUID',
    "state TEXT NOT NULL DEFAULT 'prepared'",
    'dynamics_email_id UUID',
    'dynamics_statecode INTEGER',
    'dynamics_statuscode INTEGER',
    'send_requested_at TIMESTAMPTZ',
    'sent_at TIMESTAMPTZ',
    'attempt_count INTEGER NOT NULL DEFAULT 0',
    'lease_token UUID',
    'locked_until TIMESTAMPTZ',
    'last_error_code TEXT',
    'last_error_message TEXT',
    'last_failed_at TIMESTAMPTZ',
    'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
  ]) {
    expect(migration).toContain(field);
    expect(setup).toContain(field);
  }
  for (const name of [
    'deliberation_agenda_state_check',
    'deliberation_agenda_recipient_shape',
    'deliberation_agenda_lease_shape',
    'idx_deliberation_agenda_session_history',
    'uq_deliberation_agenda_one_unresolved',
  ]) {
    expect(migration).toContain(name);
    expect(setup).toContain(name);
  }
  expect(migration).toContain("state IN ('prepared', 'activity_created', 'send_requested', 'sent', 'failed')");
  expect(setup).toContain("state IN ('prepared', 'activity_created', 'send_requested', 'sent', 'failed')");
  expect(migration).toContain("WHERE state = 'send_requested'");
  expect(setup).toContain("WHERE state = 'send_requested'");
});

test('agenda status store queries keep sent receipts separate from unresolved sends', () => {
  expect(store).toMatch(/getLatestSentAgendaSend[\s\S]*?AND state = 'sent'[\s\S]*?ORDER BY sent_at DESC NULLS LAST/);
  expect(store).toMatch(/getLatestUnresolvedAgendaSend[\s\S]*?AND state = 'send_requested'[\s\S]*?ORDER BY send_requested_at DESC NULLS LAST/);
});
