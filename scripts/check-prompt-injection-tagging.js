#!/usr/bin/env node
/**
 * CI gate: prompt-injection tagging coverage (A7).
 *
 * A7 hardens LLM-input surfaces so untrusted (attacker/applicant-influenced)
 * text is wrapped in nonce-bearing sentinels via `wrapUntrustedContent` and
 * the matching prompt carries the `buildUntrustedContentPreamble` rule. See
 * `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md`.
 *
 * This gate is the durable anti-drift control. It is REGISTRY-based, not a
 * dataflow heuristic — the Codex review of the A7 plan recommended a concrete
 * call-site inventory over a fragile static scan. The registry below mirrors
 * the plan's inventory table. Each surface is either:
 *
 *   - status 'migrated' — its prompt file(s) MUST reference
 *     `buildUntrustedContentPreamble` and its call-site file(s) MUST
 *     reference `wrapUntrustedContent`. If a migrated surface loses either
 *     marker, this gate fails (a regression caught mechanically).
 *
 *   - status 'pending'  — not yet hardened (a later A7 Part). Tracked, not
 *     enforced. As Parts 2-6 land, surfaces move pending -> migrated here in
 *     the same commit.
 *
 * It also flags DRIFT from new work: any prompt-builder file under
 * `shared/config/prompts/` that is not referenced by ANY registry surface is
 * reported — a new LLM surface was added without registering it.
 *
 * Usage:   node scripts/check-prompt-injection-tagging.js
 * Exit 0 — all migrated surfaces carry their markers, no unregistered prompt files.
 * Exit 1 — a migrated surface lost a marker, or a prompt file is unregistered.
 *
 * Self-test: scripts/check-prompt-injection-tagging-self-test.js exercises
 * the detection on synthetic fixtures (per the CLAUDE.md mandatory gate order).
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

// Marker tokens a migrated surface must contain.
const PREAMBLE_MARKER = 'buildUntrustedContentPreamble';
const WRAP_MARKER = 'wrapUntrustedContent';

/**
 * The LLM-input surface registry. `inv` is the row number in the A7 plan's
 * inventory table. `promptFiles` must reference the preamble; `callSiteFiles`
 * must reference the wrapper. Paths are repo-relative.
 *
 * Every `.js` under `shared/config/prompts/` must be referenced by exactly
 * one surface's `promptFiles` (or be in PROMPT_FILE_ALLOWLIST) — the
 * unregistered-file check enforces this so a newly added prompt builder
 * cannot escape A7 tracking. Pending surfaces still list `promptFiles` for
 * that reason; the marker enforcement only runs for `migrated` surfaces.
 */
const SURFACES = [
  {
    id: 'grant-reporting-extract',
    inv: 12,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/grant-reporting.js'],
    callSiteFiles: ['pages/api/grant-reporting/extract.js'],
  },
  // ── Pending (later A7 Parts) ──────────────────────────────────────────
  {
    id: 'process-phase-i-writeup',
    inv: 1,
    status: 'pending',
    promptFiles: ['shared/config/prompts/phase-i-writeup.js'],
  },
  {
    id: 'process-phase-i',
    inv: 2,
    status: 'pending',
    promptFiles: ['shared/config/prompts/phase-i-summaries.js'],
  },
  {
    id: 'process-phase-ii',
    inv: 3,
    status: 'pending',
    promptFiles: [
      'shared/config/prompts/proposal-summarizer.js',
      'shared/config/prompts/phase-ii-dynamics.js',
    ],
  },
  {
    id: 'process-legacy',
    inv: 4,
    status: 'pending',
    promptFiles: ['shared/config/prompts/proposal-summarizer-legacy.js'],
  },
  { id: 'qa', inv: 5, status: 'pending' },
  { id: 'refine', inv: 6, status: 'pending' },
  {
    id: 'process-peer-reviews',
    inv: 7,
    status: 'pending',
    promptFiles: [
      'shared/config/prompts/peer-reviewer.js',
      'shared/config/prompts/peer-reviewer-dynamics.js',
    ],
  },
  {
    id: 'evaluate-multi-perspective',
    inv: 8,
    status: 'pending',
    promptFiles: ['shared/config/prompts/multi-perspective-evaluator.js'],
  },
  {
    id: 'analyze-literature',
    inv: 9,
    status: 'pending',
    promptFiles: ['shared/config/prompts/literature-analyzer.js'],
  },
  {
    id: 'analyze-funding-gap',
    inv: 10,
    status: 'pending',
    promptFiles: ['shared/config/prompts/funding-gap-analyzer.js'],
  },
  { id: 'process-expenses', inv: 11, status: 'pending' },
  {
    id: 'expertise-finder',
    inv: 13,
    status: 'pending',
    promptFiles: ['shared/config/prompts/expertise-finder.js'],
  },
  {
    id: 'integrity-screener',
    inv: 14,
    status: 'pending',
    promptFiles: ['shared/config/prompts/integrity-screener.js'],
  },
  {
    id: 'virtual-review-panel',
    inv: 15,
    status: 'pending',
    promptFiles: ['shared/config/prompts/virtual-review-panel.js'],
  },
  {
    id: 'reviewer-finder-analyze',
    inv: 16,
    status: 'pending',
    promptFiles: [
      'shared/config/prompts/reviewer-finder.js',
      'shared/config/prompts/reviewer-finder-dynamics.js',
    ],
  },
  {
    id: 'dynamics-explorer-chat',
    inv: 17,
    status: 'pending',
    promptFiles: ['shared/config/prompts/dynamics-explorer.js'],
  },
  {
    id: 'phase-i-dynamics-v2',
    inv: 18,
    status: 'pending',
    promptFiles: ['shared/config/prompts/phase-i-dynamics.js'],
  },
  { id: 'phase-i-dynamics-legacy', inv: 19, status: 'pending' },
  { id: 'execute-prompt-executor', inv: 20, status: 'pending' },
  { id: 'contact-enrichment', inv: 21, status: 'pending' },
  {
    id: 'reviewer-finder-emails',
    inv: 22,
    status: 'pending',
    promptFiles: ['shared/config/prompts/email-reviewer.js'],
  },
  { id: 'dynamics-explorer-export', inv: 23, status: 'pending' },
  { id: 'cron-log-analysis', inv: 24, status: 'pending' },
];

// Prompt-builder files known NOT to be untrusted-content surfaces (so the
// "unregistered prompt file" check doesn't false-fire). Each needs a reason.
const PROMPT_FILE_ALLOWLIST = {
  // Shared prompt fragments / helpers — composed into other prompts, not a
  // standalone LLM call site of its own.
  'common.js': 'shared prompt fragments, not a standalone LLM surface',
};

/**
 * Validate one surface against the filesystem. Pure-ish: takes a `readFile`
 * so the self-test can drive it with synthetic content.
 *
 * @returns {{ id: string, errors: string[] }}
 */
function checkSurface(surface, readFile) {
  const errors = [];
  if (surface.status !== 'migrated') return { id: surface.id, errors };

  for (const f of surface.promptFiles || []) {
    const content = readFile(f);
    if (content == null) {
      errors.push(`${surface.id}: prompt file missing: ${f}`);
    } else if (!content.includes(PREAMBLE_MARKER)) {
      errors.push(
        `${surface.id}: prompt file ${f} does not reference ${PREAMBLE_MARKER} ` +
          '(migrated surface lost its hardening preamble).',
      );
    }
  }
  for (const f of surface.callSiteFiles || []) {
    const content = readFile(f);
    if (content == null) {
      errors.push(`${surface.id}: call-site file missing: ${f}`);
    } else if (!content.includes(WRAP_MARKER)) {
      errors.push(
        `${surface.id}: call-site file ${f} does not reference ${WRAP_MARKER} ` +
          '(migrated surface lost its untrusted-content wrapping).',
      );
    }
  }
  return { id: surface.id, errors };
}

/**
 * Find prompt-builder files not referenced by any registry surface.
 * @returns {string[]} repo-relative paths
 */
function findUnregisteredPromptFiles(surfaces, listPromptFiles) {
  const registered = new Set();
  for (const s of surfaces) {
    for (const f of s.promptFiles || []) registered.add(f);
  }
  return listPromptFiles().filter(
    (f) => !registered.has(f) && !(path.basename(f) in PROMPT_FILE_ALLOWLIST),
  );
}

// ── Real-filesystem adapters ─────────────────────────────────────────────

function readRepoFile(relPath) {
  const abs = path.join(repoRoot, relPath);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function listRepoPromptFiles() {
  const dir = path.join(repoRoot, 'shared/config/prompts');
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.js') && !e.endsWith('.test.js'))
    .map((e) => `shared/config/prompts/${e}`);
}

function main() {
  const allErrors = [];

  for (const surface of SURFACES) {
    const { errors } = checkSurface(surface, readRepoFile);
    allErrors.push(...errors);
  }

  const unregistered = findUnregisteredPromptFiles(SURFACES, listRepoPromptFiles);
  for (const f of unregistered) {
    allErrors.push(
      `Unregistered prompt-builder file: ${f} — add a SURFACES entry ` +
        '(status pending or migrated) so A7 coverage tracks it.',
    );
  }

  const migrated = SURFACES.filter((s) => s.status === 'migrated');
  const pending = SURFACES.filter((s) => s.status === 'pending');

  if (allErrors.length > 0) {
    console.error('Prompt-injection tagging gate FAILED:\n');
    for (const e of allErrors) console.error(`  ✗ ${e}`);
    console.error(
      `\n${migrated.length} migrated surface(s), ${pending.length} pending. ` +
        'Fix the above before committing.',
    );
    process.exit(1);
  }

  console.log(
    `Prompt-injection tagging OK — ${migrated.length} migrated surface(s) ` +
      `carry their markers, ${pending.length} pending (later A7 Parts).`,
  );
}

if (require.main === module) main();

module.exports = { checkSurface, findUnregisteredPromptFiles, SURFACES };
