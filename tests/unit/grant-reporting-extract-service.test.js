/**
 * Unit tests for lib/services/grant-reporting/extract-service.js mode entry
 * points (Stage 5 batch 2). The pure helpers (extractReport /
 * compareProposalToReport) are pinned by
 * tests/unit/grant-reporting-extract-payload-boundary.test.js; this suite
 * pins the mode-level orchestration, validation errors, and the S330
 * per-write DAL context around the audit log.
 *
 * @jest-environment node
 */

jest.mock('../../shared/config/baseConfig', () => ({
  getModelForApp: jest.fn(() => 'claude-test'),
  getFallbackModelForApp: jest.fn(() => null),
}));
jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { logAiRun: jest.fn(async () => ({})) },
}));
const withDalContextSpy = jest.fn((label, fn) => fn());
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (label, fn) => withDalContextSpy(label, fn),
}));
let mockedText = 'report text';
jest.mock('../../lib/utils/file-loader', () => {
  const actual = jest.requireActual('../../lib/utils/file-loader');
  return {
    loadFile: jest.fn(async () => ({ text: mockedText, filename: 'report.pdf' })),
    httpError: actual.httpError,
  };
});
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn(async () => ({
      text: '{"value":"regenerated narrative"}',
      usage: { inputTokens: 10, outputTokens: 20 },
    })),
  })),
}));

import { DynamicsService } from '../../lib/services/dynamics-service';
import { logUsage } from '../../lib/utils/usage-logger';
import {
  handleFullExtract,
  regenerateField,
  regenerateGoals,
} from '../../lib/services/grant-reporting/extract-service';

const REF = { source: 'upload', fileUrl: 'https://x/r.pdf', filename: 'r.pdf' };
const common = { apiKey: 'sk-ant-test', requestGuid: 'guid-1', profileId: 'p1', actingUserSystemId: 'sys-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedText = 'report text';
});

describe('mode validation (ServiceHttpError 400s)', () => {
  it('full without reportRef', async () => {
    await expect(handleFullExtract({ ...common })).rejects.toMatchObject({
      httpStatus: 400, message: 'reportRef is required for mode=full',
    });
  });
  it('regenerate without reportRef / with bad fieldKey', async () => {
    await expect(regenerateField({ ...common, fieldKey: 'project_impacts' })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(regenerateField({ ...common, reportRef: REF, fieldKey: 'nope' })).rejects.toMatchObject({
      httpStatus: 400, message: expect.stringContaining('fieldKey must be one of'),
    });
  });
  it('regenerate-goals without both refs', async () => {
    await expect(regenerateGoals({ ...common, reportRef: REF })).rejects.toMatchObject({
      httpStatus: 400, message: 'Both reportRef and proposalRef are required for mode=regenerate-goals',
    });
  });
});

describe('regenerateField', () => {
  it('returns { value }, logs success usage, and audit-logs inside the S330 DAL context (label kept)', async () => {
    const r = await regenerateField({ ...common, reportRef: REF, fieldKey: 'project_impacts', currentValues: {} });
    expect(r).toEqual({ value: 'regenerated narrative' });
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', appName: 'grant-reporting' }));
    expect(withDalContextSpy).toHaveBeenCalledWith('grant-reporting-extract-ai-log', expect.any(Function));
    expect(DynamicsService.logAiRun).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'report', status: 'completed', requestGuid: 'guid-1', actingUserSystemId: 'sys-1',
    }));
  });

  it('skips the audit write entirely without a requestGuid (no context established)', async () => {
    await regenerateField({ ...common, requestGuid: null, reportRef: REF, fieldKey: 'project_impacts' });
    expect(withDalContextSpy).not.toHaveBeenCalled();
    expect(DynamicsService.logAiRun).not.toHaveBeenCalled();
  });

  it('audit failures are swallowed (best-effort), the value still returns', async () => {
    DynamicsService.logAiRun.mockRejectedValue(new Error('DAL enforcement'));
    const r = await regenerateField({ ...common, reportRef: REF, fieldKey: 'project_impacts' });
    expect(r).toEqual({ value: 'regenerated narrative' });
  });
});

describe('handleFullExtract', () => {
  it('no proposalRef → goalsAssessment null; metadata carries filenames + model', async () => {
    const { LLMClient } = require('../../lib/services/llm-client');
    LLMClient.mockImplementation(() => ({
      complete: jest.fn(async () => ({
        text: '{"header":{},"counts":{},"narratives":{}}',
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    }));
    const r = await handleFullExtract({ ...common, reportRef: REF, headerFromDynamics: {} });
    expect(Object.keys(r).sort()).toEqual(['counts', 'goalsAssessment', 'header', 'metadata', 'narratives']);
    expect(r.goalsAssessment).toBeNull();
    expect(r.metadata).toEqual({ reportFilename: 'report.pdf', proposalFilename: null, model: 'claude-test' });
  });

  it('malformed model output surfaces the historical 502 httpError shape (raw, not ServiceHttpError)', async () => {
    const { LLMClient } = require('../../lib/services/llm-client');
    LLMClient.mockImplementation(() => ({
      complete: jest.fn(async () => ({ text: '', usage: { inputTokens: 1, outputTokens: 1 } })),
    }));
    await expect(handleFullExtract({ ...common, reportRef: REF })).rejects.toMatchObject({
      status: 502, message: 'Claude returned an empty response',
    });
  });
});
