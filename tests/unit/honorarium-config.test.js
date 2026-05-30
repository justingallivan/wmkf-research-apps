/**
 * Tests for lib/services/honorarium-config.js — the single Dataverse
 * ground-truth honorarium amount reader (chunk-4, S199).
 *
 * Critical (Codex pre-impl P1): a settings FETCH FAILURE must NOT silently
 * mint the fallback amount; only a confirmed-absent key falls back to 250.
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/settings-service', () => ({ getSettingStrict: jest.fn() }));

const { getSettingStrict } = require('../../lib/services/settings-service');
const { getHonorariumAmount, DEFAULT_HONORARIUM_AMOUNT } = require('../../lib/services/honorarium-config');

beforeEach(() => { getSettingStrict.mockReset(); });

describe('getHonorariumAmount', () => {
  it('confirmed-absent key → documented default (250)', async () => {
    getSettingStrict.mockResolvedValueOnce({ found: false, value: null });
    await expect(getHonorariumAmount()).resolves.toBe(DEFAULT_HONORARIUM_AMOUNT);
  });

  it('present-but-empty value → default', async () => {
    getSettingStrict.mockResolvedValueOnce({ found: true, value: '   ' });
    await expect(getHonorariumAmount()).resolves.toBe(250);
  });

  it('valid stored value → parsed number', async () => {
    getSettingStrict.mockResolvedValueOnce({ found: true, value: '500' });
    await expect(getHonorariumAmount()).resolves.toBe(500);
  });

  it('malformed value (non-numeric) → throws, never defaults', async () => {
    getSettingStrict.mockResolvedValueOnce({ found: true, value: 'N/A' });
    await expect(getHonorariumAmount()).rejects.toMatchObject({ code: 'honorarium_amount_malformed' });
  });

  it('zero / negative value → throws malformed', async () => {
    getSettingStrict.mockResolvedValueOnce({ found: true, value: '0' });
    await expect(getHonorariumAmount()).rejects.toMatchObject({ code: 'honorarium_amount_malformed' });
  });

  it('settings FETCH FAILURE → throws unavailable (does NOT silently mint 250)', async () => {
    getSettingStrict.mockRejectedValueOnce(new Error('Dynamics 503'));
    await expect(getHonorariumAmount()).rejects.toMatchObject({ code: 'honorarium_amount_unavailable' });
  });
});
