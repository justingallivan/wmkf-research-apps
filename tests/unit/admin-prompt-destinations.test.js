/** @jest-environment node */
import { ADMIN_PROMPT_CATALOG } from '../../shared/config/adminPromptCatalog';
import { ADMIN_PROMPT_CALLER_DESTINATIONS, describePromptDestinations } from '../../shared/config/adminPromptDestinations';

const describe = (schema, name = 'external.new-flow') => describePromptDestinations({ name, outputSchema: schema });
const schema = outputs => JSON.stringify({ outputs });

test('covers every built-in prompt without inferring destinations from usage labels', () => {
  expect(Object.keys(ADMIN_PROMPT_CALLER_DESTINATIONS).sort()).toEqual(Object.keys(ADMIN_PROMPT_CATALOG).sort());
  for (const name of Object.keys(ADMIN_PROMPT_CATALOG)) {
    const info = describePromptDestinations({ name, outputSchema: schema([{ target: { kind: 'none' } }]) });
    expect(info.caller.summary).toBeTruthy();
    expect(info.configurationIssue).toBeNull();
  }
});

test('loaded row declarations supply direct writes, including multiple outputs and JSON paths', () => {
  const info = describe(schema([
    { target: { kind: 'akoya_request', field: 'wmkf_ai_summary' } },
    { target: { kind: 'akoya_request', field: 'wmkf_other', jsonPath: '$.part' } },
    { target: { kind: 'akoya_request', field: 'wmkf_ai_summary' } },
    { target: { kind: 'none' } },
  ]));
  expect(info.configured).toEqual([
    { label: 'Request → AI Summary', technical: 'akoya_request.wmkf_ai_summary' },
    { label: 'Request field', technical: 'akoya_request.wmkf_other ($.part)' },
  ]);
  expect(info.configurationIssue).toBeNull();
});

test('does not invent a static direct target when a built-in row changes its configured field', () => {
  expect(describe(schema([{ target: { kind: 'akoya_request', field: 'wmkf_changed' } }]), 'phase-i.summary').configured)
    .toEqual([{ label: 'Request field', technical: 'akoya_request.wmkf_changed' }]);
});

test('pass-through grantee title still exposes the caller write and empty-field condition', () => {
  const info = describe(schema([{ target: { kind: 'none' } }]), 'grantee-title.generate');
  expect(info.configured).toEqual([]);
  expect(info.caller.fields).toEqual(['akoya_request.wmkf_wmkfprojectdescription']);
  expect(info.caller.summary).toMatch(/only when empty/);
});

test.each(['', null, undefined, 'invalid JSON', 'null', '[]', '1', '{"outputs":{}}'])('bad or absent schema %p remains unknown', value => {
  expect(describe(value)).toMatchObject({ configured: [], configurationIssue: expect.any(String), caller: null, fallback: expect.stringContaining('not documented') });
});

test.each([null, {}, { kind: 'account', field: 'name' }, { kind: 'akoya_request' },
  { kind: 'akoya_request', field: '<script>' }, { kind: 'akoya_request', field: 'name', jsonPath: '$.x.y' }])(
  'unsupported target %p is reported without becoming a write', target => {
    expect(describe(schema([{ target }]))).toMatchObject({ configured: [], configurationIssue: expect.any(String) });
  },
);

test('a mixed declaration keeps recognized targets visible and reports the unrecognized target', () => {
  const info = describe(schema([{ target: { kind: 'akoya_request', field: 'wmkf_ai_summary' } }, { target: { kind: 'unknown' } }]));
  expect(info.configured).toHaveLength(1);
  expect(info.configurationIssue).toBeTruthy();
});

test.each(['new.flow', 'constructor', '__proto__'])('uncataloged %s never inherits a caller or claims no external writes', name => {
  expect(describe(schema([{ target: { kind: 'none' } }]), name)).toMatchObject({ caller: null, configured: [], fallback: expect.stringContaining('Power Automate') });
});

test('deprecated and reference names do not imply a live execution path', () => {
  expect(describe('{}', 'phase-i.checkin').caller.summary).toMatch(/Deprecated/);
  expect(describe('{}', 'phase-ii.qa').caller.summary).toMatch(/Stored reference/);
});

test('caller persistence is distinguished from a Dataverse Request-field write', () => {
  expect(describe('{}', 'expertise-finder.match').caller.fields).toEqual(['expertise_matches.match_results']);
  expect(describe('{}', 'initial-assessment.generate').caller.summary).toMatch(/DOCX in SharePoint/);
  expect(describe('{}', 'field-primer.generate').caller.summary).toMatch(/standalone generation/);
});
