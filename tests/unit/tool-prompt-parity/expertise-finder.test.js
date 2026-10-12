/** @jest-environment node */
import { buildCacheableSystemPrompt, buildUserPrompt } from '../../../shared/config/prompts/expertise-finder';
import {
  EXPERTISE_FINDER_MATCH_ROW as ROW,
  TOOL_PROMPT_ROWS,
  buildExpertiseMatchVariables,
} from '../../../shared/config/prompts/expertise-finder-dynamics';
import { composeToolPromptPair } from '../../../lib/services/tool-prompt-composer';
import { validatePromptTemplatePair } from '../../../lib/utils/prompt-validators';
import { DATA_CLASSES, wrapUntrustedContent } from '../../../lib/utils/ai-payload-boundary';

const member = (o) => ({ name: 'N', role: 'R', affiliation: 'A', ...o });
const ROSTERS = {
  'multi-role': [
    member({ name: 'Ada', role_type: 'Research Program Staff', primary_fields: 'Biochem', keywords: 'k1, k2', subfields_specialties: 'sf', methods_techniques: 'm', expertise: 'e', keck_affiliation: 'PD' }),
    member({ name: 'Bob', role_type: 'Research Program Staff', role: null, affiliation: null }),
    member({ name: 'Cy', role_type: 'Consultant', expertise: 'Physics' }),
    member({ name: 'Di', role_type: 'Board', keywords: 'strategy' }),
  ],
  'staff-only': [member({ name: 'Eve', role_type: 'Research Program Staff' })],
  'unknown-role-only': [member({ name: 'Fay', role_type: 'Other' })],
  empty: [],
};
const PROPOSAL = wrapUntrustedContent({
  text: 'Proposal with {{braces}} and ${dollar} and `ticks`',
  source: 'parity.test',
  dataClass: DATA_CLASSES.PROPOSAL_TEXT,
  maxChars: 100000,
  label: 'research proposal',
}).text;
const NOTES = [['no notes', ''], ['undefined notes', undefined], ['with notes', 'Focus on methods.\nSecond line.']];
const compose = (roster, wrapped, notes) => {
  const variables = buildExpertiseMatchVariables({ rosterMembers: roster, wrappedProposal: wrapped, additionalNotes: notes });
  const out = composeToolPromptPair({ systemPrompt: ROW.systemPrompt, body: ROW.body }, variables, { nonces: [] });
  return { system: out.systemPrompt, body: out.body };
};

describe('expertise-finder.match parity with the bundled builders', () => {
  for (const [rname, roster] of Object.entries(ROSTERS)) {
    test(`system prompt byte-equal: ${rname}`, () => {
      expect(compose(roster, PROPOSAL, '').system).toBe(buildCacheableSystemPrompt(roster));
    });
    for (const [nname, notes] of NOTES) {
      test(`body byte-equal: ${rname} / ${nname}`, () => {
        expect(compose(roster, PROPOSAL, notes).body).toBe(buildUserPrompt(PROPOSAL, notes));
      });
    }
  }
});

describe('row definition', () => {
  const declared = ROW.variables.variables.map((v) => v.name);
  test('is the only manifest row, with expected metadata', () => {
    expect(TOOL_PROMPT_ROWS).toEqual([ROW]);
    expect(ROW).toMatchObject({ promptName: 'expertise-finder.match', model: 'sonnet', maxTokens: 4096 });
    expect(ROW.temperature).toBeUndefined();
  });
  test('would publish through the /admin validator', () => {
    expect(validatePromptTemplatePair(ROW.promptName, { systemPrompt: ROW.systemPrompt, body: ROW.body, declaredVars: declared }))
      .toEqual({ valid: true, issues: [] });
  });
  test('a system prompt without the {{a7_preamble}} slot cannot be published', () => {
    const stripped = ROW.systemPrompt.replace('{{a7_preamble}}', '');
    const r = validatePromptTemplatePair(ROW.promptName, { systemPrompt: stripped, body: ROW.body, declaredVars: declared });
    expect(r.valid).toBe(false);
    expect(r.issues.join(' ')).toMatch(/a7_preamble/);
  });
  test('templates contain no A7 marker text', () => {
    for (const t of [ROW.systemPrompt, ROW.body]) {
      expect(t).not.toMatch(/UNTRUSTED CONTENT RULES:|WMKF-UNTRUSTED-CONTENT|\[\[WMKF-/);
    }
  });
});

describe('publish-to-compose: edits that validate also compose', () => {
  const declared = ROW.variables.variables.map((v) => v.name);
  const variables = buildExpertiseMatchVariables({ rosterMembers: ROSTERS['multi-role'], wrappedProposal: PROPOSAL, additionalNotes: 'n' });
  const sys = ROW.systemPrompt;
  const slot = '{{a7_preamble}}';
  const roster = '{{roster_block}}';
  const edits = {
    seeded: { systemPrompt: sys, body: ROW.body },
    'preamble slot moved to body': { systemPrompt: sys.replace(slot, ''), body: `${slot}\n\n${ROW.body}` },
    'roster block moved to body': { systemPrompt: sys.replace(roster, ''), body: `${ROW.body}\n\n${roster}` },
    'proposal moved to system': { systemPrompt: `${sys}\n\n{{proposal_text}}`, body: ROW.body.replace('{{proposal_text}}', '') },
    'notes moved to system': { systemPrompt: `${sys}\n\n{{additional_notes_block}}`, body: ROW.body.replace('{{additional_notes_block}}', '') },
  };
  test.each(Object.entries(edits))('%s', (_n, t) => {
    expect(validatePromptTemplatePair(ROW.promptName, { ...t, declaredVars: declared }).valid).toBe(true);
    const out = composeToolPromptPair(t, variables, { nonces: [] });
    expect(`${out.systemPrompt}\n${out.body}`).toContain('UNTRUSTED CONTENT RULES:');
    expect(`${out.systemPrompt}\n${out.body}`).toContain('**Ada**');
  });
  test('slot moved to body puts the preamble in the body', () => {
    const out = composeToolPromptPair(edits['preamble slot moved to body'], variables, { nonces: [] });
    expect(out.systemPrompt).not.toContain('UNTRUSTED CONTENT RULES:');
    expect(out.body).toContain('UNTRUSTED CONTENT RULES:');
  });
  test('roster block moved to body puts the roster in the body', () => {
    const out = composeToolPromptPair(edits['roster block moved to body'], variables, { nonces: [] });
    expect(out.systemPrompt).not.toContain('**Ada**');
    expect(out.body).toContain('**Ada**');
  });
});
