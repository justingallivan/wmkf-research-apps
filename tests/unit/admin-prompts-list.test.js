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
  DynamicsService.queryRecords.mockClear();
  const r = res();
  await handler({ method: 'GET' }, r);
  // gate already sent the response; handler returns without calling json again
  expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
});

it('405 on non-GET, no auth check performed', async () => {
  const { requireSuperuser } = require('../../lib/utils/auth');
  requireSuperuser.mockClear();
  DynamicsService.queryRecords.mockClear();
  const r = res();
  await handler({ method: 'POST' }, r);
  expect(r.statusCode).toBe(405);
  expect(r.body).toEqual({ error: 'Method not allowed' });
  expect(requireSuperuser).not.toHaveBeenCalled();
});

it('golden: single-row full envelope pinned (every mapRow field)', async () => {
  const fullRow = {
    wmkf_ai_promptid: 'id-1',
    wmkf_ai_promptname: 'solo.prompt',
    wmkf_promptversion: 3,
    wmkf_ai_iscurrent: true,
    wmkf_ai_promptstatus: 'Published',
    wmkf_ai_systemprompt: 'sys',
    wmkf_ai_promptbody: 'body-text',
    wmkf_ai_promptvariables: '["x"]',
    wmkf_ai_promptoutputschema: '{"type":"object"}',
    wmkf_ai_model: 'claude-test',
    wmkf_ai_temperature: 0.2,
    wmkf_ai_maxtokens: 1024,
    createdon: '2026-01-01T00:00:00Z',
    wmkf_ai_publisheddatetime: '2026-01-02T00:00:00Z',
    modifiedon: '2026-01-03T00:00:00Z',
    _modifiedby_value: 'user-1',
    _modifiedby_value_formatted: 'Jane Doe',
  };
  DynamicsService.queryRecords.mockImplementation((entity, opts) =>
    Promise.resolve({ records: opts.filter.includes('eq true') ? [fullRow] : [] })
  );
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({
    prompts: [{
      id: 'id-1',
      name: 'solo.prompt',
      version: 3,
      isCurrent: true,
      hasCurrent: true,
      status: 'Published',
      systemPrompt: 'sys',
      body: 'body-text',
      variables: '["x"]',
      outputSchema: '{"type":"object"}',
      model: 'claude-test',
      temperature: 0.2,
      maxTokens: 1024,
      createdOn: '2026-01-01T00:00:00Z',
      publishedAt: '2026-01-02T00:00:00Z',
      modifiedOn: '2026-01-03T00:00:00Z',
      modifiedById: 'user-1',
      modifiedByName: 'Jane Doe',
    }],
  });
});

it('unexpected adapter failure returns a generic 500 envelope', async () => {
  DynamicsService.queryRecords.mockRejectedValue(new Error('Dataverse unavailable'));
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(500);
  expect(r.body).toEqual({ error: 'Internal error' });
});
