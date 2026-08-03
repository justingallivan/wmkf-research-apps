#!/usr/bin/env node

/**
 * Static contract gate for Reviewer Find warm GET observation.
 *
 * It does not infer reachability from names.  Instead it verifies the explicit
 * post-auth inventory covers every normalized effect family. Every positive
 * control and every declared negative control must name a real, sanctioned
 * runtime call site containing the observation helper and its bounded marker.
 * This makes a future warm path through one of those named seams visible in the
 * live ledger; it is not a global raw SQL/fetch/Blob interception mechanism.
 * A prose non-reachability declaration alone cannot satisfy this gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import observationModule from '../lib/services/workbench/reviewer-find-warm-observation.js';

const {
  EFFECT_CLASSES,
  POST_AUTH_SCOPE,
  REVIEWER_FIND_WARM_REACHABILITY_INVENTORY,
} = observationModule;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const testDropMarkerFor = process.env.REVIEWER_FIND_WARM_OBSERVATION_TEST_DROP_MARKER || null;

function expect(condition, message) {
  if (!condition) errors.push(message);
}

expect(
  POST_AUTH_SCOPE === 'authenticated_reviewer_roster_cached_or_reconciled_get',
  'Observation scope must stay explicitly post-auth and limited to cached/reconciled Reviewer Roster GET.',
);

const representedClasses = new Set();
for (const entry of REVIEWER_FIND_WARM_REACHABILITY_INVENTORY) {
  expect(typeof entry.id === 'string' && entry.id.length > 0, 'Every inventory entry needs a stable id.');
  expect(Array.isArray(entry.modes) && entry.modes.length > 0, `${entry.id}: modes are required.`);
  expect(entry.modes.every((mode) => mode === 'cached' || mode === 'reconciled'), `${entry.id}: unknown warm mode.`);
  expect(EFFECT_CLASSES.includes(entry.effectClass), `${entry.id}: unknown effect class ${entry.effectClass}.`);
  representedClasses.add(entry.effectClass);

  if (!entry.reachable) {
    expect(
      typeof entry.nonReachabilityReason === 'string' && entry.nonReachabilityReason.length > 0,
      `${entry.id}: a non-reachable effect family needs a named reason.`,
    );
    expect(Array.isArray(entry.chokepoints) && entry.chokepoints.length > 0, `${entry.id}: negative control needs chokepoints.`);
    expect(Array.isArray(entry.markers) && entry.markers.length > 0, `${entry.id}: negative control needs markers.`);
    const sources = (entry.chokepoints || []).map((chokepoint) => {
      const target = path.join(root, chokepoint);
      expect(fs.existsSync(target), `${entry.id}: negative-control chokepoint does not exist: ${chokepoint}`);
      const source = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      // Test-only source masking proves that a prose reason cannot keep this
      // gate green after an instrumentation marker disappears. It never writes
      // to the worktree and is ignored unless the self-test sets the exact id.
      return testDropMarkerFor === entry.id && entry.markers?.[0]
        ? source.replace(entry.markers[0], '')
        : source;
    });
    for (const marker of entry.markers || []) {
      expect(
        sources.some((source) => source.includes('observeReviewerFindWarmEffect') && source.includes(marker)),
        `${entry.id}: negative-control marker is not dynamically instrumented: ${marker}`,
      );
    }
    continue;
  }

  expect(typeof entry.caller === 'string' && entry.caller.length > 0, `${entry.id}: reachable entry needs a caller path.`);
  expect(typeof entry.operation === 'string' && /^[a-z][a-z0-9_]{2,79}$/.test(entry.operation), `${entry.id}: invalid operation.`);
  expect(typeof entry.chokepoint === 'string' && entry.chokepoint.length > 0, `${entry.id}: reachable entry needs a chokepoint.`);
  expect(typeof entry.marker === 'string' && entry.marker.length > 0, `${entry.id}: reachable entry needs an instrumentation marker.`);
  if (!entry.chokepoint || !entry.marker) continue;

  const target = path.join(root, entry.chokepoint);
  expect(fs.existsSync(target), `${entry.id}: chokepoint does not exist: ${entry.chokepoint}`);
  if (!fs.existsSync(target)) continue;
  const source = fs.readFileSync(target, 'utf8');
  expect(source.includes('observeReviewerFindWarmEffect'), `${entry.id}: chokepoint is missing the observation helper.`);
  expect(source.includes(entry.marker), `${entry.id}: chokepoint is missing its operation marker.`);
}

for (const effectClass of EFFECT_CLASSES) {
  expect(representedClasses.has(effectClass), `Effect family is absent from the warm inventory: ${effectClass}`);
}

const routeSource = fs.readFileSync(path.join(root, 'pages/api/workbench/reviewer-roster.js'), 'utf8');
expect(routeSource.includes('observationFromRequest(req)'), 'Reviewer Roster route must establish the scoped observation context.');
expect(routeSource.includes('withReviewerFindWarmObservation'), 'Reviewer Roster route must run cached/reconciled work inside the observation scope.');
const authIndex = routeSource.indexOf('const access = await requireAppAccess');
const observationIndex = routeSource.indexOf('const observation = observationFromRequest(req)');
const scopeIndex = routeSource.indexOf('withReviewerFindWarmObservation(observation');
expect(
  authIndex >= 0 && observationIndex > authIndex && scopeIndex > observationIndex,
  'Observation must begin after normal requireAppAccess; auth/session reads are outside the warm-effect ledger.',
);

if (errors.length > 0) {
  console.error('Reviewer Find warm observation inventory check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const reachable = REVIEWER_FIND_WARM_REACHABILITY_INVENTORY.filter((entry) => entry.reachable).length;
  const nonReachable = REVIEWER_FIND_WARM_REACHABILITY_INVENTORY.length - reachable;
  console.log(`Reviewer Find warm observation inventory passed (${reachable} reachable chokepoints, ${nonReachable} explicit non-reachable families).`);
}
