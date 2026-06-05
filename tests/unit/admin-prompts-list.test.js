/**
 * @jest-environment node
 */
/** /api/admin/prompts GET — lists EVERY prompt incl. drafts (no current version). */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 1 })) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (a, b) => (typeof a === 'function' ? a() : b()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { queryRecords: jest.fn() } }));

import handler from '../../pages/api/admin/prompts/index';
import { DynamicsService } from '../../lib/services/dynamics-service';

function res() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }
const row = (name, version, iscurrent) => ({ wmkf_ai_promptname: name, wmkf_promptversion: version, wmkf_ai_iscurrent: iscurrent, wmkf_ai_promptbody: 'b' });

it('lists current prompts AND draft-only prompts (hasCurrent flag)', async () => {
  DynamicsService.queryRecords.mockImplementation((entity, opts) => {
    if (opts.filter.includes('eq true')) return Promise.resolve({ records: [row('reviewer-finder.analyze', 1, true), row('phase-i.summary', 1, true)] });
    // non-current: an old version of analyze (history) + a draft-only prompt
    return Promise.resolve({ records: [row('reviewer-finder.analyze', 0, false), row('phase-i.checkin', 1, false)] });
  });
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(200);
  const byName = Object.fromEntries(r.body.prompts.map((p) => [p.name, p]));
  // 3 distinct names: the 2 current + the 1 draft (old analyze version is NOT a separate entry)
  expect(r.body.prompts.map((p) => p.name).sort()).toEqual(['phase-i.checkin', 'phase-i.summary', 'reviewer-finder.analyze']);
  expect(byName['reviewer-finder.analyze'].hasCurrent).toBe(true);
  expect(byName['phase-i.checkin'].hasCurrent).toBe(false);
  expect(byName['phase-i.checkin'].isCurrent).toBe(false);
});

it('rejects non-superusers (handled by requireSuperuser gate)', async () => {
  const { requireSuperuser } = require('../../lib/utils/auth');
  requireSuperuser.mockResolvedValueOnce(null);
  const r = res();
  await handler({ method: 'GET' }, r);
  // gate already sent the response; handler returns without calling json again
  expect(DynamicsService.queryRecords).not.toHaveBeenCalledTimes(99);
});
