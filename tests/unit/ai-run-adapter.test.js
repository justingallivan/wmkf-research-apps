/**
 * Characterization tests for the wmkf_ai_runs adapter
 * (lib/dataverse/adapters/ai-run.js).
 *
 * Byte-mirrors the raw call in lib/services/execute-prompt.js's writeRunRow:
 * `DynamicsService.createRecord('wmkf_ai_runs', payload, { actingUserSystemId })`.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as aiRun from '../../lib/dataverse/adapters/ai-run.js';

afterEach(() => jest.restoreAllMocks());

describe('ai-run.create (characterization)', () => {
  test('golden: forwards payload + options verbatim, returns the created record', async () => {
    const c = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_ai_runid: 'run-1' });
    const payload = { wmkf_ai_status: 1, wmkf_ai_runsource: 2 };
    const out = await aiRun.create(payload, { actingUserSystemId: 'sys-1' });
    expect(out).toEqual({ wmkf_ai_runid: 'run-1' });
    expect(c).toHaveBeenCalledWith('wmkf_ai_runs', payload, { actingUserSystemId: 'sys-1' });
  });

  test('omits options entirely when the caller passes none (byte-for-byte 2-arg call)', async () => {
    const c = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({});
    await aiRun.create({ wmkf_ai_status: 1 });
    expect(c).toHaveBeenCalledWith('wmkf_ai_runs', { wmkf_ai_status: 1 });
    expect(c.mock.calls[0]).toHaveLength(2);
  });

  test('failure path: propagates a createRecord rejection', async () => {
    jest.spyOn(DynamicsService, 'createRecord').mockRejectedValue(new Error('boom'));
    await expect(aiRun.create({}, { actingUserSystemId: 'sys' })).rejects.toThrow('boom');
  });
});

describe('ai-run.getByIdWithSelect (characterization)', () => {
  test('byte-mirrors prompt-resolver\'s scratch-row select', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_ai_notes: 'system prompt', wmkf_ai_rawoutput: 'user template {{var}}',
    });
    const out = await aiRun.getByIdWithSelect('a03f77d9-913a-f111-88b5-000d3a3065b8', 'wmkf_ai_notes,wmkf_ai_rawoutput');
    expect(out).toEqual({ wmkf_ai_notes: 'system prompt', wmkf_ai_rawoutput: 'user template {{var}}' });
    expect(g).toHaveBeenCalledWith('wmkf_ai_runs', 'a03f77d9-913a-f111-88b5-000d3a3065b8', {
      select: 'wmkf_ai_notes,wmkf_ai_rawoutput',
    });
  });

  test('failure path: propagates a getRecord rejection', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('not found'));
    await expect(aiRun.getByIdWithSelect('x', 'a,b')).rejects.toThrow('not found');
  });
});
