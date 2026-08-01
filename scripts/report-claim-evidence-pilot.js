#!/usr/bin/env node
'use strict';

const {
  readObservationEvents,
  summarizeObservationEvents,
} = require('../.claude/hooks/lib/claim-evidence-observations');

function reportText(summary) {
  const lines = [
    'Claim-evidence pilot observation report',
    `Sessions: ${summary.sessionCount} | advisory events: ${summary.eventCount} | claims: ${summary.claimCount}`,
    `Shapes: call-path=${summary.shapeCounts['call-path']} universal=${summary.shapeCounts.universal} count=${summary.shapeCounts.count}`,
  ];
  if (summary.currentSessionKey && !summary.eligibleSessionRecorded) {
    lines.push('Current session: no eligible plan/design documentation edit was recorded; do not add an observation row.');
  }
  for (const session of summary.sessions) {
    lines.push(
      '',
      `Session ${session.sessionKey} (${session.firstSeen} to ${session.lastSeen})`,
      `  events=${session.eventCount} claims=${session.claimCount}`,
      `  shapes: call-path=${session.shapeCounts['call-path']} universal=${session.shapeCounts.universal} count=${session.shapeCounts.count}`,
      `  documents: ${session.documents.join(', ')}`,
    );
  }
  if (summary.invalidFiles) lines.push('', `WARNING: ${summary.invalidFiles} malformed observation file(s) skipped.`);
  if (summary.cleanupErrors) lines.push('', `WARNING: ${summary.cleanupErrors} expired observation file(s) could not be removed.`);
  if (summary.stalePendingFiles) lines.push('', `Maintenance: removed ${summary.stalePendingFiles} stale pending observation file(s).`);
  lines.push(
    '',
    'This report records advisory occurrences only. The session-closing agent must classify usefulness, false positives, repetition, resolution, owner interruption, and sensitive-evidence requests.',
  );
  return `${lines.join('\n')}\n`;
}

function main() {
  try {
    const latestOnly = process.argv.includes('--latest');
    const currentOnly = process.argv.includes('--current');
    const json = process.argv.includes('--json');
    const root = process.cwd();
    const currentSessionKey = currentOnly
      ? String(process.env.WMKF_CLAIM_EVIDENCE_SESSION_KEY || '')
      : null;
    if (currentOnly && !/^[0-9a-f]{16}$/.test(currentSessionKey)) {
      throw new Error('current session key unavailable');
    }
    const {
      events,
      sessions,
      invalidFiles,
      cleanupErrors,
      stalePendingFiles,
    } = readObservationEvents(root, {
      enforceRetention: true,
    });
    const eligibleSessionRecorded = !currentOnly ||
      sessions.some((session) => session.sessionKey === currentSessionKey) ||
      events.some((event) => event.sessionKey === currentSessionKey);
    const summary = summarizeObservationEvents(events, {
      sessions,
      invalidFiles,
      cleanupErrors,
      stalePendingFiles,
      latestOnly,
      onlySessionKey: currentOnly ? currentSessionKey : null,
    });
    summary.eligibleSessionRecorded = eligibleSessionRecorded;
    if (currentOnly) summary.currentSessionKey = currentSessionKey;
    process.stdout.write(json ? `${JSON.stringify(summary, null, 2)}\n` : reportText(summary));
    if (invalidFiles || cleanupErrors) process.exitCode = 1;
  } catch {
    console.error('Claim-evidence observation report unavailable: local state could not be read.');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main, reportText };
