#!/usr/bin/env node
'use strict';

/**
 * Reasoned allowlist for check:secret-scan.
 *
 * Keep this list small. Prefer tightening the detector's real-secret thresholds
 * or placeholder markers first; add an entry here only when a tracked file must
 * contain a real secret-shaped literal for a documented reason.
 *
 * Entry shape:
 *   {
 *     file: 'path/from/repo/root',
 *     match: 'stable substring from the flagged line',
 *     reason: 'why this literal is safe to keep tracked',
 *   }
 */

module.exports = [
  {
    file: 'tests/unit/reviewer-warm-validation-service.test.js',
    match: 'cannot-verify-history',
    reason:
      'Deliberately fake rotated-secret fixture for legacy-attestation fail-closed tests; the 41-char human-readable sentence is not a real credential.',
  },
];
