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

import handler, { buildModelRegistryStatus } from '../../pages/api/admin/models';
import { listSettings, setSetting, deleteSetting } from '../../lib/services/settings-service';
import { clearModelOverridesCache } from '../../lib/services/model-override-loader';
import { clearAvailableModelsCache } from '../../lib/services/model-resolver';

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const originalClaudeKey = process.env.CLAUDE_API_KEY;

beforeEach(() => {
  listSettings.mockClear().mockResolvedValue({});
  setSetting.mockClear();
  deleteSetting.mockClear();
  clearModelOverridesCache.mockClear();
  clearAvailableModelsCache();
  delete process.env.CLAUDE_API_KEY;
});

afterEach(() => {
  if (originalClaudeKey === undefined) {
    delete process.env.CLAUDE_API_KEY;
  } else {
    process.env.CLAUDE_API_KEY = originalClaudeKey;
  }
});

describe('GET /api/admin/models', () => {
  it('returns read-only capability and pricing status for effective models', async () => {
    listSettings.mockResolvedValueOnce({
      'model_override:reviewer-finder:model': 'claude-future-99',
    });

    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);

    const reviewerFinder = res.body.apps.find(app => app.appKey === 'reviewer-finder');
    expect(res.statusCode).toBe(200);
    expect(reviewerFinder.models.model).toMatchObject({
      stored: 'claude-future-99',
      effective: 'claude-future-99',
      source: 'db',
      registryStatus: {
        ok: false,
        capability: { status: 'missing' },
        pricing: { status: 'missing' },
      },
    });
    expect(res.body.modelStatuses['claude-future-99']).toMatchObject({
      ok: false,
      capability: { status: 'missing' },
      pricing: { status: 'missing' },
    });
    expect(setSetting).not.toHaveBeenCalled();
    expect(deleteSetting).not.toHaveBeenCalled();
  });

  it('classifies reviewed concrete ids as capability and pricing covered', () => {
    expect(buildModelRegistryStatus('claude-sonnet-4-6')).toMatchObject({
      modelId: 'claude-sonnet-4-6',
      ok: true,
      capability: {
        status: 'reviewed',
        supportsTemperature: true,
        supportsEffort: true,
        supportsStructuredOutput: true,
        maxOutputTokens: 128000,
      },
      pricing: {
        status: 'reviewed',
        inputCentsPerMTok: 300,
        outputCentsPerMTok: 1500,
      },
    });
  });

  it('returns provider-bound review-panel slots with reviewed provider-filtered lists', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);

    const panel = res.body.apps.find(app => app.appKey === 'review-panel');
    expect(panel).toMatchObject({ providerBound: true });
    expect(Object.keys(panel.models)).toEqual(['seat.claude', 'seat.openai', 'chair']);
    expect(panel.models['seat.openai']).toMatchObject({
      vendor: 'openai',
      hardcoded: 'gpt-5.6-sol',
      effective: 'gpt-5.6-sol',
    });
    expect(panel.models['seat.openai'].availableModels.map(model => model.id))
      .toEqual(['gpt-5.6-sol']);
    for (const model of panel.models['seat.claude'].availableModels) {
      expect(res.body.modelStatuses[model.id]?.capability?.provider).toBe('anthropic');
      expect(res.body.modelStatuses[model.id]?.ok).toBe(true);
    }
  });
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

  it('saves a reviewed OpenAI model only in the OpenAI seat', async () => {
    const res = mockRes();
    await handler({
      method: 'PUT',
      body: { appKey: 'review-panel', modelType: 'seat.openai', modelId: 'gpt-5.6-sol' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(setSetting).toHaveBeenCalledWith(
      'model_override:review-panel:seat.openai',
      'gpt-5.6-sol',
      9,
    );
  });

  it('rejects an OpenAI model for the Anthropic chair before persistence', async () => {
    const res = mockRes();
    await handler({
      method: 'PUT',
      body: { appKey: 'review-panel', modelType: 'chair', modelId: 'gpt-5.6-sol' },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('provider_model_mismatch');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('rejects an unreviewed same-provider slot value before persistence', async () => {
    const res = mockRes();
    await handler({
      method: 'PUT',
      body: { appKey: 'review-panel', modelType: 'seat.openai', modelId: 'gpt-future' },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('unreviewed_provider_model');
    expect(setSetting).not.toHaveBeenCalled();
  });
});

describe('admin provider-bound review-panel UI contract', () => {
  const fs = require('fs');
  const path = require('path');
  const adminSource = fs.readFileSync(path.join(__dirname, '../../pages/admin.js'), 'utf8');

  it('renders the review panel separately from legacy Claude app rows', () => {
    expect(adminSource).toContain("apps.find(app => app.appKey === 'review-panel')");
    expect(adminSource).toContain('apps.filter(app => !app.providerBound)');
    expect(adminSource).toContain('Each slot has a fixed provider.');
  });

  it('shows vendor as read-only text and models from each slot list', () => {
    expect(adminSource).toContain('{info.vendor}</td>');
    expect(adminSource).toContain('(info.availableModels || []).map(model =>');
    expect(adminSource).toContain('handleChange(reviewPanel.appKey, slotKey, e.target.value)');
    expect(adminSource).not.toMatch(/handleChange\(reviewPanel\.appKey,\s*['"]provider/);
  });
});
