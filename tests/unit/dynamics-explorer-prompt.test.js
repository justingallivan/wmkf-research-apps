import { buildSystemPrompt, TOOL_DEFINITIONS } from '../../shared/config/prompts/dynamics-explorer';

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
});
