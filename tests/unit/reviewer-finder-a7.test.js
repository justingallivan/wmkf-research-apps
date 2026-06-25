/**
 * A7 prompt-injection hardening tests for the Reviewer Finder (Part 5, #16).
 *
 * Exercises the prompt builders directly — ClaudeReviewerService carries
 * heavy LLM/DB deps, but the A7 surface is the prompt construction:
 *  - createAnalysisPrompt: U-FILE proposal text (wrapped by the service).
 *  - createDiscoveredReasoningPrompt: U-EXT candidate list (wrapped in-builder).
 */

import {
  createAnalysisPrompt,
  createDiscoveredReasoningPrompt,
  ANALYZE_INTEGRITY_BLOCK,
} from '../../shared/config/prompts/reviewer-finder';
import { wrapUntrustedContent, DATA_CLASSES } from '../../lib/utils/ai-payload-boundary';

describe('Reviewer Finder A7 hardening', () => {
  test('createAnalysisPrompt carries the preamble and places the wrapped block last', () => {
    const wrapped = wrapUntrustedContent({
      text: 'proposal body',
      source: 'test',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: 1_000,
    });
    const prompt = createAnalysisPrompt(wrapped.text, 'staff note', ['Excluded Person'], 12, [wrapped.nonce]);

    expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
    expect(prompt).toContain(`[[WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}`);
    expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}]]`);
    // The wrapped proposal block is last — only TRUSTED trailing instructions
    // follow it (the analyze cue + the code-owned integrity guardrail), and no
    // further untrusted content appears after the close sentinel.
    const afterClose = prompt.split(`[[/WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}]]`)[1];
    expect(afterClose.trim()).toBe(
      ('Now analyze the proposal and provide both parts:' + ANALYZE_INTEGRITY_BLOCK).trim(),
    );
    expect(afterClose).not.toContain('[[WMKF-UNTRUSTED-CONTENT');
    // Staff note is a trusted instruction — it appears before the wrapped
    // proposal block's open sentinel (not inside it).
    expect(prompt).toContain('staff note');
    expect(prompt.indexOf('staff note')).toBeLessThan(
      prompt.indexOf(`[[WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}`),
    );
  });

  test('createDiscoveredReasoningPrompt wraps BOTH the U-EXT candidate list and the LLM-derived summary (S222 P0)', () => {
    const prompt = createDiscoveredReasoningPrompt('a proposal summary', [
      { name: 'Dr. A', affiliation: 'Univ X', publications: [{ title: 'Paper One', year: 2024 }] },
      { name: 'Dr. B', affiliation: 'Univ Y', publications: [] },
    ]);
    expect(prompt).toContain('UNTRUSTED CONTENT RULES:');

    // Extract every nonce-delimited block and the text inside it.
    const blockRe = /\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})[^\]]*\]\]([\s\S]*?)\[\[\/WMKF-UNTRUSTED-CONTENT nonce=\1\]\]/g;
    const blocks = [...prompt.matchAll(blockRe)].map((m) => ({ nonce: m[1], inner: m[2] }));
    // Two wrapped blocks now: the summary and the candidate list.
    expect(blocks.length).toBe(2);
    // The preamble names both nonces.
    for (const b of blocks) expect(prompt).toContain(b.nonce);

    const joinedInner = blocks.map((b) => b.inner).join('\n');
    // Candidate names + the formerly-raw summary both land INSIDE sentinels.
    expect(joinedInner).toContain('Dr. A');
    expect(joinedInner).toContain('Paper One');
    expect(joinedInner).toContain('a proposal summary');
    // Regression guard: the summary must NOT appear outside the sentinels.
    const outsideText = prompt.replace(blockRe, '');
    expect(outsideText).not.toContain('a proposal summary');
  });
});
