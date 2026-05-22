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
    // The wrapped proposal block is last — only the trailing instruction
    // follows it.
    const afterClose = prompt.split(`[[/WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}]]`)[1];
    expect(afterClose.trim()).toBe('Now analyze the proposal and provide all three parts:');
    // Staff note is a trusted instruction — it appears before the wrapped
    // proposal block's open sentinel (not inside it).
    expect(prompt).toContain('staff note');
    expect(prompt.indexOf('staff note')).toBeLessThan(
      prompt.indexOf(`[[WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}`),
    );
  });

  test('createDiscoveredReasoningPrompt wraps the U-EXT candidate list', () => {
    const prompt = createDiscoveredReasoningPrompt('a proposal summary', [
      { name: 'Dr. A', affiliation: 'Univ X', publications: [{ title: 'Paper One', year: 2024 }] },
      { name: 'Dr. B', affiliation: 'Univ Y', publications: [] },
    ]);
    expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
    const open = prompt.match(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/);
    expect(open).not.toBeNull();
    expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${open[1]}]]`);
    // Candidate names land inside the sentinels.
    const inner = prompt.split(open[0])[1].split('[[/WMKF-UNTRUSTED-CONTENT')[0];
    expect(inner).toContain('Dr. A');
    expect(inner).toContain('Paper One');
  });
});
