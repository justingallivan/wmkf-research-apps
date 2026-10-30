/** @jest-environment node */
const { options, checkedUrl } = require('../../scripts/probe-prompt-publication-test-readiness.cjs');
describe('PR553 test-only read boundary', () => {
  test.each([
    'https://wmkf.crm.dynamics.com/api/data/v9.2/WhoAmI',
    'https://example.org/api/data/v9.2/WhoAmI',
    'https://orgd9e66399.crm.dynamics.com/not-an-api',
    'https://user:password@orgd9e66399.crm.dynamics.com/api/data/v9.2/WhoAmI',
    'WhoAmI#fragment',
    '../../../other',
  ])('rejects cross-target or malformed paging: %s', value => expect(() => checkedUrl(value)).toThrow());
  test('permits a next page on the fixed test API', () => {
    expect(checkedUrl('https://orgd9e66399.crm.dynamics.com/api/data/v9.2/solutions?$skiptoken=opaque').hostname).toBe('orgd9e66399.crm.dynamics.com');
  });
  test.each([[], ['--execute'], ['--env-file', 'relative', '--output', '/tmp/new.json'], ['--env-file', '/tmp/creds', '--output', process.cwd()]])('rejects invalid/executable/overwrite arguments: %j', (...args) => expect(() => options(args)).toThrow());
});

test('explicit credential file cannot be silently shadowed by shell credentials', () => {
  const fs = require('node:fs');
  const { readCredentials } = require('../../scripts/probe-prompt-publication-test-readiness.cjs');
  const original = process.env.DYNAMICS_CLIENT_ID;
  process.env.DYNAMICS_CLIENT_ID = 'different-shell-principal';
  const read = jest.spyOn(fs, 'readFileSync').mockReturnValue('DYNAMICS_TENANT_ID=file-tenant\nexport DYNAMICS_CLIENT_ID=file-principal\nDYNAMICS_CLIENT_SECRET=unit-test-only\n');
  try { expect(readCredentials('/explicit/file').DYNAMICS_CLIENT_ID).toBe('file-principal'); }
  finally { read.mockRestore(); if (original === undefined) delete process.env.DYNAMICS_CLIENT_ID; else process.env.DYNAMICS_CLIENT_ID = original; }
});


test('synthetic proposal carries the actual snapshot hash and remains non-executable', () => {
  const proposal = require('../../dataverse/prompt-publication/rehearsal/first-publication-proposal.json');
  const { hashSnapshot } = require('../../lib/prompt-publication/fingerprint');
  const { validateDefinition } = require('../../lib/prompt-publication/definition-schema');
  expect(validateDefinition(proposal.snapshot.definition).valid).toBe(true);
  expect(proposal.snapshotHash).toBe(hashSnapshot(proposal.snapshot).hash);
  expect(proposal.request).toBeNull();
  expect(proposal.draftId).toBeNull();
  expect(proposal.liveWritesAuthorized).toBe(false);
});
