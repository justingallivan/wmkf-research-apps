/**
 * Composer tests (S222). Search prompts are now stricter than the legacy code
 * template path: trusted request metadata is required, server-owned exclusions
 * are prepended outside the editable body, and the integrity block is appended.
 */
import {
  buildExclusionSets,
  buildExclusionsBlock,
  composeAnalyzePrompt,
  composeScorePrompt,
  buildAnalyzeBlockVars,
} from '../../lib/services/reviewer-prompt-composer.js';
import { ANALYZE_INTEGRITY_BLOCK } from '../../shared/config/prompts/reviewer-finder.js';
import {
  ANALYZE_USER_PROMPT_TEMPLATE,
  SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
} from '../../shared/config/prompts/reviewer-finder-dynamics.js';
import { DEFAULT_REVIEWER_COUNT } from '../../shared/config/reviewerFinderPreferences.js';

const WRAPPED = '[[WMKF-UNTRUSTED-CONTENT nonce=deadbeef]]\nProposal body here.\n[[/WMKF-UNTRUSTED-CONTENT nonce=deadbeef]]';
const NONCE = 'deadbeef';
const REQUEST_CONTEXT = {
  title: 'Dataverse Title',
  programArea: 'Medical Research',
  principalInvestigator: 'Dr. Real PI',
  coInvestigators: 'Dr. Co One, Dr. Co Two',
  coInvestigatorCount: '2',
  authorInstitution: 'Applicant University',
  applicantInstitutionNames: ['Applicant University', 'Applicant U'],
};

describe('composeAnalyzePrompt search contract', () => {
  it('fails closed when search request context is absent', () => {
    expect(() => composeAnalyzePrompt({
      body: ANALYZE_USER_PROMPT_TEMPLATE,
      proposalText: WRAPPED,
      nonces: [NONCE],
    })).toThrow('requestContext is required');
  });

  it('allows proposal_info prompts without request context', () => {
    const out = composeAnalyzePrompt({
      body: 'BODY:\n{{proposal_text}}',
      proposalText: WRAPPED,
      nonces: [NONCE],
      analysisPurpose: 'proposal_info',
    });

    expect(out).toContain(`BODY:\n${WRAPPED}`);
  });

  it('prepends non-editable exclusions, trusted metadata, and the integrity block', () => {
    const out = composeAnalyzePrompt({
      body: [
        'EDITABLE BODY START',
        '{{excluded_names_block}}',
        'A prompt editor cannot remove the server block.',
        '{{proposal_text}}',
      ].join('\n'),
      proposalText: WRAPPED,
      nonces: [NONCE],
      excludedNames: ['Dr. User Conflict'],
      reviewerCount: 7,
      requestContext: REQUEST_CONTEXT,
    });

    const metadataIndex = out.indexOf('TRUSTED REQUEST METADATA');
    const exclusionsIndex = out.indexOf('EXCLUSIONS - HARD CONSTRAINTS');
    const editableIndex = out.indexOf('EDITABLE BODY START');
    const integrityIndex = out.indexOf(ANALYZE_INTEGRITY_BLOCK);

    expect(metadataIndex).toBeGreaterThan(-1);
    expect(exclusionsIndex).toBeGreaterThan(metadataIndex);
    expect(exclusionsIndex).toBeLessThan(editableIndex);
    expect(integrityIndex).toBeGreaterThan(editableIndex);
    expect(out).toContain('People (the proposal\'s own investigators and other conflicts): Dr. User Conflict, Dr. Real PI, Dr. Co One, Dr. Co Two');
    expect(out).toContain('Institution - do NOT suggest anyone affiliated with the applicant institution');
    expect(out).toContain('Applicant University; Applicant U');
    expect(out).not.toContain('{{excluded_names_block}}');
    expect(out).not.toContain('**EXCLUDED NAMES (conflicts of interest - do NOT suggest these):**');
  });
});

describe('buildExclusionsBlock structured sets', () => {
  it('builds one shared people/institution source for prompt text and enforcement', () => {
    const sets = buildExclusionSets({
      excludedNames: ['Dr. User Conflict', 'Dr. Real PI'],
      requestContext: REQUEST_CONTEXT,
    });
    const block = buildExclusionsBlock({
      excludedNames: ['Dr. User Conflict', 'Dr. Real PI'],
      requestContext: REQUEST_CONTEXT,
    });

    expect(sets).toEqual({
      people: ['Dr. User Conflict', 'Dr. Real PI', 'Dr. Co One', 'Dr. Co Two'],
      institutions: ['Applicant University', 'Applicant U'],
    });
    expect(block).toContain('Dr. User Conflict, Dr. Real PI, Dr. Co One, Dr. Co Two');
    expect(block).toContain('Applicant University; Applicant U');
  });
});

describe('buildAnalyzeBlockVars matches legacy conditional layout', () => {
  it('empty when absent', () => {
    const v = buildAnalyzeBlockVars({ additionalNotes: '', excludedNames: [], reviewerCount: 12 });
    expect(v).toEqual({ additional_notes_block: '', excluded_names_block: '', reviewer_count: '12' });
  });
  it('formats notes + excluded', () => {
    const v = buildAnalyzeBlockVars({ additionalNotes: 'X', excludedNames: ['A', 'B'], reviewerCount: 9 });
    expect(v.additional_notes_block).toBe('**ADDITIONAL CONTEXT FROM USER:**\nX\n');
    expect(v.excluded_names_block).toBe('\n**EXCLUDED NAMES (conflicts of interest - do NOT suggest these):**\nA, B\n');
    expect(v.reviewer_count).toBe('9');
  });
});

describe('composeAnalyzePrompt repair ordering', () => {
  it('places integrity block before repair block, both after the interpolated body', () => {
    const out = composeAnalyzePrompt({
      body: 'BODY:\n{{proposal_text}}',
      proposalText: WRAPPED,
      nonces: [NONCE],
      repairInstructions: 'Return valid JSON only.',
      requestContext: REQUEST_CONTEXT,
    });

    const bodyIndex = out.indexOf(`BODY:\n${WRAPPED}`);
    const integrityIndex = out.indexOf(ANALYZE_INTEGRITY_BLOCK);
    const repairIndex = out.indexOf('**REPAIR INSTRUCTIONS (TRUSTED SYSTEM-OWNED BLOCK):**');

    expect(bodyIndex).toBeGreaterThan(-1);
    expect(integrityIndex).toBeGreaterThan(bodyIndex);
    expect(repairIndex).toBeGreaterThan(integrityIndex);
  });
});

describe('composeAnalyzePrompt with trusted request metadata', () => {
  it('removes legacy metadata inference and keeps program area out of the prompt', () => {
    const out = composeAnalyzePrompt({
      body: ANALYZE_USER_PROMPT_TEMPLATE,
      proposalText: WRAPPED,
      nonces: [NONCE],
      requestContext: {
        ...REQUEST_CONTEXT,
        principalInvestigator: 'Dr. PI',
        coInvestigators: 'None',
        coInvestigatorCount: '0',
        authorInstitution: 'Applicant University',
      },
    });

    expect(out).toContain('TRUSTED REQUEST METADATA');
    expect(out).toContain('TITLE: Dataverse Title');
    expect(out).toContain('PRIMARY_RESEARCH_AREA: [Main scientific discipline]');
    expect(out).not.toContain('TITLE: [Complete proposal title]');
    expect(out).not.toContain('PROGRAM_AREA');
    expect(out).not.toContain('Medical Research');
  });
});

describe('default reviewer count is the single shared constant (S249: 12→15)', () => {
  it('DEFAULT_REVIEWER_COUNT is 15 (recall lever)', () => {
    expect(DEFAULT_REVIEWER_COUNT).toBe(15);
  });
  it('buildAnalyzeBlockVars falls back to DEFAULT_REVIEWER_COUNT when count omitted', () => {
    const v = buildAnalyzeBlockVars({ additionalNotes: '', excludedNames: [] });
    expect(v.reviewer_count).toBe(String(DEFAULT_REVIEWER_COUNT));
  });
  it('composeAnalyzePrompt uses the shared omitted-count default', () => {
    const fromComposer = composeAnalyzePrompt({
      body: ANALYZE_USER_PROMPT_TEMPLATE,
      proposalText: WRAPPED,
      nonces: [NONCE],
      requestContext: REQUEST_CONTEXT,
    });
    expect(fromComposer).toContain(`Suggest ${DEFAULT_REVIEWER_COUNT} potential expert reviewers`);
  });
});

describe('composeScorePrompt — A7 boundary for both summary and candidates', () => {
  it('prepends a preamble naming both nonces and interpolates wrapped text', () => {
    const out = composeScorePrompt({
      body: SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
      proposalSummaryText: '[[WMKF-UNTRUSTED-CONTENT nonce=sum]]summary[[/WMKF-UNTRUSTED-CONTENT nonce=sum]]',
      candidatesText: '[[WMKF-UNTRUSTED-CONTENT nonce=cand]]candidates[[/WMKF-UNTRUSTED-CONTENT nonce=cand]]',
      nonces: ['sum', 'cand'],
    });
    expect(out.startsWith('UNTRUSTED CONTENT RULES:')).toBe(true);
    expect(out).toContain('sum, cand'); // both nonces named in the preamble
    expect(out).toContain('nonce=sum'); // wrapped summary present
    expect(out).toContain('nonce=cand'); // wrapped candidates present
    expect(out).not.toContain('{{proposal_summary}}');
    expect(out).not.toContain('{{candidates_list}}');
  });
});
