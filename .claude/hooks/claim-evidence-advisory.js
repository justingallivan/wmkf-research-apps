#!/usr/bin/env node
'use strict';

/*
 * PreToolUse hook (Write|Edit): advisory-only adjacent-verification pilot.
 *
 * Scope is deliberately narrow: newly introduced descriptive present-state
 * text in plan/design docs, carrying [VERIFIED] plus a call-path, universal,
 * negative, or count qualifier. The hook checks only whether the transcript
 * contains a useful query shape; it does not claim the query or result proves
 * the sentence. Internal errors report a bounded diagnostic and fail open.
 */

const fs = require('fs');
const path = require('path');
const {
  isPlanOrDesignDoc,
  newlyIntroducedText,
  proposedTextForTool,
  repoRelative,
  resolveInside,
} = require('./lib/document-guards');
const {
  findClaimEvidenceObligations,
  missingClaimEvidence,
} = require('./lib/claim-evidence');

function remedyFor(claim) {
  const remedies = [];
  if (claim.shapes.includes('call-path')) {
    const subject = claim.symbols.length ? ` for \`${claim.symbols[0]}\`` : '';
    const scope = claim.scopes.length ? ` across \`${claim.scopes.join('` and `')}\`` : '';
    remedies.push(`trace callers${subject}${scope} from an entry point with CodeGraph or a repo-scoped rg, then inspect relevant consumers`);
  }
  if (claim.shapes.includes('universal')) {
    const scope = claim.scopes.length ? ` across \`${claim.scopes.join('` and `')}\`` : ' across the named domain';
    remedies.push(`enumerate the complement${scope} (for example, rg -L/--files-without-match)`);
  }
  if (claim.shapes.includes('count')) {
    remedies.push('enumerate matches and derive the denominator independently (for example, rg -l plus a separate rg --files census)');
  }
  return remedies.join('; ');
}

function redactedClaim(sentence) {
  return String(sentence || '')
    .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*[^\s,;]+/gi, '[redacted-secret]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|xoxb-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,})\b/g, '[redacted-secret]');
}

function introducedClaimText(data, root, rel, proposed) {
  const introduced = newlyIntroducedText(data, root);
  if (!introduced || data.tool_name !== 'Edit') return introduced;

  const full = resolveInside(root, rel);
  const oldString = typeof data.tool_input?.old_string === 'string' ? data.tool_input.old_string : '';
  if (!full || !oldString || !fs.existsSync(full)) return introduced;
  const oldIndex = fs.readFileSync(full, 'utf8').indexOf(oldString);
  if (oldIndex < 0) return introduced;

  const lineStart = proposed.lastIndexOf('\n', Math.max(0, oldIndex - 1)) + 1;
  const nextBreak = proposed.indexOf('\n', oldIndex);
  const lineEnd = nextBreak < 0 ? proposed.length : nextBreak;
  const touchedLine = proposed.slice(lineStart, lineEnd);
  return /\[VERIFIED(?:\s+via[^\]]+)?\]/i.test(touchedLine)
    ? `${introduced}\n${touchedLine}`
    : introduced;
}

function advisory(missing) {
  const details = missing.slice(0, 3).map((claim) =>
    `  - Claim: ${redactedClaim(claim.sentence).slice(0, 240)}\n    Query shape: ${remedyFor(claim)}.`
  ).join('\n');
  return [
    'CLAIM-EVIDENCE ADVISORY: a new [VERIFIED] present-state claim has an unchecked adjacent-verification obligation.',
    details,
    'This checks query shape, not semantic proof. Keep any recorded evidence bounded and redacted; never include secrets, environment values, or unrelated live records.',
    'Run the missing query, narrow the claim, or label it [ASSUMED]. See .claude/rules/claim-evidence.md.',
  ].join('\n');
}

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    if (!data || !['Write', 'Edit'].includes(data.tool_name)) return;

    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const filePath = typeof data.tool_input?.file_path === 'string' ? data.tool_input.file_path : '';
    if (!filePath) return;
    const rel = repoRelative(root, filePath);
    if (!/^docs\/.*\.md$/i.test(rel)) return;

    const proposed = proposedTextForTool(data, root);
    if (!proposed || !isPlanOrDesignDoc(rel, proposed)) return;
    const introduced = introducedClaimText(data, root, rel, proposed);
    if (!introduced) return;

    const claims = findClaimEvidenceObligations(introduced);
    if (!claims.length) return;

    const transcriptPath = typeof data.transcript_path === 'string' ? data.transcript_path : '';
    const transcript = transcriptPath && fs.existsSync(transcriptPath)
      ? fs.readFileSync(transcriptPath, 'utf8')
      : '';
    const missing = missingClaimEvidence(transcript, claims);
    if (!missing.length) return;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: advisory(missing),
      },
    }));
  } catch {
    console.error('CLAIM-EVIDENCE ADVISORY skipped: internal hook error (fail-open).');
  }
});
