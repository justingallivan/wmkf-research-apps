/**
 * A7 prompt-injection hardening tests for the Expertise Finder (Part 5, #13).
 *
 * Exercises the composed prompt (bundled row + variables helper + composer) + output schema directly (the match routes
 * carry heavy DB/Graph deps that an integration test would have to mock
 * wholesale; the A7 surface is the prompt construction + the JSON sink).
 */

import {
  EXPERTISE_FINDER_MATCH_ROW as ROW,
  buildExpertiseMatchVariables,
} from '../../shared/config/prompts/expertise-finder-dynamics';
import { composeToolPromptPair } from '../../lib/services/tool-prompt-composer';
import { wrapUntrustedContent, DATA_CLASSES } from '../../lib/utils/ai-payload-boundary';
import { validateAiJson } from '../../lib/utils/ai-output-schema';
import { EXPERTISE_MATCH_SCHEMA } from '../../shared/config/expertise-finder-output-schema';

const compose = (rosterMembers, wrappedProposal, additionalNotes) => composeToolPromptPair(
  { systemPrompt: ROW.systemPrompt, body: ROW.body },
  buildExpertiseMatchVariables({ rosterMembers, wrappedProposal, additionalNotes }),
  { nonces: [] },
);

describe('Expertise Finder A7 hardening', () => {
  test('cacheable system prompt carries the untrusted-content preamble', () => {
    const { systemPrompt: sys } = compose([
      { name: 'A B', role_type: 'Research Program Staff', role: 'PD' },
    ], 'x', '');
    expect(sys).toContain('UNTRUSTED CONTENT RULES:');
  });

  test('composed body embeds the wrapped block; staff notes stay outside it', () => {
    const wrapped = wrapUntrustedContent({
      text: 'proposal body',
      source: 'test',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: 1_000,
    });
    const prompt = compose([], wrapped.text, 'staff note here').body;
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
