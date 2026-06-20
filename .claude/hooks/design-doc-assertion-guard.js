#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Write|Edit): design-doc assertion guard.
 *
 * When writing/editing a durable design/plan/architecture doc that contains a
 * material STATE / STORAGE / ARCHITECTURE claim, inject a non-blocking reminder
 * that every such claim must be grounded in a source file READ THIS SESSION
 * (cited [VERIFIED via <file:line>]) or labeled [ASSUMED] — never asserted from
 * memory/inference. Run the disconfirming check, not just a confirming one.
 *
 * This guard exists because an ungrounded "preferences live in Postgres" claim
 * propagated into a committed plan doc (S271) and was only caught in Codex review.
 *
 * Scope: file under docs/ ending .md, OR filename contains PLAN. Fires only when
 * the written content contains a storage/architecture claim, to keep noise down.
 * FAILS OPEN: any parse error / missing field exits 0 silently — never blocks.
 */
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
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

    // Content being written: Write→content, Edit→new_string.
    const content = typeof ti.content === 'string'
      ? ti.content
      : (typeof ti.new_string === 'string' ? ti.new_string : '');
    if (!content) return;

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
    // fail open — never block a write/edit
  }
});
