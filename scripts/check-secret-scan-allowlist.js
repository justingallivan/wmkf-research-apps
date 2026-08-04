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
  // No current-tree exemptions. Every future entry must carry a reason.
];
