import {
  assertExecutorBudgetForPromptModel,
  getExecutorBudget,
  getExecutorBudgetConfig,
  parseExecutorBudgetSettings,
  publishExecutorBudgetConfig,
  validateExecutorBudgets,
} from '../../lib/services/executor-budget-service.js';
import { EXECUTOR_BUDGET_DEFAULTS } from '../../shared/config/executorBudgets.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function budgets(overrides = {}) {
  return {
    'pre-site-visit.proposal-core.generate': {
      kind: 'standing',
      maxTokensOverride: 32768,
      timeoutMsOverride: 240000,
      ...(overrides.standing || {}),
    },
    'review-synthesis.generate': {
      kind: 'retry',
      floor: 16000,
      ceiling: 32000,
      ...(overrides.retry || {}),
    },
  };
}

function storedRevision(version, requestId = REQUEST_ID, value = budgets()) {
  const key = `executor.budgets.v${String(version).padStart(6, '0')}`;
  return {
    [key]: {
      value: JSON.stringify({
        schemaVersion: 1,
        version,
        requestId,
        publishedAt: `2026-08-${String(version).padStart(2, '0')}T12:00:00.000Z`,
        budgets: value,
      }),
      updatedById: 'actor-id',
      updatedByName: 'Admin User',
    },
  };
}

function dependencies(initialSettings = {}) {
  const settings = { ...initialSettings };
  return {
    settings,
    listSettingsWithMetaStrict: jest.fn(async () => ({ ...settings })),
    createSettingStrict: jest.fn(async (key, value) => {
      if (settings[key]) {
        const error = new Error('duplicate');
        error.code = 'setting_exists';
        error.status = 409;
        throw error;
      }
      settings[key] = { value, updatedById: 'actor-id', updatedByName: 'Admin User' };
      return true;
    }),
    fetchCurrentPrompt: jest.fn(async () => ({ wmkf_ai_model: 'claude-sonnet-5' })),
    loadAvailableModels: jest.fn(async () => []),
    resolveModelWithCapabilities: jest.fn(() => ({
      model: 'claude-sonnet-5',
      capabilities: { unknown: false, maxOutputTokens: 128000 },
    })),
    now: jest.fn(() => new Date('2026-08-29T12:00:00.000Z')),
  };
}

test('absent durable settings use the bounded reviewed fallback', async () => {
  const deps = dependencies();
  await expect(getExecutorBudgetConfig({}, deps)).resolves.toMatchObject({
    source: 'code_fallback',
    version: 0,
    latestRevision: 0,
    storageWarnings: [],
    budgets: EXECUTOR_BUDGET_DEFAULTS,
  });
  await expect(getExecutorBudget('review-synthesis.generate', {}, deps)).resolves.toEqual({
    kind: 'retry',
    floor: 16000,
    ceiling: 32000,
  });
});

test('highest immutable revision is authoritative and carries row metadata', () => {
  const parsed = parseExecutorBudgetSettings({
    ...storedRevision(1),
    ...storedRevision(2, SECOND_REQUEST_ID, budgets({ retry: { ceiling: 48000 } })),
  });
  expect(parsed).toMatchObject({
    source: 'dataverse',
    version: 2,
    latestRevision: 2,
    requestId: SECOND_REQUEST_ID,
    updatedByName: 'Admin User',
    budgets: { 'review-synthesis.generate': { ceiling: 48000 } },
  });
});

test('a malformed durable revision is skipped, reported, and still reserves its revision', async () => {
  const deps = dependencies({
    ...storedRevision(1),
    'executor.budgets.v000002': { value: '{not-json' },
    'executor.budgets.vnot-a-revision': { value: '{}' },
  });
  await expect(getExecutorBudgetConfig({ strict: true }, deps)).resolves.toMatchObject({
    source: 'dataverse',
    version: 1,
    latestRevision: 2,
    storageWarnings: [
      expect.objectContaining({ settingKey: 'executor.budgets.v000002', version: 2 }),
      expect.objectContaining({ settingKey: 'executor.budgets.vnot-a-revision', version: null }),
    ],
  });

  const result = await publishExecutorBudgetConfig({
    budgets: budgets({ retry: { ceiling: 48000 } }),
    expectedVersion: 2,
    requestId: THIRD_REQUEST_ID,
  }, deps);
  expect(result).toMatchObject({
    status: 'completed',
    config: { version: 3, latestRevision: 3 },
  });
  expect(deps.createSettingStrict).toHaveBeenCalledWith(
    'executor.budgets.v000003',
    expect.any(String),
    null,
  );
});

test('an unknown future schema is visible on reads and blocks an older publisher', async () => {
  const future = storedRevision(1);
  const key = 'executor.budgets.v000001';
  future[key].value = JSON.stringify({
    ...JSON.parse(future[key].value),
    schemaVersion: 2,
    futureField: true,
  });
  const deps = dependencies(future);
  await expect(getExecutorBudgetConfig({ strict: true }, deps)).resolves.toMatchObject({
    source: 'code_fallback',
    version: 0,
    latestRevision: 1,
    storageWarnings: [expect.objectContaining({ code: 'unsupported_executor_budget_schema' })],
  });
  await expect(publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 1,
    requestId: SECOND_REQUEST_ID,
  }, deps)).rejects.toMatchObject({
    httpStatus: 409,
    code: 'unsupported_executor_budget_schema',
  });
  expect(deps.createSettingStrict).not.toHaveBeenCalled();
});

test.each([
  ['unknown prompt', { ...budgets(), extra: { kind: 'standing' } }],
  ['unknown field', budgets({ standing: { extra: 1 } })],
  ['wrong kind', budgets({ retry: { kind: 'standing' } })],
  ['non-integer', budgets({ retry: { floor: 16000.5 } })],
  ['out of range', budgets({ standing: { timeoutMsOverride: 300000 } })],
  ['floor above ceiling', budgets({ retry: { floor: 40000, ceiling: 32000 } })],
])('closed schema rejects %s', (_label, value) => {
  expect(() => validateExecutorBudgets(value)).toThrow();
});

test('publishes and verifies the next immutable revision after model-ceiling checks', async () => {
  const deps = dependencies();
  const result = await publishExecutorBudgetConfig({
    budgets: budgets({ standing: { maxTokensOverride: 40000 } }),
    expectedVersion: 0,
    requestId: REQUEST_ID,
    profileId: 'profile-1',
  }, deps);

  expect(result).toMatchObject({ status: 'completed', config: { version: 1, source: 'dataverse' } });
  expect(deps.fetchCurrentPrompt).toHaveBeenCalledTimes(2);
  expect(deps.createSettingStrict).toHaveBeenCalledWith(
    'executor.budgets.v000001',
    expect.any(String),
    'profile-1',
  );
  expect(JSON.parse(deps.createSettingStrict.mock.calls[0][1])).toMatchObject({
    schemaVersion: 1,
    version: 1,
    requestId: REQUEST_ID,
    publishedAt: '2026-08-29T12:00:00.000Z',
  });
});

test('stale expectedVersion fails before model checks or a write', async () => {
  const deps = dependencies(storedRevision(1));
  const error = await publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 0,
    requestId: SECOND_REQUEST_ID,
  }, deps).catch(value => value);
  expect(error).toMatchObject({ httpStatus: 409, code: 'version_conflict' });
  expect(deps.loadAvailableModels).not.toHaveBeenCalled();
  expect(deps.createSettingStrict).not.toHaveBeenCalled();
});

test('requestId replay is idempotent only for the same normalized payload', async () => {
  const deps = dependencies({
    ...storedRevision(1, REQUEST_ID.toUpperCase()),
    ...storedRevision(2, SECOND_REQUEST_ID, budgets({ retry: { ceiling: 48000 } })),
    'executor.budgets.v000003': { value: '{corrupt-but-revision-reserved' },
  });
  await expect(publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 0,
    requestId: `  ${REQUEST_ID}  `,
  }, deps)).resolves.toMatchObject({
    status: 'already_published',
    config: { version: 2, latestRevision: 3 },
    publishedConfig: { version: 1 },
  });
  await expect(publishExecutorBudgetConfig({
    budgets: budgets({ retry: { ceiling: 48000 } }),
    expectedVersion: 1,
    requestId: REQUEST_ID,
  }, deps)).rejects.toMatchObject({ httpStatus: 409, code: 'idempotency_key_reused' });
  expect(deps.createSettingStrict).not.toHaveBeenCalled();
});

test('model ceiling rejects a publication before persistence', async () => {
  const deps = dependencies();
  deps.resolveModelWithCapabilities.mockReturnValue({
    model: 'claude-limited',
    capabilities: { unknown: false, maxOutputTokens: 20000 },
  });
  await expect(publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 0,
    requestId: REQUEST_ID,
  }, deps)).rejects.toMatchObject({ httpStatus: 409, code: 'model_ceiling_exceeded' });
  expect(deps.createSettingStrict).not.toHaveBeenCalled();
});

test.each([
  ['PROMPT_NOT_FOUND', 'executor_prompt_not_found'],
  ['PROMPT_DUPLICATE_CURRENT', 'executor_prompt_duplicate_current'],
])('known prompt-store state %s is returned as a typed conflict', async (promptCode, serviceCode) => {
  const deps = dependencies();
  deps.fetchCurrentPrompt.mockRejectedValue(Object.assign(new Error(`prompt state: ${promptCode}`), {
    code: promptCode,
  }));
  await expect(publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 0,
    requestId: REQUEST_ID,
  }, deps)).rejects.toMatchObject({ httpStatus: 409, code: serviceCode });
  expect(deps.createSettingStrict).not.toHaveBeenCalled();
});

test('a duplicate create is surfaced as a concurrency conflict', async () => {
  const deps = dependencies();
  deps.createSettingStrict.mockRejectedValue(Object.assign(new Error('duplicate'), {
    code: 'setting_exists',
    status: 409,
  }));
  await expect(publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 0,
    requestId: REQUEST_ID,
  }, deps)).rejects.toMatchObject({ httpStatus: 409, code: 'version_conflict' });
});

test('a POST 412 rereads current state and recognizes a matching concurrent replay', async () => {
  const deps = dependencies();
  deps.createSettingStrict.mockRejectedValue(Object.assign(new Error('duplicate'), { status: 412 }));
  deps.listSettingsWithMetaStrict
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(storedRevision(1));
  await expect(publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 0,
    requestId: REQUEST_ID,
  }, deps)).resolves.toMatchObject({
    status: 'already_published',
    config: { version: 1 },
    publishedConfig: { version: 1 },
  });
});

test('a POST 412 with the same requestId and different budgets is idempotency reuse', async () => {
  const deps = dependencies();
  deps.createSettingStrict.mockRejectedValue(Object.assign(new Error('duplicate'), { status: 412 }));
  deps.listSettingsWithMetaStrict
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(storedRevision(1, REQUEST_ID, budgets({ retry: { ceiling: 48000 } })));
  await expect(publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 0,
    requestId: REQUEST_ID,
  }, deps)).rejects.toMatchObject({ httpStatus: 409, code: 'idempotency_key_reused' });
});

test('post-create verification accepts the created revision when a later revision overtakes it', async () => {
  const deps = dependencies();
  deps.createSettingStrict.mockResolvedValue(true);
  deps.listSettingsWithMetaStrict
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      ...storedRevision(1),
      ...storedRevision(2, SECOND_REQUEST_ID, budgets({ retry: { ceiling: 48000 } })),
    });
  await expect(publishExecutorBudgetConfig({
    budgets: budgets(),
    expectedVersion: 0,
    requestId: REQUEST_ID,
  }, deps)).resolves.toMatchObject({
    status: 'completed',
    config: { version: 2 },
    publishedConfig: { version: 1 },
  });
});

test('governed prompt-model validation rejects a model below the durable retry ceiling', async () => {
  const deps = dependencies(storedRevision(1));
  deps.resolveModelWithCapabilities.mockReturnValue({
    model: 'claude-limited',
    capabilities: { unknown: false, maxOutputTokens: 20000 },
  });
  await expect(assertExecutorBudgetForPromptModel(
    'review-synthesis.generate',
    'claude-limited',
    deps,
  )).rejects.toMatchObject({ httpStatus: 409, code: 'executor_budget_model_conflict' });
});
