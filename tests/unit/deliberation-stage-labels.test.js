/**
 * @jest-environment node
 */
jest.mock('../../lib/services/settings-service', () => ({
  listSettingsWithMetaStrict: jest.fn(),
}));

const { DELIBERATION_STAGE_DEFAULT_LABELS } = require('../../shared/utils/deliberation-stage');

// Fresh module registry per test: readDeliberationStageLabels' in-module
// cache and warn rate-limit both start clean each test, so tests never leak
// state into one another through the module singleton.
let listSettingsWithMetaStrict;
let readDeliberationStageLabels;
let __resetDeliberationStageLabelCacheForTests;

afterEach(() => {
  // console.warn is spied per-test below; without restoring, an earlier
  // test's spy would keep accumulating calls into later tests' assertions.
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.resetModules();
  ({ listSettingsWithMetaStrict } = require('../../lib/services/settings-service'));
  ({
    readDeliberationStageLabels,
    __resetDeliberationStageLabelCacheForTests,
  } = require('../../lib/services/deliberation-stage-labels'));
});

it('uses the stored value when found and non-blank', async () => {
  listSettingsWithMetaStrict.mockResolvedValue({
    'stage.deliberations.draft': { value: 'Draft ready for review' },
  });
  const labels = await readDeliberationStageLabels();
  expect(labels.draft).toBe('Draft ready for review');
  expect(labels.shared).toBe(DELIBERATION_STAGE_DEFAULT_LABELS.shared);
  expect(labels.visit).toBe(DELIBERATION_STAGE_DEFAULT_LABELS.visit);
  expect(labels.final).toBe(DELIBERATION_STAGE_DEFAULT_LABELS.final);
  expect(listSettingsWithMetaStrict).toHaveBeenCalledWith('stage.deliberations.');
});

it('falls back to the default when the stored value is blank', async () => {
  listSettingsWithMetaStrict.mockResolvedValue({
    'stage.deliberations.draft': { value: '   ' },
  });
  const labels = await readDeliberationStageLabels();
  expect(labels).toEqual(DELIBERATION_STAGE_DEFAULT_LABELS);
});

it('falls back to the default when not found', async () => {
  listSettingsWithMetaStrict.mockResolvedValue({});
  const labels = await readDeliberationStageLabels();
  expect(labels).toEqual(DELIBERATION_STAGE_DEFAULT_LABELS);
});

it('never throws: a settings-read failure falls back for every key', async () => {
  listSettingsWithMetaStrict.mockRejectedValue(new Error('Dataverse unavailable'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const labels = await readDeliberationStageLabels();
  expect(labels).toEqual(DELIBERATION_STAGE_DEFAULT_LABELS);
});

it('reads all four keys in one call, not one per key', async () => {
  listSettingsWithMetaStrict.mockResolvedValue({});
  await readDeliberationStageLabels();
  expect(listSettingsWithMetaStrict).toHaveBeenCalledTimes(1);
});

it('memoises within the TTL: two reads hit the settings service once', async () => {
  listSettingsWithMetaStrict.mockResolvedValue({
    'stage.deliberations.draft': { value: 'Cached label' },
  });
  const first = await readDeliberationStageLabels();
  const second = await readDeliberationStageLabels();
  expect(listSettingsWithMetaStrict).toHaveBeenCalledTimes(1);
  expect(first).toEqual(second);
  expect(second.draft).toBe('Cached label');
});

it('re-reads after the cache is reset', async () => {
  listSettingsWithMetaStrict.mockResolvedValue({});
  await readDeliberationStageLabels();
  __resetDeliberationStageLabelCacheForTests();
  await readDeliberationStageLabels();
  expect(listSettingsWithMetaStrict).toHaveBeenCalledTimes(2);
});

it('rate-limits the failure warning: a second real attempt within the TTL does not warn again', async () => {
  listSettingsWithMetaStrict.mockRejectedValue(new Error('Dataverse unavailable'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await readDeliberationStageLabels(); // cold: fails, warns once, caches the default labels
  __resetDeliberationStageLabelCacheForTests(); // force a second real settings attempt
  await readDeliberationStageLabels(); // still fails, but within the warn TTL
  expect(listSettingsWithMetaStrict).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledTimes(1);
});
