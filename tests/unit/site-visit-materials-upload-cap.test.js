/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/settings-service.js', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }));

import { requireSuperuser } from '../../lib/utils/auth';
import { getSetting, setSetting } from '../../lib/services/settings-service.js';
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
});

test('the cap reads the setting when it is a whole number in range, else the default of 100 MB; a read failure is 503', async () => {
  for (const [raw, expected] of [['250', { maxMb: 250, source: 'setting' }], [null, { maxMb: 100, source: 'default' }], ['abc', { maxMb: 100, source: 'default' }], ['0', { maxMb: 100, source: 'default' }], ['501', { maxMb: 100, source: 'default' }], ['12.5', { maxMb: 100, source: 'default' }]]) {
    getSetting.mockResolvedValueOnce(raw);
    expect(await getUploadMaxMb()).toEqual(expected);
  }
  // A read failure must not widen a lower configured cap: fail closed, never default.
  getSetting.mockRejectedValueOnce(new Error('dataverse down'));
  await expect(getUploadMaxMb()).rejects.toMatchObject({ httpStatus: 503, code: 'site_visit_materials_cap_unavailable' });
  expect(uploadMaxBytes(100)).toBe(104857600);
});

test('setting the cap validates the range and writes the string value with the actor', async () => {
  await expect(setUploadMaxMb(0)).rejects.toMatchObject({ httpStatus: 400, code: 'site_visit_materials_cap_invalid' });
  await expect(setUploadMaxMb('lots')).rejects.toMatchObject({ httpStatus: 400 });
  expect(setSetting).not.toHaveBeenCalled();
  expect(await setUploadMaxMb('150', { updatedBy: 3 })).toEqual({ maxMb: 150, source: 'setting' });
  expect(setSetting).toHaveBeenCalledWith('site_visit_materials.upload_max_mb', '150', 3);
});

test('the admin route is superuser-only, GET reports the cap with limits, PUT takes exactly maxMb', async () => {
  getSetting.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler({ method: 'GET', query: {} }, res);
  expect(requireSuperuser).toHaveBeenCalled();
  expect(res.body).toEqual({ success: true, maxMb: 100, source: 'default', limits: { min: 1, max: 500 }, defaultMb: 100 });

  const bad = mockRes();
  await handler({ method: 'PUT', body: { maxMb: 120, extra: true } }, bad);
  expect(bad.statusCode).toBe(400);

  const ok = mockRes();
  await handler({ method: 'PUT', body: { maxMb: 120 } }, ok);
  expect(setSetting).toHaveBeenCalledWith('site_visit_materials.upload_max_mb', '120', 3);
  expect(ok.body).toMatchObject({ success: true, maxMb: 120, source: 'setting' });

  requireSuperuser.mockResolvedValueOnce(null);
  const denied = mockRes();
  await handler({ method: 'GET', query: {} }, denied);
  expect(denied.body).toBeNull();
});
