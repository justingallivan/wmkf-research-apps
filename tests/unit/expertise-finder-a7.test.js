/**
 * A7 prompt-injection hardening tests for the Expertise Finder (Part 5, #13).
 *
 * Exercises the prompt builders + output schema directly (the match routes
 * carry heavy DB/Graph deps that an integration test would have to mock
 * wholesale; the A7 surface is the prompt construction + the JSON sink).
 */

import {
  buildCacheableSystemPrompt,
  buildUserPrompt,
} from '../../shared/config/prompts/expertise-finder';
import { wrapUntrustedContent, DATA_CLASSES } from '../../lib/utils/ai-payload-boundary';
import { validateAiJson } from '../../lib/utils/ai-output-schema';
import { EXPERTISE_MATCH_SCHEMA } from '../../shared/config/expertise-finder-output-schema';

describe('Expertise Finder A7 hardening', () => {
  test('cacheable system prompt carries the untrusted-content preamble', () => {
    const sys = buildCacheableSystemPrompt([
      { name: 'A B', role_type: 'Research Program Staff', role: 'PD' },
    ]);
    expect(sys).toContain('UNTRUSTED CONTENT RULES:');
  });

  test('buildUserPrompt embeds the wrapped block; staff notes stay outside it', () => {
    const wrapped = wrapUntrustedContent({
      text: 'proposal body',
      source: 'test',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: 1_000,
    });
    const prompt = buildUserPrompt(wrapped.text, 'staff note here');
    expect(prompt).toContain(`[[WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}`);
    expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}]]`);
    // Staff note is the trusted instruction — outside the sentinels.
    const afterClose = prompt.split(`[[/WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}]]`)[1];
    expect(afterClose).toContain('staff note here');
  });

  test('output schema drops keys an injected model would add', () => {
    const injected = {
      proposal_summary: { title: 'T', evil: 'rm -rf' },
      staff_assignment: { primary: { name: 'X', rationale: 'Y' } },
      __proto__pollution: true,
      consultant_overlap: [{ name: 'C', relevance: 'bogus', rationale: 'R' }],
    };
    const out = validateAiJson(injected, EXPERTISE_MATCH_SCHEMA);
    expect(out.ok).toBe(true);
    expect(out.value.proposal_summary.evil).toBeUndefined();
    expect(out.value.__proto__pollution).toBeUndefined();
    // Out-of-enum relevance is coerced to the safe default.
    expect(out.value.consultant_overlap[0].relevance).toBe('partial');
  });
});
