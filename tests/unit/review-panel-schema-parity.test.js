import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/047_review_panel.sql'), 'utf8');
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');

const TABLE_NAMES = [
  'review_panels', 'review_panel_runs', 'review_panel_entries',
  'review_panel_seat_attempts', 'review_panel_control',
];

const STATE_CHECKS = [
  "CHECK (state IN ('pending','dispatched','completed','failed','unknown_outcome'))",
  "CHECK (cost_state IN ('known','unknown'))",
];

test('migration 047 and fresh install (v49) declare the same review-panel tables and state checks', () => {
  for (const source of [migration, setup]) {
    for (const name of TABLE_NAMES) expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${name}`);
    for (const check of STATE_CHECKS) expect(source).toContain(check);
    expect(source).toContain('UNIQUE (entry_id, seat_key, attempt_no)');
    expect(source).toContain('review_panel_entries_request_revision');
  }
});

test('the migrations manifest tracks 047', () => {
  expect(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8')).toContain('047_review_panel.sql');
});
