#!/usr/bin/env node

// Read-only hosted boundary probe for the dedicated sign-in-only Preview.
// Requests intentionally omit cookies, request bodies, and provider callbacks.
const { spawnSync } = require('node:child_process');

const origin = 'https://wmkf-meeting-transcription-test.vercel.app';
const checks = [
  ['/api/auth/status', 200],
  ['/auth/signin?callbackUrl=%2F', 200],
  ['/api/auth/session', 200],
  ['/api/cron/x', 404],
  ['/api/meeting-tracker/visits', 404],
  ['/api/webhooks/assemblyai', 404],
  ['/.well-known/workflow/v1/flow', 404],
];

let failed = false;
for (const [path, expected] of checks) {
  const result = spawnSync('vercel', [
    'curl', `${origin}${path}`,
    '--scope', 'justin-gallivans-projects',
    '--', '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}',
  ], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024,
  });

  const printedStatus = (result.stdout || '').match(/(?:^|\s)(\d{3})\s*$/)?.[1];
  const status = result.error || result.signal || result.status !== 0 || !printedStatus
    ? 'ERROR'
    : printedStatus;
  console.log(`GET ${path} ${status}`);
  if (status !== String(expected)) failed = true;
}

if (failed) process.exitCode = 1;
