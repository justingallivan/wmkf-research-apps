#!/usr/bin/env node

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  HELD_CRON_PATH,
  checkReviewerReminderHold,
  validateVercelConfig,
} = require('./check-reviewer-reminder-hold');

function expectPass(config, label) {
  assert.deepEqual(validateVercelConfig(config), [], label);
}

function expectFail(config, pattern, label) {
  const errors = validateVercelConfig(config);
  assert.ok(errors.length > 0, `${label}: expected at least one error`);
  assert.match(errors.join('\n'), pattern, label);
}

expectPass(
  {
    crons: [
      { path: '/api/cron/sweep-stale-invites', schedule: '0 10 * * *' },
      { path: '/api/cron/reviewer-reminders-preview', schedule: '0 11 * * *' },
    ],
  },
  'unrelated cron entries and lookalike paths must remain allowed',
);

expectFail(
  {
    crons: [
      { path: '/api/cron/sweep-stale-invites', schedule: '0 10 * * *' },
      { path: HELD_CRON_PATH, schedule: '0 10 * * *' },
    ],
  },
  /incident hold/,
  'the exact held route must fail',
);
expectFail(
  { crons: [{ path: `${HELD_CRON_PATH}?dryRun=1`, schedule: '0 10 * * *' }] },
  /incident hold/,
  'the held route with a query string must fail',
);

expectFail({}, /crons array/, 'a missing cron registry must fail closed');
expectFail(
  { crons: null },
  /crons array/,
  'a non-array cron registry must fail closed',
);
expectFail(
  { crons: [null] },
  /must be an object/,
  'a malformed cron entry must fail closed',
);
expectFail(
  { crons: [{ schedule: '0 10 * * *' }] },
  /path must be a non-empty string/,
  'a cron entry without a path must fail closed',
);

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-reminder-hold-'));
const malformedConfigPath = path.join(fixtureDir, 'vercel.json');
try {
  fs.writeFileSync(malformedConfigPath, '{ not valid json', 'utf8');
  assert.match(
    checkReviewerReminderHold(malformedConfigPath).join('\n'),
    /Unable to read valid JSON/,
    'invalid JSON must fail closed',
  );
} finally {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}

const alternateConfigFixtureDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'reviewer-reminder-hold-alternate-'),
);
try {
  const fixtureConfigPath = path.join(alternateConfigFixtureDir, 'vercel.json');
  fs.writeFileSync(fixtureConfigPath, JSON.stringify({ crons: [] }), 'utf8');
  fs.writeFileSync(
    path.join(alternateConfigFixtureDir, 'vercel.ts'),
    'export const config = { crons: [] };',
    'utf8',
  );
  assert.match(
    checkReviewerReminderHold(fixtureConfigPath).join('\n'),
    /could supersede vercel\.json/,
    'an alternate Vercel config must fail closed',
  );
} finally {
  fs.rmSync(alternateConfigFixtureDir, { recursive: true, force: true });
}

console.log('Reviewer reminder incident hold self-test passed.');
