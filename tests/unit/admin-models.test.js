/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 9 })) }));
jest.mock('../../lib/services/model-override-loader', () => ({ clearModelOverridesCache: jest.fn() }));
jest.mock('../../lib/services/settings-service', () => ({
  listSettings: jest.fn(async () => ({})),
  setSetting: jest.fn(async () => true),
  deleteSetting: jest.fn(async () => true),
}));

import handler from '../../pages/api/admin/models';
import { setSetting, deleteSetting } from '../../lib/services/settings-service';
import { clearModelOverridesCache } from '../../lib/services/model-override-loader';

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

beforeEach(() => {
  setSetting.mockClear();
  deleteSetting.mockClear();
  clearModelOverridesCache.mockClear();
});

describe('PUT /api/admin/models', () => {
  it('saves a tier override as the canonical lowercase key', async () => {
    const res = mockRes();
    await handler({
      method: 'PUT',
      body: { appKey: 'reviewer-finder', modelType: 'model', modelId: 'Sonnet' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      settingKey: 'model_override:reviewer-finder:model',
      modelId: 'sonnet',
    });
    expect(setSetting).toHaveBeenCalledWith('model_override:reviewer-finder:model', 'sonnet', 9);
    expect(clearModelOverridesCache).toHaveBeenCalledTimes(1);
  });

  it('saves a reviewed concrete Claude model override', async () => {
    const res = mockRes();
    await handler({
      method: 'PUT',
      body: { appKey: 'reviewer-finder', modelType: 'fallback', modelId: 'claude-sonnet-4-6' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(setSetting).toHaveBeenCalledWith('model_override:reviewer-finder:fallback', 'claude-sonnet-4-6', 9);
  });

  it('rejects an unreviewed future Claude id before persisting', async () => {
    const res = mockRes();
    await handler({
      method: 'PUT',
      body: { appKey: 'reviewer-finder', modelType: 'model', modelId: 'claude-future-99' },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('unreviewed_claude_model');
    expect(setSetting).not.toHaveBeenCalled();
    expect(clearModelOverridesCache).not.toHaveBeenCalled();
  });

  it('rejects non-Claude model ids for this Claude override endpoint', async () => {
    const res = mockRes();
    await handler({
      method: 'PUT',
      body: { appKey: 'reviewer-finder', modelType: 'model', modelId: 'gpt-4o-mini' },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('invalid_model_value');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('clears an override without model-review validation', async () => {
    const res = mockRes();
    await handler({
      method: 'PUT',
      body: { appKey: 'reviewer-finder', modelType: 'model', modelId: '' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(deleteSetting).toHaveBeenCalledWith('model_override:reviewer-finder:model');
    expect(res.body.modelId).toBeNull();
  });
});
