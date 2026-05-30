import { buildSystemPrompt, TOOL_DEFINITIONS, TABLE_ANNOTATIONS } from '../../shared/config/prompts/dynamics-explorer';
import {
  ERA_CUTOVER_DATE,
  TERMINAL_NON_AWARD_STATUSES,
  PER_PROGRAM_ANNOTATION,
} from '../../lib/services/dataverse-export/constants';

describe('Dynamics Explorer prompt contract', () => {
  test('inline-table guidance routes uncertain/non-curated fields to describe_table', () => {
    const prompt = buildSystemPrompt({
      resolvedTaxonomyBlock: 'SERVER-SIDE RESOLVED TAXONOMY\nakoya_programs | Medical Research | _akoya_programid_value | 11111111-1111-1111-1111-111111111111',
    });

    expect(prompt).toContain('curated/common field details, not every live field');
    expect(prompt).toContain('call describe_table with full:true before query_records');
    expect(prompt).not.toContain('you already have full field details');
    expect(prompt).not.toContain('VOCABULARY FIRST');
  });

  test('describe_table schema exposes the full boolean', () => {
    const describeTable = TOOL_DEFINITIONS.find(t => t.name === 'describe_table');

    expect(describeTable.input_schema.properties.full).toEqual(expect.objectContaining({
      type: 'boolean',
    }));
  });

  test('resolved taxonomy block is injected without baked program GUIDs or request-type codes', () => {
    const prompt = buildSystemPrompt({
      resolvedTaxonomyBlock: [
        'SERVER-SIDE RESOLVED TAXONOMY',
        'akoya_programs | Medical Research | _akoya_programid_value | 11111111-1111-1111-1111-111111111111',
        'akoya_request.wmkf_request_type | Request | wmkf_request_type | 42',
      ].join('\n'),
    });

    expect(prompt).toContain('SERVER-SIDE RESOLVED TAXONOMY');
    expect(prompt).toContain('_akoya_programid_value | 11111111-1111-1111-1111-111111111111');
    expect(prompt).toContain('wmkf_request_type | 42');
    expect(prompt).not.toContain('94cab30b-958f-ee11-8179-000d3a341e8f');
    expect(prompt).not.toContain('wmkf_request_type eq 100000001');
  });

  // A4 — domain guardrails derived BY REFERENCE from constants.js.
  test('domain guardrails fold in the liaison/PI footgun and contact roles', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('DOMAIN GUARDRAILS');
    expect(prompt).toContain('FOUNDATION LIAISON');
    expect(prompt).toContain('_wmkf_projectleader_value');
    // primary contact must be flagged as NOT the PI.
    expect(prompt).toMatch(/Primary Contact[^\n]*NOT the principal investigator/);
  });

  test('guardrail lists are derived from constants (not transcribed)', () => {
    const prompt = buildSystemPrompt();
    // Era cutover date comes straight from the constant.
    expect(prompt).toContain(ERA_CUTOVER_DATE);
    // Every terminal-no-award status the constant names appears in the prompt.
    for (const status of TERMINAL_NON_AWARD_STATUSES) {
      expect(prompt).toContain(status);
    }
    // PI-bearing program names come from PER_PROGRAM_ANNOTATION.
    const piBearing = Object.entries(PER_PROGRAM_ANNOTATION)
      .filter(([, a]) => a.pi_bearing)
      .map(([name]) => name);
    expect(piBearing.length).toBeGreaterThan(0);
    for (const name of piBearing) {
      expect(prompt).toContain(name);
    }
  });

  test('akoya_folio guidance reconciled to ground truth (eq PAID, case-insensitive, no contains)', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("akoya_folio eq 'PAID'");
    expect(prompt).toMatch(/case-insensitive/i);
    // The stale "use contains() for casing" guidance must be gone everywhere.
    expect(prompt).not.toContain("contains(akoya_folio,'Paid')");
    expect(prompt).not.toContain('case inconsistency');
    // The annotation itself is reconciled too.
    const folio = TABLE_ANNOTATIONS.akoya_requestpayment.fields.akoya_folio;
    expect(folio).toContain('PAID');
    expect(folio).not.toMatch(/case inconsistency/i);
    expect(TABLE_ANNOTATIONS.akoya_requestpayment.rules.join('\n')).not.toContain("contains(akoya_folio,'Paid')");
  });
});
