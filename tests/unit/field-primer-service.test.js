/**
 * Unit tests for the field-primer service.
 * Mocks the Executor so no live Claude/Dataverse call is made.
 */
jest.mock('../../lib/services/execute-prompt.js', () => ({
  executePrompt: jest.fn(),
}));
jest.mock('../../lib/services/openalex-service.js', () => ({
  OpenAlexService: { searchAuthors: jest.fn() },
}));

import { executePrompt } from '../../lib/services/execute-prompt.js';
import { OpenAlexService } from '../../lib/services/openalex-service.js';
import {
  generateFieldPrimer,
  groundPrimerExperts,
  renderPrimerMarkdown,
  FIELD_PRIMER_PROMPT_NAME,
  PRIMER_SECTIONS,
} from '../../lib/services/field-primer-service.js';

const SAMPLE_PRIMER = {
  field_overview: 'The field studies microbial gene transfer.',
  subareas: [{ name: 'Phage biology', description: 'Bacteriophage life cycles.' }],
  key_methods: [{ name: 'Comparative genomics', description: 'Sequence comparison.' }],
  frontiers: [{ frontier: 'GTA engineering', why_now: 'New tools.' }],
  communities: [{ name: 'Phage genomics groups', description: 'Academic labs.' }],
  venues: ['Journal of Bacteriology', 'mBio'],
  experts: [{ name: 'Jane Doe', affiliation: 'Example U', why_relevant: 'GTA pioneer.' }],
  proposal_placement: 'Extends prior GTA work into engineering.',
  caveats: 'Knowledge-only; named experts are orienting, not vetted.',
};

const LONG_TEXT = 'A research proposal about microbial viruses. '.repeat(5);

beforeEach(() => {
  executePrompt.mockReset();
});

describe('generateFieldPrimer', () => {
  test('rejects missing / too-short proposal text without calling the Executor', async () => {
    await expect(generateFieldPrimer({ proposalText: '' })).rejects.toThrow(/proposalText/);
    await expect(generateFieldPrimer({ proposalText: 'too short' })).rejects.toThrow(/proposalText/);
    expect(executePrompt).not.toHaveBeenCalled();
  });

  test('calls the Executor with the right prompt name, override vars, and forceOverwrite', async () => {
    executePrompt.mockResolvedValue({ parsed: SAMPLE_PRIMER, runId: 'run-1', meta: { modelUsed: 'claude-opus-x' }, usage: { input_tokens: 10 } });
    const out = await generateFieldPrimer({ proposalText: LONG_TEXT, runSource: 'Vercel Test' });

    expect(executePrompt).toHaveBeenCalledTimes(1);
    const arg = executePrompt.mock.calls[0][0];
    expect(arg.promptName).toBe(FIELD_PRIMER_PROMPT_NAME);
    expect(arg.runSource).toBe('Vercel Test');
    expect(arg.forceOverwrite).toBe(true);
    expect(arg.overrideVariables.proposal_text).toBe(LONG_TEXT);
    expect(arg.overrideVariables.focus_hint).toBe(''); // no focus → empty

    expect(out.primer).toEqual(SAMPLE_PRIMER);
    expect(out.runId).toBe('run-1');
    expect(out.model).toBe('claude-opus-x');
  });

  test('weaves a focus hint into the override variables when provided', async () => {
    executePrompt.mockResolvedValue({ parsed: SAMPLE_PRIMER, runId: 'r', meta: {}, usage: null });
    await generateFieldPrimer({ proposalText: LONG_TEXT, focus: 'the materials angle' });
    const arg = executePrompt.mock.calls[0][0];
    expect(arg.overrideVariables.focus_hint).toContain('the materials angle');
  });

  test('throws if the Executor reports a blocked run', async () => {
    executePrompt.mockResolvedValue({ blocked: true, parsed: null, runId: 'r' });
    await expect(generateFieldPrimer({ proposalText: LONG_TEXT })).rejects.toThrow(/blocked/);
  });
});

describe('renderPrimerMarkdown', () => {
  test('renders the header, the not-vetted disclaimer, and every populated section', () => {
    const md = renderPrimerMarkdown(SAMPLE_PRIMER, { title: 'GTA proposal' });
    expect(md).toContain('# Field Primer: GTA proposal');
    expect(md).toMatch(/not.*vetted reviewer suggestions/i);
    expect(md).toContain('Phage biology');
    expect(md).toContain('Jane Doe');
    expect(md).toContain('Example U');
    expect(md).toContain('Journal of Bacteriology · mBio');
    expect(md).toContain('Caveats');
  });

  test('tolerates an empty / partial primer without throwing', () => {
    expect(() => renderPrimerMarkdown({})).not.toThrow();
    const md = renderPrimerMarkdown({ field_overview: 'only this' });
    expect(md).toContain('# Field Primer');
    expect(md).toContain('only this');
  });
});

describe('exports', () => {
  test('prompt name and section list are stable', () => {
    expect(FIELD_PRIMER_PROMPT_NAME).toBe('field-primer.generate');
    expect(PRIMER_SECTIONS).toEqual(Object.keys(SAMPLE_PRIMER));
  });
});

describe('groundPrimerExperts (uses the real forenamesContradict; OpenAlex mocked)', () => {
  // Author DB keyed by search query. A confirmed expert seeds the field profile
  // (biology/genome) used to disambiguate the rest.
  // Two biology confirmers (Lang + Beatty) so a consensus field anchor forms.
  const DB = {
    'Andrew Lang': [{ displayName: 'Andrew Lang', worksCount: 80, topics: ['Biology', 'Genome', 'Microbiology'], openAlexId: 'A-lang', orcid: null }],
    'J. Thomas Beatty': [{ displayName: 'J. Thomas Beatty', worksCount: 90, topics: ['Biology', 'Genome', 'Microbiology'], openAlexId: 'A-beatty', orcid: null }],
    'Oksana Zhaxybayeva': [], // the hallucinated forename → 0 hits (mirrors live OpenAlex)
    'Zhaxybayeva': [
      { displayName: 'Olga Zhaxybayeva', worksCount: 151, topics: ['Biology', 'Genome', 'Genetics'], openAlexId: 'A-olga', orcid: '0000-0001' },
      { displayName: 'Elmira Zhaxybayeva', worksCount: 9, topics: ['Food science', 'Chemistry'], openAlexId: 'A-elmira', orcid: null },
    ],
    'Alice Smith': [],
    'Smith': [
      { displayName: 'Bob Smith', worksCount: 40, topics: ['Biology', 'Genetics'], openAlexId: 'A-bob', orcid: null },
      { displayName: 'Carol Smith', worksCount: 35, topics: ['Biology', 'Genome'], openAlexId: 'A-carol', orcid: null },
    ],
    // An exact-name match that lands OFF the anchored (biology) field — a namesake.
    'Q. Physicist': [{ displayName: 'Q. Physicist', worksCount: 200, topics: ['Physics', 'Particle physics'], openAlexId: 'A-phys', orcid: null }],
  };
  // Real OpenAlex search is case-insensitive; surnameOf lowercases its query, so
  // match keys case-insensitively.
  const lookup = (db, q) => {
    const k = Object.keys(db).find((key) => key.toLowerCase() === String(q).toLowerCase());
    return k ? db[k] : [];
  };
  beforeEach(() => {
    OpenAlexService.searchAuthors.mockReset();
    OpenAlexService.searchAuthors.mockImplementation(async (q) => {
      const records = lookup(DB, q);
      return { totalCount: records.length, records };
    });
  });

  test('confirms exact matches, SUGGESTS a forename correction, and abstains on ambiguity', async () => {
    const experts = [
      { name: 'Andrew Lang', affiliation: 'Memorial U', why_relevant: 'GTA ecology' },
      { name: 'J. Thomas Beatty', affiliation: 'UBC', why_relevant: 'GTA' },
      { name: 'Oksana Zhaxybayeva', affiliation: 'Dartmouth', why_relevant: 'computational GTA' },
      { name: 'Alice Smith', affiliation: 'Somewhere', why_relevant: 'generic' },
    ];
    const out = await groundPrimerExperts(experts);

    // two exact biology matches → confirmed (and they form the field anchor)
    expect(out[0].grounding.status).toBe('confirmed');
    expect(out[1].grounding.status).toBe('confirmed');

    // the headline: wrong forename, right surname+field, one dominant in-field author →
    // SUGGESTED correction to Olga, flagged needsVerification (never silently trusted)
    expect(out[2].grounding.status).toBe('corrected');
    expect(out[2].grounding.resolvedName).toBe('Olga Zhaxybayeva');
    expect(out[2].grounding.needsVerification).toBe(true);
    expect(out[2].grounding.corroboration).toBe('first-initial'); // Oksana/Olga share "O"
    expect(out[2].name).toBe('Oksana Zhaxybayeva'); // original preserved
    expect(out[2].grounding.worksCount).toBe(151);

    // two in-field namesakes, neither dominant → never auto-bind → unverified
    expect(out[3].grounding.status).toBe('unverified');
  });

  test('flags an exact-name match that resolves OFF the anchored field as a possible namesake', async () => {
    const out = await groundPrimerExperts([
      { name: 'Andrew Lang' },
      { name: 'J. Thomas Beatty' }, // two biology confirmers → anchor = biology
      { name: 'Q. Physicist' }, // exact-name hit, but in physics → off-field
    ]);
    expect(out[2].grounding.status).toBe('unverified');
    expect(out[2].grounding.note).toMatch(/namesake/i);
  });

  test('does NOT suggest a correction when the forename differs with no initial/affiliation corroboration', async () => {
    OpenAlexService.searchAuthors.mockImplementation(async (q) => {
      const db = {
        'andrew lang': [{ displayName: 'Andrew Lang', worksCount: 80, topics: ['Biology', 'Genome'], openAlexId: 'A1' }],
        'j. thomas beatty': [{ displayName: 'J. Thomas Beatty', worksCount: 90, topics: ['Biology', 'Genome'], openAlexId: 'A2' }],
        'bob zhaxybayeva': [], // hallucinated → 0 hits
        zhaxybayeva: [{ displayName: 'Olga Zhaxybayeva', worksCount: 151, topics: ['Biology', 'Genome'], openAlexId: 'A3' }],
      };
      const records = db[String(q).toLowerCase()] || [];
      return { totalCount: records.length, records };
    });
    const out = await groundPrimerExperts([
      { name: 'Andrew Lang' }, { name: 'J. Thomas Beatty' },
      { name: 'Bob Zhaxybayeva', affiliation: 'Dartmouth' }, // initial b≠o; no institution to match
    ]);
    expect(out[2].grounding.status).toBe('unverified'); // NOT corrected — would be a different person
    expect(out[2].grounding.note).toMatch(/different forename|corroboration/i);
  });

  test('suggests a correction via AFFILIATION match even when the first initial differs', async () => {
    OpenAlexService.searchAuthors.mockImplementation(async (q) => {
      const db = {
        'andrew lang': [{ displayName: 'Andrew Lang', worksCount: 80, topics: ['Biology', 'Genome'], openAlexId: 'A1' }],
        'j. thomas beatty': [{ displayName: 'J. Thomas Beatty', worksCount: 90, topics: ['Biology', 'Genome'], openAlexId: 'A2' }],
        'xavier zhaxybayeva': [],
        zhaxybayeva: [{ displayName: 'Olga Zhaxybayeva', worksCount: 151, topics: ['Biology', 'Genome'], openAlexId: 'A3', lastKnownInstitution: 'Dartmouth College' }],
      };
      const records = db[String(q).toLowerCase()] || [];
      return { totalCount: records.length, records };
    });
    const out = await groundPrimerExperts([
      { name: 'Andrew Lang' }, { name: 'J. Thomas Beatty' },
      { name: 'Xavier Zhaxybayeva', affiliation: 'Dartmouth' }, // initial x≠o, BUT Dartmouth matches
    ]);
    expect(out[2].grounding.status).toBe('corrected');
    expect(out[2].grounding.corroboration).toBe('affiliation');
  });

  test('disables corrections when no field anchor forms (fail-safe)', async () => {
    OpenAlexService.searchAuthors.mockImplementation(async (q) => {
      // only the surname search returns an author; nothing confirms in pass 1 → empty field profile
      const records = String(q).toLowerCase() === 'zhaxybayeva' ? DB['Zhaxybayeva'] : [];
      return { totalCount: records.length, records };
    });
    const out = await groundPrimerExperts([{ name: 'Oksana Zhaxybayeva' }]);
    expect(out[0].grounding.status).toBe('unverified'); // empty profile → no correction
  });

  test('renderPrimerMarkdown surfaces the grounding markers', () => {
    const md = renderPrimerMarkdown({
      experts: [
        { name: 'Andrew Lang', affiliation: 'Memorial U', why_relevant: 'x', grounding: { status: 'confirmed', resolvedName: 'Andrew Lang' } },
        { name: 'Oksana Zhaxybayeva', affiliation: 'Dartmouth', why_relevant: 'y', grounding: { status: 'corrected', resolvedName: 'Olga Zhaxybayeva' } },
      ],
    });
    expect(md).toContain('likely Olga Zhaxybayeva');
    expect(md).toMatch(/verify same person/i);
    expect(md).toMatch(/model named "Oksana Zhaxybayeva"/);
    expect(md).toContain('✓');
  });
});
