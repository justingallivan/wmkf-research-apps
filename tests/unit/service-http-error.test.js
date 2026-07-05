/**
 * ServiceHttpError — campaign-wide typed service error (Route→Service
 * Consolidation Plan, Decision 3 shape generalized after the P1 pilot
 * retrospective). Pins: default { error: message } mapping, custom body
 * passthrough, required httpStatus, and the instanceof chain used by shells.
 */

const { ServiceHttpError } = require('../../lib/services/service-http-error');
const { WithdrawSufficientError } = require('../../lib/services/review-manager/withdraw-sufficient-service');

test('default body mapping: no body given -> shell template sends { error: message }', () => {
  const e = new ServiceHttpError('nope', { httpStatus: 404 });
  expect(e.httpStatus).toBe(404);
  expect(e.body).toBeUndefined();
  // The shell template: e.body ?? { error: e.message }
  expect(e.body ?? { error: e.message }).toEqual({ error: 'nope' });
});

test('custom body passthrough: exact JSON wins over the default envelope', () => {
  const body = { ok: false, reason: 'expired' };
  const e = new ServiceHttpError('token expired', { httpStatus: 410, body, code: 'token_expired' });
  expect(e.body ?? { error: e.message }).toBe(body);
  expect(e.code).toBe('token_expired');
  expect(e.httpStatus).toBe(410);
});

test('httpStatus is required and must be a number', () => {
  expect(() => new ServiceHttpError('x', {})).toThrow(/httpStatus/);
  expect(() => new ServiceHttpError('x')).toThrow(/httpStatus/);
  expect(() => new ServiceHttpError('x', { httpStatus: '404' })).toThrow(/httpStatus/);
});

test('instanceof chain: domain subclass is a ServiceHttpError and an Error', () => {
  const e = new WithdrawSufficientError('No request found for r-1', 404);
  expect(e).toBeInstanceOf(WithdrawSufficientError);
  expect(e).toBeInstanceOf(ServiceHttpError);
  expect(e).toBeInstanceOf(Error);
  expect(e.name).toBe('WithdrawSufficientError');
  expect(e.httpStatus).toBe(404);
  expect(e.body ?? { error: e.message }).toEqual({ error: 'No request found for r-1' });
});
