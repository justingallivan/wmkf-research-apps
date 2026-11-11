/** @jest-environment node */
import Ajv from 'ajv';
import roster from '../../lib/services/expertise-finder/roster-contract.cjs';
import { rosterMatchSchema } from '../../lib/services/expertise-finder/roster-match-validation';
import { buildRecommendationsSnapshot, validateRecommendationsOutput } from '../../lib/services/expertise-finder/recommendations-contract';
import { buildRecommendationsOutputSchema } from '../../lib/services/expertise-finder/recommendations-output-schema';

const guid = index => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const ajv = new Ajv({ allErrors: true });
function profile(index, fields = {}) {
  return {
    profile_guid: guid(index), etag: 'W/"1"', name: `Private person ${index}`,
    role_type: 'Consultant', is_active: true, lead_pd_eligible: false,
    dataverse_user_id: null, dataverse_contact_id: null,
    ...Object.fromEntries(roster.TEXT.map(key => [key, null])), ...fields,
  };
}
function input() {
  const staff = { role_type: 'Research Program Staff', lead_pd_eligible: true };
  return {
    complete: true,
    profiles: [
      profile(1, { ...staff, dataverse_user_id: guid(101) }),
      profile(2, { ...staff, dataverse_user_id: guid(102) }),
      profile(3), profile(4, { role_type: 'Board' }),
      profile(5, { is_active: false }), profile(6, { role_type: 'Invalid' }),
      profile(7, { ...staff, dataverse_user_id: guid(107) }),
    ],
    users: [
      { userGuid: guid(101), disabled: true }, { userGuid: guid(102), disabled: false },
      { userGuid: guid(107), disabled: false },
    ],
  };
}
function setup(request = input()) {
  const context = buildRecommendationsSnapshot(request);
  const schema = buildRecommendationsOutputSchema(context);
  return { context, schema, valid: ajv.compile(schema) };
}
const person = index => ({ profile_guid: guid(index), rationale: 'Relevant expertise.' });
function output() {
  return {
    proposal_summary: {},
    staff_assignment: { primary: person(2), secondary: person(7) },
    staff_consultation: [person(1)],
    consultant_overlap: [{ ...person(3), relevance: 'strong' }],
    board_interest: [{ ...person(4), note: 'Relevant interest.' }],
    expertise_gaps: { has_gaps: false, description: null },
    conflicts: [{ profile_guid: guid(3), reason: 'A conflict.' }],
  };
}
const arrays = ['staff_consultation', 'consultant_overlap', 'board_interest', 'conflicts'];

test('native maximal and minimal shapes are accepted by unchanged domain validation', () => {
  const { context, valid } = setup();
  const maximal = output();
  expect(valid(maximal)).toBe(true);
  expect(() => validateRecommendationsOutput(maximal, context)).not.toThrow();
  const minimal = output();
  minimal.staff_assignment = { primary: null, secondary: null };
  arrays.forEach(key => { minimal[key] = []; });
  expect(valid(minimal)).toBe(true);
  expect(validateRecommendationsOutput(minimal, context).no_lead_recommendation).toBe(true);
  maximal.expertise_gaps = { has_gaps: true, description: 'A gap.' };
  expect(valid(maximal)).toBe(true);
  expect(() => validateRecommendationsOutput(maximal, context)).not.toThrow();
});

test('every generated identity enum is exactly its role set; disabled staff are consultable', () => {
  const { schema } = setup();
  const props = schema.properties;
  expect(props.staff_assignment.properties.primary.anyOf[0].properties.profile_guid.enum).toEqual([guid(2), guid(7)]);
  expect(props.staff_assignment.properties.secondary.anyOf[0].properties.profile_guid.enum).toEqual([guid(2), guid(7)]);
  expect(props.staff_consultation.items.properties.profile_guid.enum).toEqual([guid(1), guid(2), guid(7)]);
  expect(props.consultant_overlap.items.properties.profile_guid.enum).toEqual([guid(3)]);
  expect(props.board_interest.items.properties.profile_guid.enum).toEqual([guid(4)]);
  expect(props.conflicts.items.properties.profile_guid.enum).toEqual([1, 2, 3, 4, 7].map(guid));
});

test.each([
  ['primary', [1, 3, 4, 5, 6, 99]],
  ['secondary', [1, 3, 4, 5, 6, 99]],
  ['staff_consultation', [3, 4, 5, 6, 99]],
  ['consultant_overlap', [1, 2, 4, 5, 6, 99]],
  ['board_interest', [1, 2, 3, 5, 6, 99]],
  ['conflicts', [5, 6, 99]],
])('%s schema rejects wrong-role, inactive, invalid and invented identities', (slot, ids) => {
  const { valid } = setup();
  expect(valid(output())).toBe(true);
  for (const id of ids) {
    const bad = output();
    const target = ['primary', 'secondary'].includes(slot) ? bad.staff_assignment[slot] : bad[slot][0];
    target.profile_guid = guid(id);
    expect(valid(bad)).toBe(false);
    expect(valid.errors.some(error => error.keyword === 'enum')).toBe(true);
  }
});

test('provider root forbids persistence wrappers, extra fields and populated proposal summaries', () => {
  const { valid, context } = setup();
  const good = output();
  expect(valid(good)).toBe(true);
  for (const bad of [
    { resultContract: 'expertise-recommendations-v1', modelOutput: good },
    { ...good, unexpected: true },
    { ...good, proposal_summary: { title: 'Unrequested summary' } },
    { ...good, staff_consultation: [{ ...person(1), name: 'Private person' }] },
  ]) expect(valid(bad)).toBe(false);
  expect(() => validateRecommendationsOutput({ resultContract: 'x', modelOutput: good }, context))
    .toThrow(expect.objectContaining({ code: 'profile_output_invalid' }));
});

test.each([[], ['Consultant'], ['Board'], ['Research Program Staff']].map(categories => [categories]))(
  'empty role sets %j are omitted and normalize to arrays, never empty enums', categories => {
    const request = input();
    request.profiles = request.profiles.filter(row => categories.includes(row.role_type));
    const userIds = new Set(request.profiles.map(row => row.dataverse_user_id));
    request.users = request.users.filter(user => userIds.has(user.userGuid));
    const { schema, context, valid } = setup(request);
    const minimal = output();
    minimal.staff_assignment = { primary: null, secondary: null };
    for (const key of arrays) {
      if (Object.hasOwn(schema.properties, key)) minimal[key] = [];
      else {
        delete minimal[key];
        expect(schema.required).not.toContain(key);
        expect(rosterMatchSchema.fields[key]).toMatchObject({ required: false, default: [] });
      }
    }
    expect(valid(minimal)).toBe(true);
    const normalized = validateRecommendationsOutput(minimal, context);
    arrays.forEach(key => expect(normalized[key]).toEqual([]));
    if (!categories.includes('Research Program Staff')) {
      expect(schema.properties.staff_assignment.properties.primary).toEqual({ type: 'null' });
      expect(schema.properties.staff_assignment.properties.secondary).toEqual({ type: 'null' });
    }
    for (const key of arrays.filter(key => !Object.hasOwn(schema.properties, key))) {
      expect(valid({ ...minimal, [key]: [] })).toBe(false);
    }
    expect(JSON.stringify(schema)).not.toContain('"enum":[]');
  },
);

test('active staff with no eligible Users produces null-only leads, but keeps consultation', () => {
  const request = input();
  request.users.forEach(user => { user.disabled = true; });
  const { schema, context, valid } = setup(request);
  expect(schema.properties.staff_assignment.properties.primary).toEqual({ type: 'null' });
  const value = output();
  value.staff_assignment = { primary: null, secondary: null };
  expect(valid(value)).toBe(true);
  expect(validateRecommendationsOutput(value, context).staff_consultation[0].profile_guid).toBe(guid(1));
});

test('all objects are closed, all emitted properties required, and keywords stay in provider subset', () => {
  const { schema } = setup();
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'anyOf', 'enum', 'description']);
  function visit(node) {
    Object.keys(node).forEach(key => expect(allowed.has(key)).toBe(true));
    if (node.type === 'object') {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties));
      Object.values(node.properties).forEach(visit);
    }
    if (node.items) visit(node.items);
    if (node.anyOf) node.anyOf.forEach(visit);
    if (node.enum) expect(node.enum.length).toBeGreaterThan(0);
  }
  visit(schema);
  expect(JSON.stringify(schema)).not.toContain('Private person');
  expect(rosterMatchSchema.fields.expertise_gaps.fields.description.nullable).toBe(true);
  expect(Object.values(rosterMatchSchema.fields.proposal_summary.fields).every(field => field.required === false)).toBe(true);
});

test('domain validation still rejects duplicate leads and oversized rationales accepted by native subset', () => {
  const { valid, context } = setup();
  for (const mutate of [
    value => { value.staff_assignment.secondary = person(2); },
    value => { value.consultant_overlap[0].rationale = 'x'.repeat(4001); },
  ]) {
    const value = output();
    mutate(value);
    expect(valid(value)).toBe(true);
    expect(() => validateRecommendationsOutput(value, context))
      .toThrow(expect.objectContaining({ code: 'profile_output_invalid' }));
  }
});

test('schema is deterministic, detached, and contains only visible GUIDs rather than private prose', () => {
  const request = input();
  const { context, schema } = setup(request);
  const original = copy(context);
  request.profiles.reverse();
  request.users.reverse();
  expect(setup(request).schema).toEqual(schema);
  const changed = buildRecommendationsOutputSchema(context);
  changed.properties.consultant_overlap.items.properties.profile_guid.enum.push(guid(99));
  expect(buildRecommendationsOutputSchema(context)).toEqual(schema);
  expect(context).toEqual(original);
});

test('rejects snapshot tampering and visible block mismatches before deriving identities', () => {
  const { context } = setup();
  const changed = copy(context);
  changed.snapshot.leadGuids.push(guid(3));
  for (const bad of [undefined, {}, changed, { ...context, rosterBlock: context.rosterBlock + 'x' }]) {
    expect(() => buildRecommendationsOutputSchema(bad)).toThrow();
  }
});

test('local enum count bound rejects a large but otherwise valid frozen roster before dispatch', () => {
  const request = { complete: true, users: [], profiles: Array.from({ length: 256 }, (_, i) => profile(i + 1000)) };
  const context = buildRecommendationsSnapshot(request);
  expect(() => buildRecommendationsOutputSchema(context))
    .toThrow(expect.objectContaining({ code: 'expertise_generation_schema_too_large' }));
});

test('local serialized size guard fails closed independently of enum count', () => {
  const { context } = setup();
  const real = Buffer.byteLength;
  const spy = jest.spyOn(Buffer, 'byteLength').mockImplementation((value, ...args) =>
    typeof value === 'string' && value.startsWith('{"type":"object","properties":{"proposal_summary"')
      ? 65537 : real(value, ...args));
  try {
    expect(() => buildRecommendationsOutputSchema(context))
      .toThrow(expect.objectContaining({ code: 'expertise_generation_schema_too_large' }));
  } finally { spy.mockRestore(); }
});
