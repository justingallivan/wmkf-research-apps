/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/settings-service.js', () => ({ getSettingStrict: jest.fn(), setSetting: jest.fn() }));

import { requireSuperuser } from '../../lib/utils/auth';
import { getSettingStrict, setSetting } from '../../lib/services/settings-service.js';
import { getDueBusinessDays, setDueBusinessDays } from '../../lib/services/site-visit-materials/due-date-setting';
import { getUploadMaxMb, setUploadMaxMb, uploadMaxBytes } from '../../lib/services/site-visit-materials/upload-cap';
import handler from '../../pages/api/admin/site-visit-materials-defaults';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireSuperuser.mockResolvedValue({ profileId: 3 });
  setSetting.mockResolvedValue(true);
  getSettingStrict.mockResolvedValue({ found: false, value: null });
});

test('the cap reads an in-range setting, else the default of 500 MB; a read failure is 503', async () => {
  for (const [raw, expected] of [['250', { maxMb: 250, source: 'setting' }], [null, { maxMb: 500, source: 'default' }], ['abc', { maxMb: 500, source: 'default' }], ['0', { maxMb: 500, source: 'default' }], ['501', { maxMb: 500, source: 'default' }], ['12.5', { maxMb: 500, source: 'default' }]]) {
    getSettingStrict.mockResolvedValueOnce(raw === null ? { found: false, value: null } : { found: true, value: raw });
    expect(await getUploadMaxMb()).toEqual(expected);
  }
  // A read failure must not widen a lower configured cap: fail closed, never default.
  getSettingStrict.mockRejectedValueOnce(new Error('dataverse down'));
  const error = await getUploadMaxMb().catch((caught) => caught);
  expect(error).toMatchObject({
    httpStatus: 503,
    code: 'site_visit_materials_cap_unavailable',
    body: { ok: false, reason: 'cap_unavailable' },
  });
  expect(error.body).toEqual({ ok: false, reason: 'cap_unavailable' });
  expect(uploadMaxBytes(500)).toBe(524288000);
});

test('setting the cap validates the range and writes the string value with the actor', async () => {
  await expect(setUploadMaxMb(0)).rejects.toMatchObject({ httpStatus: 400, code: 'site_visit_materials_cap_invalid' });
  await expect(setUploadMaxMb('lots')).rejects.toMatchObject({ httpStatus: 400 });
  expect(setSetting).not.toHaveBeenCalled();
  expect(await setUploadMaxMb('150', { updatedBy: 3 })).toEqual({ maxMb: 150, source: 'setting' });
  expect(setSetting).toHaveBeenCalledWith('site_visit_materials.upload_max_mb', '150', 3);
  setSetting.mockResolvedValueOnce(false);
  await expect(setUploadMaxMb(175)).rejects.toMatchObject({
    httpStatus: 503,
    code: 'site_visit_materials_cap_unavailable',
    body: { ok: false, reason: 'cap_unavailable' },
  });
});

test('the admin route is superuser-only, GET reports the cap with limits, PUT takes exactly maxMb', async () => {
  getSettingStrict.mockResolvedValueOnce({ found: false, value: null });
  const res = mockRes();
  await handler({ method: 'GET', query: {} }, res);
  expect(requireSuperuser).toHaveBeenCalled();
  expect(res.body).toEqual({ success: true, maxMb: 500, source: 'default', limits: { min: 1, max: 500 }, defaultMb: 500, dueBusinessDays: 2, dueDaysSource: 'default', dueDaysLimits: { min: 1, max: 30 }, defaultDueBusinessDays: 2 });

  const bad = mockRes();
  await handler({ method: 'PUT', body: { maxMb: 120, extra: true } }, bad);
  expect(bad.statusCode).toBe(400);

  const ok = mockRes();
  await handler({ method: 'PUT', body: { maxMb: 120 } }, ok);
  expect(setSetting).toHaveBeenCalledWith('site_visit_materials.upload_max_mb', '120', 3);
  expect(ok.body).toMatchObject({ success: true, maxMb: 120, source: 'setting' });

  setSetting.mockResolvedValueOnce(false);
  const unavailable = mockRes();
  await handler({ method: 'PUT', body: { maxMb: 125 } }, unavailable);
  expect(unavailable.statusCode).toBe(503);
  expect(unavailable.body).toEqual({ ok: false, reason: 'cap_unavailable' });

  requireSuperuser.mockResolvedValueOnce(null);
  const denied = mockRes();
  await handler({ method: 'GET', query: {} }, denied);
  expect(denied.body).toBeNull();
});


test('due offset defaults only when absent and reads a valid saved value', async () => {
  expect(await getDueBusinessDays()).toEqual({ dueBusinessDays: 2, dueDaysSource: 'default' });
  getSettingStrict.mockResolvedValueOnce({ found: true, value: '5' });
  expect(await getDueBusinessDays()).toEqual({ dueBusinessDays: 5, dueDaysSource: 'setting' });
  expect(getSettingStrict).toHaveBeenCalledWith('site_visit_materials.due_business_days');
});

test.each([null, '', ' ', false, [], {}, 0, -1, 31, 1.5, 'abc', '2days'])('invalid offset %p cannot be saved or used from storage', async (value) => {
  await expect(setDueBusinessDays(value)).rejects.toMatchObject({ httpStatus: 400 });
  expect(setSetting).not.toHaveBeenCalled();
  getSettingStrict.mockResolvedValueOnce({ found: true, value });
  await expect(getDueBusinessDays()).rejects.toMatchObject({ httpStatus: 503 });
});

test('offset read/write failures are explicit and saves retain actor attribution', async () => {
  getSettingStrict.mockRejectedValueOnce(new Error('private storage error'));
  await expect(getDueBusinessDays()).rejects.toMatchObject({ httpStatus: 503, code: 'site_visit_materials_due_days_unavailable' });
  for (const value of [1, 30]) {
    expect(await setDueBusinessDays(value, { updatedBy: 3 })).toEqual({ dueBusinessDays: value, dueDaysSource: 'setting' });
    expect(setSetting).toHaveBeenLastCalledWith('site_visit_materials.due_business_days', String(value), 3);
  }
  setSetting.mockResolvedValueOnce(false);
  await expect(setDueBusinessDays(5)).rejects.toMatchObject({ httpStatus: 503 });
  setSetting.mockRejectedValueOnce(new Error('private storage error'));
  await expect(setDueBusinessDays(5)).rejects.toMatchObject({ httpStatus: 503 });
});

test('the admin route saves only the selected setting and rejects combined or unprivileged writes', async () => {
  const res = mockRes();
  await handler({ method: 'PUT', body: { dueBusinessDays: 5 } }, res);
  expect(res.body).toEqual({ success: true, dueBusinessDays: 5, dueDaysSource: 'setting' });
  expect(setSetting).toHaveBeenCalledTimes(1);
  expect(setSetting).toHaveBeenCalledWith('site_visit_materials.due_business_days', '5', 3);
  const combined = mockRes();
  await handler({ method: 'PUT', body: { dueBusinessDays: 5, maxMb: 120 } }, combined);
  expect(combined.statusCode).toBe(400);
  requireSuperuser.mockResolvedValueOnce(null);
  await handler({ method: 'PUT', body: { dueBusinessDays: 6 } }, mockRes());
  expect(setSetting).toHaveBeenCalledTimes(1);
});
