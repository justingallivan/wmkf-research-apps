#!/usr/bin/env node

/**
 * Binding self-test for the Reviewer Find warm-observation inventory gate.
 * It first proves the live baseline is clean, then masks one real negative-
 * control marker in memory and requires the gate to fail. No source is edited.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(root, 'scripts/check-reviewer-find-warm-observation-inventory.mjs');

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [gate], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
}

const baseline = run();
if (baseline.status !== 0) {
  throw new Error(`warm-observation baseline must pass before self-test:\n${baseline.stdout}${baseline.stderr}`);
}

const masked = run({ REVIEWER_FIND_WARM_OBSERVATION_TEST_DROP_MARKER: 'claude' });
if (masked.status === 0 || !/negative-control marker is not dynamically instrumented/.test(`${masked.stdout}${masked.stderr}`)) {
  throw new Error(`warm-observation self-test expected the masked Claude marker to fail:\n${masked.stdout}${masked.stderr}`);
}

console.log('Reviewer Find warm observation self-test passed.');
