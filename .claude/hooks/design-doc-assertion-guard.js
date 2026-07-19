#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Write|Edit): design-doc assertion guard.
 *
 * Two deliberately different contracts:
 *   1. BLOCK a narrow, machine-detectable high-risk pattern: a real email
 *      ownership/identity assertion with no evidence or uncertainty label.
 *   2. Keep the broader STATE / STORAGE / ARCHITECTURE reminder advisory.
 *
 * This guard exists because an ungrounded "preferences live in Postgres" claim
 * propagated into a committed plan doc (S271) and was only caught in Codex review.
 *
 * Scope: file under docs/ ending .md, OR filename contains PLAN. The email
 * blocker runs first; the advisory reminder fires only for storage/architecture
 * claim signals, to keep its noise down.
 * Visible escapes for (1): add a URL/path:line/[VERIFIED via ...], label the
 * claim [ASSUMED]/hedge it, or mark non-claims only with one of:
 *   <!-- assertion-exempt: quoted-example -->
 *   <!-- assertion-exempt: hypothetical -->
 *   <!-- assertion-exempt: template -->
 *
 * FAILS OPEN on parse/helper errors. The registered command must preserve the
 * intentional exit 2; .claude/settings.json is covered by an integration test.
 */
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const path = require('path');
    const {
      findUnverifiedReviewerEmailOwnershipClaims,
      newlyIntroducedText,
    } = require('./lib/document-guards');
    const data = JSON.parse(input);
    if (!data || (data.tool_name !== 'Write' && data.tool_name !== 'Edit')) return;
    const ti = data.tool_input || {};
    const fp = typeof ti.file_path === 'string' ? ti.file_path : '';
    if (!fp) return;

    const base = fp.split('/').pop() || '';
    const inScope =
      (/(^|\/)docs\//.test(fp) && /\.md$/i.test(fp)) ||
      /PLAN/i.test(base);
    if (!inScope) return;

    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const content = newlyIntroducedText(data, root);
    if (!content) return;

    const unverifiedClaims = findUnverifiedReviewerEmailOwnershipClaims(content);
    if (unverifiedClaims.length) {
      const details = unverifiedClaims.slice(0, 3).map(({ sentence, emails }) =>
        `  - ${emails.join(', ')}: ${sentence.slice(0, 240)}`
      ).join('\n');
      console.error(
        'BLOCKED: reviewer-email ownership/identity claim lacks evidence or an uncertainty label.\n' +
        `${details}\n` +
        'Add a source URL, path:line, or [VERIFIED via <source>] in the same sentence; ' +
        'hedge/label it [ASSUMED]; or, only for non-claims, use ' +
        '<!-- assertion-exempt: quoted-example|hypothetical|template -->.'
      );
      process.exit(2);
    }

    // Material state/storage/architecture claim signals.
    const CLAIM = /(\bPostgres\b|\bDataverse\b|\bNeon\b|\bBlob\b|stored in|lives in|source of truth|backed by|keyed by|\[VERIFIED|\[ASSUMED|\bsource-of-truth\b)/i;
    if (!CLAIM.test(content)) return;

    const msg =
      'DESIGN-DOC ASSERTION GUARD: you are writing a state/storage/architecture claim into a durable ' +
      'doc. Before this lands: each material claim must be grounded in a source file you READ THIS ' +
      'SESSION — cite it as [VERIFIED via <file:line>], or label it [ASSUMED]. Do NOT write a bare or ' +
      '[VERIFIED] storage/architecture claim from memory or inference. Run the DISCONFIRMING check ' +
      '(grep the actual store/caller — e.g. which service the data layer delegates to), not just a ' +
      'confirming one. (This guard exists because an ungrounded "preferences live in Postgres" claim ' +
      'propagated into a plan doc, S271 — they were in Dataverse.)';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // Internal errors fail open; matched reviewer-email claims exit above.
  }
});
