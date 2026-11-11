/** @jest-environment node */
import { previewSharedTask } from '../../lib/services/admin/prompt-profiles-service';
import {
  hashProfile,
  parseExecutionSpec,
  validateProfileOutput,
} from '../../lib/services/prompt-jobs/profile';
import candidate from '../../docs/plans/SHARED_EXECUTOR_PROPOSAL_METHODOLOGY_V3_CANDIDATE_2026-11-11.json';
import published from '../../docs/plans/SHARED_EXECUTOR_PROPOSAL_RETRY_CANDIDATE_2026-11-11.json';
import challenge from '../fixtures/prompt-jobs-methodology-grounding.synthetic.json';

const [task] = candidate.tasks;
const { outputSchema } = parseExecutionSpec({
  wmkf_ai_promptvariables: task.variables,
  wmkf_ai_promptoutputschema: task.outputSchema,
  wmkf_ai_systemprompt: task.systemPrompt,
  wmkf_ai_promptbody: task.body,
  wmkf_ai_model: task.model,
});

test('candidate changes only the Methodology task body and retains the published profile pin', async () => {
  const prior = published.tasks.find(entry => entry.name === 'proposal.methodology');
  expect(candidate.expectedTaskVersion).toBe(2);
  expect(candidate.profile).toEqual(published.profile);
  expect(hashProfile(candidate.profile)).toBe(published.profileHash);
  expect(candidate.profileHash).toBe(published.profileHash);
  expect(candidate.tasks).toEqual([{ ...prior, body: task.body }]);
  expect(task.body).not.toBe(prior.body);

  const key = 'executor.profiles.proposal-staff-trial.v000001';
  const listSettingsWithMetaStrict = jest.fn(async () => ({
    [key]: {
      value: JSON.stringify({
        schemaVersion: 1,
        profile: published.profile,
        sha256: published.profileHash,
        requestId: '00000000-0000-4000-8000-000000000002',
        publishedAt: '2026-11-11T00:00:00.000Z',
      }),
    },
  }));
  const result = await previewSharedTask({ task }, { listSettingsWithMetaStrict });
  expect(result.sampleOnly).toBe(true);
  expect(result.preview.documentBlock).toContain('Fabricated proposal document');
  expect(result.preview.taskSuffix).toContain('Aim for 220–280 words');
  expect(result.preview.taskSuffix).toContain('Sample pi_name');
  expect(result.preview.taskSuffix).not.toContain('{{pi_name}}');
  expect(listSettingsWithMetaStrict).toHaveBeenCalledTimes(1);
});

test('existing output validator accepts 400 words and rejects 401 and the observed 419', () => {
  const outputAtLength = count => ({ methodology: Array(count).fill('sample').join(' ') });
  expect(validateProfileOutput(outputAtLength(400), outputSchema)).toEqual(outputAtLength(400));
  expect(() => validateProfileOutput(outputAtLength(401), outputSchema)).toThrow('exceeds maxWords');
  expect(() => validateProfileOutput(outputAtLength(419), outputSchema)).toThrow('exceeds maxWords');
});

test('existing output validator rejects a draft above the character cap', () => {
  expect(() => validateProfileOutput({ methodology: 'x'.repeat(12001) }, outputSchema)).toThrow('exceeds maxChars');
});

// Human verdicts in the fixture are intentionally outside the format validator's input.
test.each(challenge.reviewCases)('format alone accepts the synthetic $id case', ({ output }) => {
  const parsed = { methodology: output };
  expect(validateProfileOutput(parsed, outputSchema)).toEqual(parsed);
});
