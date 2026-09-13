/** @jest-environment node */
import { validateAiJson } from '../../lib/utils/ai-output-schema';
import {
  projectSeatQuestionSet, buildSeatValidationSchema, chairInput,
  REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE,
} from '../../lib/services/review-panel-questions';

const FIXTURE_FIELDS = [
  { key: 'affiliation', order: 0, type: 'string', maxLength: 300 },
  { key: 'priorWork', order: 1, type: 'richtext', maxLength: 50000 },
  { key: 'impactAreas', order: 3, type: 'multiselect', options: [{ value: 1, label: 'a' }, { value: 2, label: 'b' }] },
  { key: 'riskLevel', order: 4, type: 'picklist', options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
  { key: 'teamCapacity', order: 7, type: 'richtext', maxLength: 50000 },
  { key: 'questionsForPi', order: 8, type: 'richtext', maxLength: 50000 },
];

describe('projectSeatQuestionSet', () => {
  test('excludes the string affiliation field, includes picklist/multiselect/richtext sorted by order', () => {
    const projected = projectSeatQuestionSet(FIXTURE_FIELDS);
    expect(projected.map((f) => f.key)).toEqual(['priorWork', 'impactAreas', 'riskLevel', 'teamCapacity', 'questionsForPi']);
    expect(projected.some((f) => f.key === 'affiliation')).toBe(false);
  });

  test('marks teamCapacity as a fixed not-assessable marker, not a normal question', () => {
    const projected = projectSeatQuestionSet(FIXTURE_FIELDS);
    const teamCapacity = projected.find((f) => f.key === 'teamCapacity');
    expect(teamCapacity).toEqual({ key: 'teamCapacity', notAssessable: true });
  });
});

describe('buildSeatValidationSchema', () => {
  const projected = projectSeatQuestionSet(FIXTURE_FIELDS);
  const schema = buildSeatValidationSchema(projected);

  test('affiliation never appears in the schema (excluded by projection, not by validator)', () => {
    expect(schema.fields.affiliation).toBeUndefined();
  });

  test('teamCapacity accepts only the literal not-assessable marker', () => {
    const ok = validateAiJson({ teamCapacity: { status: 'not_assessable' }, priorWork: 'x', impactAreas: ['1'], riskLevel: '1', questionsForPi: 'y' }, schema);
    expect(ok.ok).toBe(true);
    expect(ok.value.teamCapacity).toEqual({ status: 'not_assessable' });
  });

  test('teamCapacity rejects an attempted answer alongside the marker', () => {
    const bad = validateAiJson({ teamCapacity: { status: 'not_assessable', text: 'they seem fine' }, priorWork: 'x', impactAreas: ['1'], riskLevel: '1', questionsForPi: 'y' }, schema);
    expect(bad.ok).toBe(false);
  });

  test('teamCapacity rejects a plain string answer', () => {
    const bad = validateAiJson({ teamCapacity: 'The team looks capable.', priorWork: 'x', impactAreas: ['1'], riskLevel: '1', questionsForPi: 'y' }, schema);
    expect(bad.ok).toBe(false);
  });

  test('picklist validates as an enum of the option values', () => {
    const bad = validateAiJson({ teamCapacity: { status: 'not_assessable' }, priorWork: 'x', impactAreas: ['1'], riskLevel: '99', questionsForPi: 'y' }, schema);
    expect(bad.ok).toBe(false);
  });

  test('multiselect validates as an array of enum option values', () => {
    const bad = validateAiJson({ teamCapacity: { status: 'not_assessable' }, priorWork: 'x', impactAreas: ['99'], riskLevel: '1', questionsForPi: 'y' }, schema);
    expect(bad.ok).toBe(false);
  });

  test('richtext validates as a bounded string', () => {
    const bad = validateAiJson({ teamCapacity: { status: 'not_assessable' }, priorWork: 123, impactAreas: ['1'], riskLevel: '1', questionsForPi: 'y' }, schema);
    expect(bad.ok).toBe(false);
  });

  test('the deleted-guard check: without allowExtra on teamCapacity, the rejected fixture would incorrectly pass', () => {
    const permissive = { type: 'object', fields: { teamCapacity: { type: 'object', fields: { status: { type: 'string', enum: ['not_assessable'] } } } } };
    const withExtra = validateAiJson({ teamCapacity: { status: 'not_assessable', text: 'answer' } }, permissive);
    expect(withExtra.ok).toBe(true); // proves allowExtra:'error' is load-bearing in the real schema
  });
});

describe('chairInput', () => {
  test('omits teamCapacity from every seat review', () => {
    const input = chairInput({
      'seat.claude': { priorWork: 'a', teamCapacity: { status: 'not_assessable' }, riskLevel: 1 },
      'seat.openai': { priorWork: 'b', teamCapacity: { status: 'not_assessable' }, riskLevel: 2 },
    });
    expect(input['seat.claude']).toEqual({ priorWork: 'a', riskLevel: 1 });
    expect(input['seat.openai']).toEqual({ priorWork: 'b', riskLevel: 2 });
    expect(Object.values(input).some((r) => 'teamCapacity' in r)).toBe(false);
  });
});

test('the fixed D7 report line constant is exported and non-empty', () => {
  expect(REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE).toBe('Not assessed in Phase A (budget and team materials not provided)');
});
