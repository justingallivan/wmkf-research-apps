/** @jest-environment jsdom */
import { createRehearsalTransport, getServerSideProps } from '../../pages/meeting-tracker/materials-email-rehearsal';

const invitation = {
  subject: 'Materials for {{proposalTitle}}',
  body: '{{institution}}\n{{proposalTitle}}\n{{checklist}}\n{{uploadLink}}\n{{signature}}',
};

const originalNodeEnv = process.env.NODE_ENV;
const originalFetch = global.fetch;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalFetch === undefined) delete global.fetch;
  else global.fetch = originalFetch;
  delete process.env.VERCEL_ENV;
});

test('rehearsal transport keeps preference, preview, and send entirely in memory', async () => {
  global.fetch = jest.fn();
  const request = createRehearsalTransport();
  const loaded = await request('/api/meeting-tracker/materials-email-preferences?kind=invitation');
  expect(loaded.data.template.body).toContain('{{checklist}}');
  expect(loaded.data.template.subject).toBe('W.M. Keck Foundation Research Presentation Materials Request');
  const preview = await request('/api/meeting-tracker/visits/sample/materials', { method: 'POST', body: { action: 'preview', sendAction: 'create', emailTemplate: invitation } });
  expect(preview.ok).toBe(true);
  expect(preview.data.bodyText).toContain('Sample institution');
  expect(preview.data.bodyText).not.toContain('{{institution}}');
  expect(preview.data.recipients).toEqual([{ name: 'Sample recipient', email: 'sample-recipient@example.invalid' }]);
  expect(preview.data.ccRecipients).toEqual([{ name: 'Sample liaison', email: 'sample-liaison@example.invalid' }]);
  await request('/api/meeting-tracker/materials-email-preferences', { method: 'PUT', body: { kind: 'invitation', template: invitation } });
  await request('/api/meeting-tracker/materials-email-preferences', { method: 'DELETE', body: { kind: 'invitation' } });
  const sent = await request('/api/meeting-tracker/visits/sample/materials', { method: 'POST', body: { action: 'create', emailTemplate: invitation, proof: 'rehearsal-proof-create' } });
  expect(sent.data).toMatchObject({ success: true, invitationSent: true });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('rehearsal transport enforces the real required placeholder and proof boundary', async () => {
  const request = createRehearsalTransport();
  const missing = await request('/api/meeting-tracker/visits/sample/materials', { method: 'POST', body: { action: 'preview', sendAction: 'create', emailTemplate: { subject: 'x', body: 'no checklist' } } });
  expect(missing.status).toBe(400);
  const unknown = await request('/api/meeting-tracker/visits/sample/materials', { method: 'POST', body: { action: 'preview', sendAction: 'create', emailTemplate: { subject: 'x', body: '{{checklist}} {{notARealToken}}' } } });
  expect(unknown.status).toBe(400);
  const stale = await request('/api/meeting-tracker/visits/sample/materials', { method: 'POST', body: { action: 'create', emailTemplate: invitation, proof: 'wrong-proof' } });
  expect(stale.status).toBe(409);
});

test('server guard allows local development and Preview, but not other deployments', async () => {
  process.env.NODE_ENV = 'test';
  process.env.VERCEL_ENV = 'production';
  expect(await getServerSideProps()).toEqual({ notFound: true });
  process.env.VERCEL_ENV = 'preview';
  expect(await getServerSideProps()).toEqual({ props: { rehearsalEnabled: true } });
});
