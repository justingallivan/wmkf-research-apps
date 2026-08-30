/**
 * Durable Executor output-budget settings.
 *
 * Publications are immutable `wmkf_appsystemsettings` rows named
 * `executor.budgets.vNNNNNN`. The highest valid revision is authoritative;
 * runtime reads fall back to the reviewed code defaults when Dataverse is
 * unavailable, while Admin reads and writes fail closed so corruption or an
 * outage cannot be mistaken for a successful publication.
 */
import { BASE_CONFIG } from '../../shared/config/baseConfig.js';
import {
  EXECUTOR_BUDGET_DEFAULTS,
  EXECUTOR_BUDGET_DESCRIPTIONS,
  EXECUTOR_BUDGET_LIMITS,
  EXECUTOR_BUDGET_PROMPT_NAMES,
  EXECUTOR_BUDGET_SCHEMA_VERSION,
  EXECUTOR_BUDGET_SETTING_PREFIX,
} from '../../shared/config/executorBudgets.js';
import { isGuid } from '../utils/guid.js';
import { fetchCurrentPrompt } from './prompt-store.js';
import { loadAvailableModels, resolveModelWithCapabilities } from './model-resolver.js';
import { createSettingStrict, listSettingsWithMetaStrict } from './settings-service.js';
import { ServiceHttpError } from './service-http-error.js';

const REVISION_WIDTH = 6;
const MAX_REVISION = 999_999;

const DEFAULT_DEPENDENCIES = {
  createSettingStrict,
  fetchCurrentPrompt,
  listSettingsWithMetaStrict,
  loadAvailableModels,
  now: () => new Date(),
  resolveModelWithCapabilities,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalid(message, code = 'invalid_executor_budgets') {
  return new ServiceHttpError(message, {
    httpStatus: 400,
    code,
    body: { error: message, code },
  });
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!sameValue(actual, wanted)) {
    throw invalid(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function boundedInteger(value, limits, label) {
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
    throw invalid(`${label} must be an integer from ${limits.min} through ${limits.max}.`);
  }
  return value;
}

/** Validate and normalize the closed budget schema. */
export function validateExecutorBudgets(value) {
  assertExactKeys(value, EXECUTOR_BUDGET_PROMPT_NAMES, 'budgets');

  const standingName = 'pre-site-visit.proposal-core.generate';
  const standing = value[standingName];
  assertExactKeys(standing, ['kind', 'maxTokensOverride', 'timeoutMsOverride'], `budgets.${standingName}`);
  if (standing.kind !== 'standing') {
    throw invalid(`budgets.${standingName}.kind must be "standing".`);
  }

  const retryName = 'review-synthesis.generate';
  const retry = value[retryName];
  assertExactKeys(retry, ['kind', 'floor', 'ceiling'], `budgets.${retryName}`);
  if (retry.kind !== 'retry') {
    throw invalid(`budgets.${retryName}.kind must be "retry".`);
  }

  const normalized = {
    [standingName]: {
      kind: 'standing',
      maxTokensOverride: boundedInteger(
        standing.maxTokensOverride,
        EXECUTOR_BUDGET_LIMITS[standingName].maxTokensOverride,
        `budgets.${standingName}.maxTokensOverride`,
      ),
      timeoutMsOverride: boundedInteger(
        standing.timeoutMsOverride,
        EXECUTOR_BUDGET_LIMITS[standingName].timeoutMsOverride,
        `budgets.${standingName}.timeoutMsOverride`,
      ),
    },
    [retryName]: {
      kind: 'retry',
      floor: boundedInteger(
        retry.floor,
        EXECUTOR_BUDGET_LIMITS[retryName].floor,
        `budgets.${retryName}.floor`,
      ),
      ceiling: boundedInteger(
        retry.ceiling,
        EXECUTOR_BUDGET_LIMITS[retryName].ceiling,
        `budgets.${retryName}.ceiling`,
      ),
    },
  };

  if (normalized[retryName].floor > normalized[retryName].ceiling) {
    throw invalid(`budgets.${retryName}.floor must not exceed ceiling.`);
  }
  return normalized;
}

function fallbackConfig() {
  return {
    schemaVersion: EXECUTOR_BUDGET_SCHEMA_VERSION,
    version: 0,
    requestId: null,
    publishedAt: null,
    settingKey: null,
    source: 'code_fallback',
    budgets: clone(EXECUTOR_BUDGET_DEFAULTS),
    limits: clone(EXECUTOR_BUDGET_LIMITS),
    descriptions: clone(EXECUTOR_BUDGET_DESCRIPTIONS),
    updatedById: null,
    updatedByName: null,
  };
}

function revisionFromKey(key) {
  if (!key.startsWith(EXECUTOR_BUDGET_SETTING_PREFIX)) return null;
  const suffix = key.slice(EXECUTOR_BUDGET_SETTING_PREFIX.length);
  if (!new RegExp(`^\\d{${REVISION_WIDTH}}$`).test(suffix)) return null;
  const revision = Number(suffix);
  return revision >= 1 && revision <= MAX_REVISION ? revision : null;
}

function parsePublication(key, meta) {
  const keyVersion = revisionFromKey(key);
  if (keyVersion == null) {
    throw new Error(`Executor budget setting key is malformed: ${key}`);
  }

  let envelope;
  try {
    envelope = JSON.parse(meta?.value);
  } catch (error) {
    throw new Error(`Executor budget revision ${keyVersion} is invalid JSON: ${error.message}`);
  }
  assertExactKeys(
    envelope,
    ['schemaVersion', 'version', 'requestId', 'publishedAt', 'budgets'],
    `Executor budget revision ${keyVersion}`,
  );
  if (envelope.schemaVersion !== EXECUTOR_BUDGET_SCHEMA_VERSION) {
    throw new Error(`Executor budget revision ${keyVersion} has unsupported schemaVersion ${envelope.schemaVersion}.`);
  }
  if (envelope.version !== keyVersion) {
    throw new Error(`Executor budget revision ${keyVersion} payload version does not match its key.`);
  }
  if (!isGuid(envelope.requestId)) {
    throw new Error(`Executor budget revision ${keyVersion} has an invalid requestId.`);
  }
  if (typeof envelope.publishedAt !== 'string' || !Number.isFinite(Date.parse(envelope.publishedAt))) {
    throw new Error(`Executor budget revision ${keyVersion} has an invalid publishedAt timestamp.`);
  }

  return {
    schemaVersion: envelope.schemaVersion,
    version: envelope.version,
    requestId: envelope.requestId,
    publishedAt: envelope.publishedAt,
    settingKey: key,
    source: 'dataverse',
    budgets: validateExecutorBudgets(envelope.budgets),
    limits: clone(EXECUTOR_BUDGET_LIMITS),
    descriptions: clone(EXECUTOR_BUDGET_DESCRIPTIONS),
    updatedById: meta?.updatedById ?? null,
    updatedByName: meta?.updatedByName ?? null,
  };
}

function parseAllPublications(settings) {
  return Object.entries(settings || {})
    .map(([key, meta]) => {
      try {
        return parsePublication(key, meta);
      } catch (error) {
        if (error instanceof ServiceHttpError) {
          throw new Error(`Stored Executor budget setting ${key} is invalid: ${error.message}`);
        }
        throw error;
      }
    })
    .sort((left, right) => left.version - right.version);
}

function findPublication(publications, requestId) {
  return publications.find(row => row.requestId.toLowerCase() === requestId);
}

/** Parse a strict settings read and return the latest durable revision. */
export function parseExecutorBudgetSettings(settings) {
  const publications = parseAllPublications(settings);
  return publications.at(-1) || fallbackConfig();
}

/**
 * Resolve the current budget configuration.
 * Runtime reads default to a bounded code fallback; Admin reads pass strict.
 */
export async function getExecutorBudgetConfig({ strict = false } = {}, dependencies = DEFAULT_DEPENDENCIES) {
  try {
    const settings = await dependencies.listSettingsWithMetaStrict(EXECUTOR_BUDGET_SETTING_PREFIX);
    return parseExecutorBudgetSettings(settings);
  } catch (error) {
    if (strict) throw error;
    console.error('[executor-budgets] settings read failed; using code fallback:', error.message);
    return fallbackConfig();
  }
}

/** Resolve one caller's budget from the current server-owned configuration. */
export async function getExecutorBudget(promptName, options = {}, dependencies = DEFAULT_DEPENDENCIES) {
  const config = await getExecutorBudgetConfig(options, dependencies);
  const budget = config.budgets[promptName];
  if (!budget) throw new Error(`No Executor budget contract for prompt "${promptName}".`);
  return clone(budget);
}

async function assertModelCeilings(budgets, dependencies) {
  await dependencies.loadAvailableModels();
  const modelLimits = {};
  for (const promptName of EXECUTOR_BUDGET_PROMPT_NAMES) {
    const prompt = await dependencies.fetchCurrentPrompt(promptName);
    const rawModel = prompt.wmkf_ai_model || BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
    const modelInfo = dependencies.resolveModelWithCapabilities(rawModel);
    const maxOutputTokens = modelInfo.capabilities?.maxOutputTokens;
    if (!modelInfo.model || modelInfo.capabilities?.unknown || !Number.isInteger(maxOutputTokens)) {
      throw new ServiceHttpError(
        `Prompt "${promptName}" resolves to an unreviewed model without a known output ceiling.`,
        { httpStatus: 409, code: 'unreviewed_model' },
      );
    }
    const requested = budgets[promptName].kind === 'standing'
      ? budgets[promptName].maxTokensOverride
      : budgets[promptName].ceiling;
    if (requested > maxOutputTokens) {
      throw new ServiceHttpError(
        `Budget for "${promptName}" exceeds ${modelInfo.model}'s ${maxOutputTokens}-token output ceiling.`,
        { httpStatus: 409, code: 'model_ceiling_exceeded' },
      );
    }
    modelLimits[promptName] = { model: modelInfo.model, maxOutputTokens };
  }
  return modelLimits;
}

/** Refuse a governed prompt-model change that would strand its durable budget. */
export async function assertExecutorBudgetForPromptModel(
  promptName,
  rawModel,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!EXECUTOR_BUDGET_PROMPT_NAMES.includes(promptName)) return null;
  const config = await getExecutorBudgetConfig({ strict: true }, dependencies);
  await dependencies.loadAvailableModels();
  const modelInfo = dependencies.resolveModelWithCapabilities(
    rawModel || BASE_CONFIG.CLAUDE.DEFAULT_MODEL,
  );
  const maxOutputTokens = modelInfo.capabilities?.maxOutputTokens;
  if (!modelInfo.model || modelInfo.capabilities?.unknown || !Number.isInteger(maxOutputTokens)) {
    throw new ServiceHttpError(
      `Prompt "${promptName}" resolves to an unreviewed model without a known output ceiling.`,
      { httpStatus: 409, code: 'unreviewed_model' },
    );
  }
  const budget = config.budgets[promptName];
  const requested = budget.kind === 'standing' ? budget.maxTokensOverride : budget.ceiling;
  if (requested > maxOutputTokens) {
    throw new ServiceHttpError(
      `Current Executor budget for "${promptName}" exceeds ${modelInfo.model}'s ${maxOutputTokens}-token output ceiling.`,
      { httpStatus: 409, code: 'executor_budget_model_conflict' },
    );
  }
  return { model: modelInfo.model, maxOutputTokens, budgetVersion: config.version };
}

function publicationKey(version) {
  return `${EXECUTOR_BUDGET_SETTING_PREFIX}${String(version).padStart(REVISION_WIDTH, '0')}`;
}

/** Publish one append-only, optimistic-concurrency-protected revision. */
export async function publishExecutorBudgetConfig(
  { budgets: rawBudgets, expectedVersion, requestId, profileId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) throw invalid('requestId must be a UUID.', 'invalid_request_id');
  const normalizedRequestId = requestId.trim().toLowerCase();
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw invalid('expectedVersion must be a non-negative integer.', 'invalid_expected_version');
  }
  const budgets = validateExecutorBudgets(rawBudgets);
  const settings = await dependencies.listSettingsWithMetaStrict(EXECUTOR_BUDGET_SETTING_PREFIX);
  const publications = parseAllPublications(settings);
  const current = publications.at(-1) || fallbackConfig();
  const replay = findPublication(publications, normalizedRequestId);
  if (replay) {
    if (!sameValue(replay.budgets, budgets)) {
      throw new ServiceHttpError('requestId was already used for different Executor budgets.', {
        httpStatus: 409,
        code: 'idempotency_key_reused',
      });
    }
    return { status: 'already_published', config: current, publishedConfig: replay, modelLimits: null };
  }
  if (current.version !== expectedVersion) {
    throw new ServiceHttpError('Executor budgets changed after this editor was loaded.', {
      httpStatus: 409,
      code: 'version_conflict',
      body: { error: 'Executor budgets changed after this editor was loaded.', code: 'version_conflict', current },
    });
  }
  if (current.version >= MAX_REVISION) {
    throw new ServiceHttpError('Executor budget revision space is exhausted.', {
      httpStatus: 409,
      code: 'revision_exhausted',
    });
  }

  const modelLimits = await assertModelCeilings(budgets, dependencies);
  const version = current.version + 1;
  const key = publicationKey(version);
  const envelope = {
    schemaVersion: EXECUTOR_BUDGET_SCHEMA_VERSION,
    version,
    requestId: normalizedRequestId,
    publishedAt: dependencies.now().toISOString(),
    budgets,
  };
  try {
    await dependencies.createSettingStrict(key, JSON.stringify(envelope), profileId);
  } catch (error) {
    if (error?.code === 'setting_exists' || error?.status === 409 || error?.status === 412) {
      const afterSettings = await dependencies.listSettingsWithMetaStrict(EXECUTOR_BUDGET_SETTING_PREFIX);
      const afterPublications = parseAllPublications(afterSettings);
      const afterCurrent = afterPublications.at(-1) || fallbackConfig();
      const afterReplay = findPublication(afterPublications, normalizedRequestId);
      if (afterReplay) {
        if (!sameValue(afterReplay.budgets, budgets)) {
          throw new ServiceHttpError('requestId was already used for different Executor budgets.', {
            httpStatus: 409,
            code: 'idempotency_key_reused',
          });
        }
        return {
          status: 'already_published', config: afterCurrent, publishedConfig: afterReplay, modelLimits: null,
        };
      }
      throw new ServiceHttpError('A concurrent Executor budget publication won this revision.', {
        httpStatus: 409,
        code: 'version_conflict',
        body: {
          error: 'A concurrent Executor budget publication won this revision.',
          code: 'version_conflict',
          current: afterCurrent,
        },
      });
    }
    throw error;
  }

  const verifiedSettings = await dependencies.listSettingsWithMetaStrict(EXECUTOR_BUDGET_SETTING_PREFIX);
  const verifiedPublications = parseAllPublications(verifiedSettings);
  const publishedConfig = verifiedPublications.find(row => row.version === version);
  const verified = verifiedPublications.at(-1) || fallbackConfig();
  if (!publishedConfig
      || publishedConfig.requestId.toLowerCase() !== normalizedRequestId
      || !sameValue(publishedConfig.budgets, budgets)) {
    throw new Error(`Executor budget revision ${version} could not be verified after creation.`);
  }
  return { status: 'completed', config: verified, publishedConfig, modelLimits };
}
