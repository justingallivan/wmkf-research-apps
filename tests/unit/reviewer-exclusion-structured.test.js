/**
 * @jest-environment node
 *
 * J27+ intake writes wmkf_excludedreviewers as JSON
 * ({"schema":"wmkf-excludedreviewers/1",...}). It must be read
 * deterministically with no LLM call; legacy free text keeps the LLM path.
 */
const complete = jest.fn(async () => ({ text: '[{"name":"From Model","affiliation":null}]' }));
jest.mock('../../lib/services/llm-client.js', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({ complete: (...a) => complete(...a) })),
}));

import { extractExcludedReviewers, parseStructuredExclusions } from '../../lib/services/reviewer-exclusion-parser.js';

const SCHEMA = 'wmkf-excludedreviewers/1';
const doc = (reviewers, extra = {}) => JSON.stringify({ schema: SCHEMA, source: 'applicant', reviewers, ...extra });

beforeEach(() => complete.mockClear());

test('valid entries become names with info as affiliation, no LLM call', async () => {
  const raw = doc([
    { firstName: 'Ivan', lastName: 'Ahel', info: 'University of Oxford', reason: 'Overlap.' },
    { firstName: 'Karolin', lastName: 'Luger', reason: 'Overlap.' },
  ]);
  await expect(extractExcludedReviewers(raw)).resolves.toEqual({
    names: [
      { name: 'Ivan Ahel', affiliation: 'University of Oxford' },
      { name: 'Karolin Luger', affiliation: null },
    ],
    substantive: true,
    parseFailed: false,
  });
  expect(complete).not.toHaveBeenCalled();
});

test.each([
  ['{}', '{}'],
  ['empty reviewers list', doc([])],
  ['schema with no reviewers key', JSON.stringify({ schema: SCHEMA, source: 'applicant' })],
])('%s means no exclusions, no LLM call', async (_label, raw) => {
  await expect(extractExcludedReviewers(raw)).resolves.toEqual({ names: [], substantive: false, parseFailed: false });
  expect(complete).not.toHaveBeenCalled();
});

test.each([
  ['unknown schema', JSON.stringify({ schema: 'wmkf-excludedreviewers/2', reviewers: [] })],
  ['missing schema', JSON.stringify({ reviewers: [{ firstName: 'A', lastName: 'B' }] })],
  ['non-array reviewers', JSON.stringify({ schema: SCHEMA, reviewers: 'Jane Doe' })],
])('%s is a parse failure, not silently empty, and never reaches the LLM', async (_label, raw) => {
  const result = await extractExcludedReviewers(raw);
  expect(result).toMatchObject({ names: [], substantive: true, parseFailed: true });
  expect(complete).not.toHaveBeenCalled();
});

test('an invalid entry keeps the valid names and flags parseFailed', () => {
  expect(parseStructuredExclusions(doc([
    { firstName: 'John', lastName: 'Pascal', info: 'Universite de Montreal' },
    { firstName: '', lastName: 'Nobody' },
    'not an object',
  ]))).toEqual({
    names: [{ name: 'John Pascal', affiliation: 'Universite de Montreal' }],
    substantive: true,
    parseFailed: true,
  });
});

test('legacy free text and malformed JSON keep the LLM path', async () => {
  expect(parseStructuredExclusions('exclude Drs. Wood (Penn State) and Hör')).toBeNull();
  expect(parseStructuredExclusions('{"schema": "wmkf-excludedreviewers/1", reviewers: [')).toBeNull();
  const result = await extractExcludedReviewers('Jane Doe (MIT), competitor', { apiKey: 'test' });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(result.names).toEqual([{ name: 'From Model', affiliation: null }]);
});
