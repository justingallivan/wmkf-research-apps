/**
 * @jest-environment node
 */
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(),
}));

const { getSettingStrict } = require('../../lib/services/settings-service');
const { readDeliberationStageLabels } = require('../../lib/services/deliberation-stage-labels');
const { DELIBERATION_STAGE_DEFAULT_LABELS } = require('../../shared/utils/deliberation-stage');

beforeEach(() => {
  jest.clearAllMocks();
});

it('uses the stored value when found and non-blank', async () => {
  getSettingStrict.mockImplementation(async (key) => (
    key === 'stage.deliberations.draft'
      ? { found: true, value: 'Draft ready for review' }
      : { found: false, value: null }
  ));
  const labels = await readDeliberationStageLabels();
  expect(labels.draft).toBe('Draft ready for review');
  expect(labels.shared).toBe(DELIBERATION_STAGE_DEFAULT_LABELS.shared);
  expect(labels.visit).toBe(DELIBERATION_STAGE_DEFAULT_LABELS.visit);
  expect(labels.final).toBe(DELIBERATION_STAGE_DEFAULT_LABELS.final);
});

it('falls back to the default when the stored value is blank', async () => {
  getSettingStrict.mockResolvedValue({ found: true, value: '   ' });
  const labels = await readDeliberationStageLabels();
  expect(labels).toEqual(DELIBERATION_STAGE_DEFAULT_LABELS);
});

it('falls back to the default when not found', async () => {
  getSettingStrict.mockResolvedValue({ found: false, value: null });
  const labels = await readDeliberationStageLabels();
  expect(labels).toEqual(DELIBERATION_STAGE_DEFAULT_LABELS);
});

it('never throws: a settings-read failure falls back per-key', async () => {
  getSettingStrict.mockImplementation(async (key) => {
    if (key === 'stage.deliberations.visit') throw new Error('Dataverse unavailable');
    return { found: false, value: null };
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const labels = await readDeliberationStageLabels();
  expect(labels).toEqual(DELIBERATION_STAGE_DEFAULT_LABELS);
});
