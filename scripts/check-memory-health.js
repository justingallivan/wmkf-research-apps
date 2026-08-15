#!/usr/bin/env node
/**
 * scripts/check-memory-health.js
 *
 * ADVISORY (report-only) memory-hygiene check for `.claude-memory/`, per
 * docs/audits/memory-hygiene-control-audit-2026-07-02.md "Slice 5 — Advisory
 * enforcement". It complements the structural `check:memory-router` gate, which
 * proves links + status metadata but NOT semantic freshness.
 *
 * `check:memory-router` answers "is the store structurally valid?".
 * This script answers "which ACTIVE memories are likely to mislead an agent?" —
 * the worklist a code-grounded triage pass should work through.
 *
 * It NEVER fails the build (always exit 0) and never edits files. It is a
 * flashlight, not a gate. Only after the report is stable should any individual
 * signal be promoted to fail-closed (audit "Non-Goals" + Slice 5).
 *
 * Signals reported per ACTIVE leaf memory (MEMORY.md and non-active files skipped
 * except where noted):
 *   - no-recall-rule   : active file with no `## Recall Rule` heading — trigger /
 *                        do / do-not / ground-truth shape is not normalized.
 *   - weak-basis       : active file that makes a structural/live-state claim AND
 *                        whose `last_verified` is missing, empty, or says unknown /
 *                        not re-probed / not yet verified — the verification basis
 *                        is old memory-content, so recall is likely stale. Purely
 *                        behavioral (feedback-*) rules are NOT flagged: they have
 *                        nothing to probe, so an absent last_verified is expected.
 *   - oversize-routed  : active file over BYTE_THRESHOLD that is also routed from
 *                        MEMORY.md — a large influential file most worth splitting
 *                        active hazards from historical narrative.
 *   - shadow-atlas     : active file that states structural live-state terms
 *                        (Postgres, Dataverse, table, entity, row count, read/write
 *                        path, migration, dropped) with NO nearby Atlas / source-file
 *                        / probe / [VERIFIED] pointer — memory acting as a shadow
 *                        Atlas. Verify against source/Atlas/probe before trusting.
 *
 * Signals reported for ANY status:
 *   - stale-routed     : status stale/superseded but still directly linked from
 *                        MEMORY.md (a retired memory an agent can still be routed to).
 *
 * Flags:
 *   --json   emit the per-file findings as JSON (machine-readable triage worklist)
 *   --quiet  suppress the per-file listing; print only the summary counts
 *
 * This intentionally has no `:self-test`. Like `check:memory-drift`, it is an
 * advisory read-only reporter, not a fail-closed gate with synthetic fixtures.
 */

const fs = require('fs');
const path = require('path');

const MEM_DIR = path.join(__dirname, '..', '.claude-memory');
const MEMORY_MD = path.join(MEM_DIR, 'MEMORY.md');

// A routed active file over this size is worth splitting active hazards from
// historical narrative. Advisory only; tune as the store shrinks.
const BYTE_THRESHOLD = 5 * 1024;

// last_verified prose that means "the basis is old memory-content, not a probe".
const WEAK_BASIS_RE = /unknown|not re-?probed|not yet (?:counted|derived|verified|re-?probed)|to be (?:confirmed|counted|verified)|from memory[- ]content/i;

// Structural live-state vocabulary — the kind of claim that belongs in the Atlas
// / source / a probe, not frozen in memory prose.
const STRUCTURAL_RE = /\b(Postgres|Dataverse|Dynamics|\btable\b|\bentity\b|row count|\brows\b|read path|write path|migration|dropped|source of truth|wmkf_[a-z]+)\b/i;

// Evidence that a structural claim IS grounded — an Atlas/source/probe pointer.
const GROUNDED_RE = /APPLICATION_STATE_ATLAS|docs\/atlas\/|\[VERIFIED|\bprobe(d)?\b|\.sql\b|\.js\b|migrations?\//i;

function parseFrontmatter(raw) {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return { block: null, status: null, lastVerified: null };
  const block = fm[1];
  const statusMatch = block.match(/^\s*status:\s*(.+?)\s*$/m);
  const lvMatch = block.match(/^\s*last_verified:\s*(.*?)\s*$/m);
  return {
    block,
    status: statusMatch ? statusMatch[1].replace(/^['"]|['"]$/g, '') : null,
    lastVerified: lvMatch ? lvMatch[1].replace(/^['"]|['"]$/g, '') : null,
  };
}

/**
 * Pure analyzer over a memory directory. Returns { findings, counts, routedSet }.
 * findings: [{ file, status, bytes, flags: [] }]
 */
function analyzeStore(memDir) {
  const memoryMd = path.join(memDir, 'MEMORY.md');
  const routerRaw = fs.existsSync(memoryMd) ? fs.readFileSync(memoryMd, 'utf8') : '';
  const routedSet = new Set(
    (routerRaw.match(/[A-Za-z0-9._/-]+\.md/g) || []).map((r) => path.basename(r))
  );

  const files = fs.readdirSync(memDir)
    .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
    .sort();

  const findings = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(memDir, f), 'utf8');
    const { block, status, lastVerified } = parseFrontmatter(raw);
    const bytes = Buffer.byteLength(raw, 'utf8');
    const body = block ? raw.slice(raw.indexOf('---', 3) + 3) : raw;
    const flags = [];

    // Any-status signal: retired but still routed.
    if ((status === 'stale' || status === 'superseded') && routedSet.has(f)) {
      flags.push('stale-routed');
    }

    if (status === 'active') {
      if (!/^##\s+Recall Rule\s*$/m.test(body)) flags.push('no-recall-rule');

      const makesStructuralClaim = STRUCTURAL_RE.test(body);
      // Feedback memories encode behavioral rules learned from owner correction.
      // Their basis is the correction itself, not a live-state probe; requiring a
      // `last_verified` date would contradict this check's documented contract.
      const isBehavioralFeedback = f.startsWith('feedback-');
      if (makesStructuralClaim && !isBehavioralFeedback
        && (!lastVerified || WEAK_BASIS_RE.test(lastVerified))) {
        flags.push('weak-basis');
      }

      if (bytes > BYTE_THRESHOLD && routedSet.has(f)) flags.push('oversize-routed');

      if (STRUCTURAL_RE.test(body) && !GROUNDED_RE.test(body)) flags.push('shadow-atlas');
    }

    if (flags.length) findings.push({ file: f, status, bytes, routed: routedSet.has(f), flags });
  }

  const counts = {
    filesScanned: files.length,
    flagged: findings.length,
    'no-recall-rule': 0,
    'weak-basis': 0,
    'oversize-routed': 0,
    'shadow-atlas': 0,
    'stale-routed': 0,
  };
  for (const fnd of findings) for (const fl of fnd.flags) counts[fl] += 1;

  return { findings, counts, routedSet };
}

function main() {
  const asJson = process.argv.includes('--json');
  const quiet = process.argv.includes('--quiet');

  if (!fs.existsSync(MEM_DIR)) {
    console.log('memory-health: no .claude-memory directory — nothing to check.');
    return;
  }

  const { findings, counts } = analyzeStore(MEM_DIR);

  if (asJson) {
    process.stdout.write(JSON.stringify({ counts, findings }, null, 2) + '\n');
    return;
  }

  if (!quiet) {
    // Group by flag so the report reads as a prioritized worklist.
    const byFlag = {};
    for (const fnd of findings) {
      for (const fl of fnd.flags) {
        (byFlag[fl] ||= []).push(fnd);
      }
    }
    const order = ['shadow-atlas', 'weak-basis', 'no-recall-rule', 'oversize-routed', 'stale-routed'];
    for (const fl of order) {
      const rows = byFlag[fl];
      if (!rows || !rows.length) continue;
      console.log(`\n[${fl}] ${rows.length} file(s):`);
      for (const r of rows) {
        console.log(`  - ${r.file}  (${r.status}, ${r.bytes}B${r.routed ? ', routed' : ''})`);
      }
    }
  }

  console.log('\n--- memory-health summary (ADVISORY — never fails) ---');
  console.log(`  files scanned:     ${counts.filesScanned}`);
  console.log(`  files flagged:     ${counts.flagged}`);
  console.log(`  shadow-atlas:      ${counts['shadow-atlas']}`);
  console.log(`  weak-basis:        ${counts['weak-basis']}`);
  console.log(`  no-recall-rule:    ${counts['no-recall-rule']}`);
  console.log(`  oversize-routed:   ${counts['oversize-routed']}`);
  console.log(`  stale-routed:      ${counts['stale-routed']}`);
  console.log('\nAdvisory only. Feed this into a code-grounded triage pass; verify every');
  console.log('structural claim against source/Atlas/probe before changing memory.');
}

module.exports = { analyzeStore, parseFrontmatter, BYTE_THRESHOLD };

if (require.main === module) main();
