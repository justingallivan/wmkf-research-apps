/**
 * email-template-store — T4 client-request-layer matrix (Stage 4). Pins
 * request bytes and best-effort swallow behavior for the file's 3 fetch
 * sites ahead of migrating onto shared/utils/api-request.js:
 *   - loadAdminTemplateDefaults  GET  /api/email-defaults/reviewer-templates
 *     (best-effort: any failure -> blank skeleton, never throws)
 *   - loadEmailTemplates         GET  /api/user-preferences?key=...
 *     (unguarded: reads data.value regardless of HTTP status — preserved)
 *   - saveEmailTemplates         POST /api/user-preferences
 *     (best-effort: any failure -> false, never throws)
 */
const {
  loadAdminTemplateDefaults,
  loadEmailTemplates,
  saveEmailTemplates,
  EMPTY_TEMPLATES,
} = require('../../shared/components/reviewers/email-template-store');
const { PREFERENCE_KEYS } = require('../../shared/config/reviewerFinderPreferences');

afterEach(() => { jest.restoreAllMocks(); global.fetch = jest.fn(); });

test('loadAdminTemplateDefaults: GET has no body; 2xx + {templates} shapes the result', async () => {
  global.fetch = jest.fn((url, opts) => {
    expect(url).toBe('/api/email-defaults/reviewer-templates');
    expect(opts?.body).toBeUndefined();
    expect(opts?.method === undefined || opts?.method === 'GET').toBe(true);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ templates: { invitation: { subject: 'S', body: 'B' } } }) });
  });
  const out = await loadAdminTemplateDefaults();
  expect(out.invitation).toEqual({ subject: 'S', body: 'B' });
});

test('loadAdminTemplateDefaults: non-2xx unparseable body degrades to the blank skeleton, never throws', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad'); } }));
  const out = await loadAdminTemplateDefaults();
  expect(out).toEqual(EMPTY_TEMPLATES);
});

test('loadAdminTemplateDefaults: network rejection degrades to the blank skeleton, never throws', async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('down')));
  const out = await loadAdminTemplateDefaults();
  expect(out).toEqual(EMPTY_TEMPLATES);
});

test('loadEmailTemplates: user-preferences GET url is exact; a non-2xx body is still read for .value (preserved, unguarded)', async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes('email-defaults')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ templates: {} }) });
    expect(url).toBe(`/api/user-preferences?key=${encodeURIComponent(PREFERENCE_KEYS.EMAIL_TEMPLATES)}`);
    return Promise.resolve({
      ok: false,
      status: 500,
      json: async () => ({ value: JSON.stringify({ invitation: { subject: 'Override' } }) }),
    });
  });
  const out = await loadEmailTemplates();
  expect(out.invitation.subject).toBe('Override');
});

test('loadEmailTemplates: network rejection on the preferences GET degrades to admin defaults, never throws', async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes('email-defaults')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ templates: { invitation: { subject: 'Admin', body: 'B' } } }) });
    return Promise.reject(new Error('down'));
  });
  const out = await loadEmailTemplates();
  expect(out.invitation.subject).toBe('Admin');
});

test('saveEmailTemplates: POST sends exact body bytes/headers and returns true on 2xx', async () => {
  let sentOpts = null;
  global.fetch = jest.fn((url, opts) => {
    if (url.includes('email-defaults')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ templates: {} }) });
    sentOpts = opts;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  });
  const ok = await saveEmailTemplates({
    invitation: { subject: 'Hello, {{piName}}', body: 'Please respond by {{respondBy}}. {{externalLink}}' },
    materials: { subject: '', body: '' },
    followup: { subject: '', body: '' },
    thankyou: { subject: '', body: '' },
  });
  expect(ok).toBe(true);
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toEqual({
    key: PREFERENCE_KEYS.EMAIL_TEMPLATES,
    value: JSON.stringify({ invitation: { subject: 'Hello, {{piName}}', body: 'Please respond by {{respondBy}}. {{externalLink}}' } }),
  });
});

test('saveEmailTemplates: non-2xx (any body) returns false, never throws', async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes('email-defaults')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ templates: {} }) });
    return Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad'); } });
  });
  const ok = await saveEmailTemplates({
    invitation: { subject: 'Hello, {{piName}}', body: 'Please respond by {{respondBy}}. {{externalLink}}' },
    materials: { subject: '', body: '' },
    followup: { subject: '', body: '' },
    thankyou: { subject: '', body: '' },
  });
  expect(ok).toBe(false);
});

test('saveEmailTemplates: network rejection returns false, never throws', async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes('email-defaults')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ templates: {} }) });
    return Promise.reject(new Error('down'));
  });
  const ok = await saveEmailTemplates({
    invitation: { subject: 'Hello, {{piName}}', body: 'Please respond by {{respondBy}}. {{externalLink}}' },
    materials: { subject: '', body: '' },
    followup: { subject: '', body: '' },
    thankyou: { subject: '', body: '' },
  });
  expect(ok).toBe(false);
});
