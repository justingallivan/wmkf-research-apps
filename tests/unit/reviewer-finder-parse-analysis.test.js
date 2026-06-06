/**
 * Coverage for parseAnalysisResponse markdown-decoration tolerance.
 *
 * Reviewer Finder hit "Found 0 suggestions, 11 queries" in prod 2026-05-27
 * after the model resolver started returning concrete sonnet-4-6, which
 * emits reviewer headers with markdown bold + numbering. The parser used
 * to split on bare `REVIEWER:` only. These cases lock in the tolerant
 * regex shape.
 */

import { parseAnalysisResponse, isNoConcernText } from '../../shared/config/prompts/reviewer-finder';

const PROPOSAL_METADATA = `## PART 1: PROPOSAL METADATA

TITLE: Example proposal
PRINCIPAL_INVESTIGATOR: Dr. Foo
AUTHOR_INSTITUTION: ExampleU
PRIMARY_RESEARCH_AREA: Cell biology
KEYWORDS: term1, term2

---
`;

const PART_3 = `
---

## PART 3: DATABASE SEARCH QUERIES

PUBMED_QUERIES:
1. cell signaling query
2. apoptosis query
`;

describe('parseAnalysisResponse — reviewer block tolerance', () => {
  test('plain REVIEWER: header (legacy format)', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

REVIEWER:
NAME: Dr. Alice Smith
INSTITUTION: Stanford
EXPERTISE: signaling, biochemistry
SENIORITY: Senior
REASONING: Known expert in the field.
POTENTIAL_CONCERNS: None identified
SOURCE: Known expert
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(1);
    expect(result.reviewerSuggestions[0].name).toBe('Dr. Alice Smith');
    expect(result.reviewerSuggestions[0].suggestedInstitution).toBe('Stanford');
    expect(result.reviewerSuggestions[0].expertiseAreas).toEqual(['signaling', 'biochemistry']);
  });

  test('**REVIEWER:** markdown-bold header', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

**REVIEWER:**
**NAME:** Dr. Bob Jones
**INSTITUTION:** MIT
**EXPERTISE:** chemistry, kinetics
**SENIORITY:** Mid-career
**REASONING:** Cited in proposal.
**POTENTIAL_CONCERNS:** None identified
**SOURCE:** Mentioned in proposal
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(1);
    expect(result.reviewerSuggestions[0].name).toBe('Dr. Bob Jones');
    expect(result.reviewerSuggestions[0].suggestedInstitution).toBe('MIT');
    expect(result.reviewerSuggestions[0].source).toBe('Mentioned in proposal');
  });

  test('**REVIEWER 1:** numbered + bold header', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

**REVIEWER 1:**
NAME: Dr. Carol Davis
INSTITUTION: UCSF
EXPERTISE: structural biology
SENIORITY: Senior
REASONING: Field leader.
POTENTIAL_CONCERNS: None
SOURCE: Field leader

**REVIEWER 2:**
NAME: Dr. Dan Edwards
INSTITUTION: Yale
EXPERTISE: genetics
SENIORITY: Early-career
REASONING: Rising star.
POTENTIAL_CONCERNS: None
SOURCE: Known expert
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(2);
    expect(result.reviewerSuggestions[0].name).toBe('Dr. Carol Davis');
    expect(result.reviewerSuggestions[1].name).toBe('Dr. Dan Edwards');
  });

  test('### REVIEWER 1 heading style (no colon, no bold)', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

### REVIEWER 1
NAME: Dr. Eve Foster
INSTITUTION: Princeton
EXPERTISE: immunology
SENIORITY: Senior
REASONING: Sole expert in subfield.
POTENTIAL_CONCERNS: None
SOURCE: Known expert
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(1);
    expect(result.reviewerSuggestions[0].name).toBe('Dr. Eve Foster');
  });

  test('list-marker `- REVIEWER:` variant', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

- REVIEWER:
  NAME: Dr. Fred Gold
  INSTITUTION: Harvard
  EXPERTISE: neuroscience
  SENIORITY: Senior
  REASONING: Senior expert.
  POTENTIAL_CONCERNS: None
  SOURCE: Known expert
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(1);
    expect(result.reviewerSuggestions[0].name).toBe('Dr. Fred Gold');
  });

  test('numbered list marker `1. REVIEWER:` variant', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

1. REVIEWER:
NAME: Dr. Henry Iverson
INSTITUTION: Berkeley
EXPERTISE: spectroscopy
SENIORITY: Senior
REASONING: Long-time expert.
POTENTIAL_CONCERNS: None
SOURCE: Field leader
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(1);
    expect(result.reviewerSuggestions[0].name).toBe('Dr. Henry Iverson');
  });

  test('REASONING line that starts with "REVIEWER" does NOT split block', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

**REVIEWER 1:**
NAME: Dr. Ida Jefferson
INSTITUTION: Duke
EXPERTISE: virology
SENIORITY: Senior
REASONING: Reviewer is especially qualified because her work overlaps the proposal's central method.
POTENTIAL_CONCERNS: None
SOURCE: Known expert
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(1);
    expect(result.reviewerSuggestions[0].name).toBe('Dr. Ida Jefferson');
    expect(result.reviewerSuggestions[0].reasoning).toMatch(/Reviewer is especially qualified/);
  });

  test('header with trailing whitespace still matches', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

**REVIEWER 1:**   \t
NAME: Dr. Jack Klein
INSTITUTION: Columbia
EXPERTISE: oncology
SENIORITY: Mid-career
REASONING: Direct topical overlap.
POTENTIAL_CONCERNS: None
SOURCE: Known expert
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(1);
    expect(result.reviewerSuggestions[0].name).toBe('Dr. Jack Klein');
  });

  test('queries still parse alongside markdown reviewer blocks', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

**REVIEWER 1:**
NAME: Dr. Grace Hall
INSTITUTION: Caltech
EXPERTISE: chemistry
SENIORITY: Senior
REASONING: Expert.
POTENTIAL_CONCERNS: None
SOURCE: Known expert
${PART_3}`;

    const result = parseAnalysisResponse(response);
    expect(result.reviewerSuggestions).toHaveLength(1);
    expect(result.searchQueries.pubmed).toEqual(['cell signaling query', 'apoptosis query']);
  });
});

describe('isNoConcernText — suppress no-concern phrasings, keep real ones', () => {
  test.each([
    'None identified',
    'None',
    'None.',
    'N/A',
    'N.A.',
    'NA',
    'nil',
    'Not applicable',
    'No concerns identified',
    'No COI identified',
    'No apparent conflicts',
    'No institutional COI identified',
    'No known competing interests',
    'No known conflicts identified',
    'None identified based on available information',
    'Not applicable based on available information',
    // Negated-relationship phrasings — the model is stating a tie is ABSENT,
    // so these are no-concern values (Codex P1).
    'No known collaboration with the PI',
    'No co-author relationship with the PI',
    'No shared institution identified',
    '   ',
    '',
    null,
    undefined,
  ])('treats %p as no-concern', (val) => {
    expect(isNoConcernText(val)).toBe(true);
  });

  test.each([
    'Former Johns Hopkins faculty — shared institution with the PI.',
    'No obvious conflicts, but they collaborated on a 2023 paper.',
    'No conflicts, but they collaborated in 2023',
    'None obvious, but they trained together',
    'Direct competitor on the same grant topic.',
    'Co-authored with the PI in 2021.',
    // A no-concern opener followed by a substantive second clause is a real
    // concern — the sentinel must not swallow the continuation (Codex P1).
    'No conflicts; they competed for the same grant',
    'No conflicts — they were postdoc labmates',
    'No COI, former labmate of the PI',
  ])('treats %p as a real concern', (val) => {
    expect(isNoConcernText(val)).toBe(false);
  });
});

describe('parseAnalysisResponse — POTENTIAL_CONCERNS normalization', () => {
  test('no-concern value normalizes to null', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

REVIEWER:
NAME: Dr. Alice Smith
INSTITUTION: Stanford
EXPERTISE: signaling
SENIORITY: Senior
REASONING: Known expert.
POTENTIAL_CONCERNS: No COI identified
SOURCE: Known expert
${PART_3}`;
    const r = parseAnalysisResponse(response);
    expect(r.reviewerSuggestions[0].potentialConcerns).toBeNull();
  });

  test('real concern is preserved', () => {
    const response = `${PROPOSAL_METADATA}
## PART 2: REVIEWER SUGGESTIONS

REVIEWER:
NAME: Dr. Taekjip Ha
INSTITUTION: Harvard Medical School
EXPERTISE: single-molecule biophysics
SENIORITY: Senior
REASONING: Leading single-molecule biophysicist.
POTENTIAL_CONCERNS: Former Johns Hopkins faculty — shared institution with the PI.
SOURCE: Known expert
${PART_3}`;
    const r = parseAnalysisResponse(response);
    expect(r.reviewerSuggestions[0].potentialConcerns).toMatch(/Johns Hopkins/);
  });
});
