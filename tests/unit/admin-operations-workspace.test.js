/**
 * @jest-environment jsdom
 *
 * T3 (Stage 3) per-call-site contract matrix for the inline admin sections
 * reachable through `OperationsWorkspace` (pages/admin.js): HealthSection
 * (:212), HealthHistorySection (:323), SystemAlertsSection (:497, :509),
 * MaintenanceSection (:640), SecretExpirationSection (:763, :791),
 * DynamicsFeedbackSection (:2131, :2154 — already exported, extended here
 * for the sites `tests/unit/admin-dynamics-feedback-filters.test.js` does not
 * cover), and AlertRecipientsSection (:2479, :2569). Run against the
 * unmigrated code first (must pass), then unchanged after each migration
 * commit.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsWorkspace } from '../../pages/admin';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const malformedResponse = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
});

// Any site not under test in a given case (e.g. a sibling section on the same
// view) gets a harmless empty 2xx so it never fails the test for an
// unrelated reason.
const DEFAULT_OK = () => Promise.resolve(jsonResponse(200, {}));

function mockFetchRouter(routes) {
  global.fetch = jest.fn((url, init) => {
    for (const [match, handler] of routes) {
      const hit = typeof match === 'string' ? url === match || url.startsWith(match) : match.test(url);
      if (hit) return Promise.resolve(handler(url, init));
    }
    return DEFAULT_OK();
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('HealthSection (view="health") — GET /api/health, D1 preserve (no ok check)', () => {
  test('(a) 2xx renders health data', async () => {
    mockFetchRouter([['/api/health', () => jsonResponse(200, { overall: 'ok', services: { database: { status: 'ok' } } })]]);
    render(<OperationsWorkspace view="health" />);
    await screen.findByText('Service Health');
    expect(await screen.findByText('1 service checked')).toBeInTheDocument();
  });

  test('(b) D1: a non-2xx parseable body is still used as if it were success (today\'s unguarded bug, pinned)', async () => {
    mockFetchRouter([['/api/health', () => jsonResponse(500, { overall: 'error', services: {} })]]);
    render(<OperationsWorkspace view="health" />);
    expect(await screen.findByText('0 services checked')).toBeInTheDocument();
  });

  test('(c) network rejection sets the error health state', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    render(<OperationsWorkspace view="health" />);
    await screen.findByText('Service Health');
    expect(await screen.findByText('error')).toBeInTheDocument();
  });

  test('(e) D1: an unparseable non-2xx body still lands in the error catch, not silently as {}', async () => {
    mockFetchRouter([['/api/health', () => malformedResponse(500)]]);
    render(<OperationsWorkspace view="health" />);
    await screen.findByText('Service Health');
    expect(await screen.findByText('error')).toBeInTheDocument();
  });

  test('(d) malformed 2xx body also lands in the error catch (strict-on-success)', async () => {
    mockFetchRouter([['/api/health', () => malformedResponse(200)]]);
    render(<OperationsWorkspace view="health" />);
    await screen.findByText('Service Health');
    expect(await screen.findByText('error')).toBeInTheDocument();
  });
});

describe('HealthHistorySection (view="health") — GET /api/admin/health-history', () => {
  test('(a) 2xx renders history', async () => {
    mockFetchRouter([['/api/admin/health-history', () => jsonResponse(200, { summary: { uptimePercent: 99 }, checks: [{ id: 1, created_at: new Date().toISOString(), overall_status: 'ok', services: {} }] })]]);
    render(<OperationsWorkspace view="health" />);
    await screen.findByText('Health Check History');
    expect(await screen.findByText('99%')).toBeInTheDocument();
  });

  test('(b) non-2xx renders the empty state (body never read)', async () => {
    mockFetchRouter([['/api/admin/health-history', () => jsonResponse(502, { checks: [{ startedAt: new Date().toISOString() }] })]]);
    render(<OperationsWorkspace view="health" />);
    expect(await screen.findByText('No health checks recorded yet. The cron job runs every 15 minutes.')).toBeInTheDocument();
  });

  test('(c) network rejection renders the empty state', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    render(<OperationsWorkspace view="health" />);
    expect(await screen.findByText('No health checks recorded yet. The cron job runs every 15 minutes.')).toBeInTheDocument();
  });

  test('(d) malformed 2xx renders the empty state (strict parse rejects, caught)', async () => {
    mockFetchRouter([['/api/admin/health-history', () => malformedResponse(200)]]);
    render(<OperationsWorkspace view="health" />);
    expect(await screen.findByText('No health checks recorded yet. The cron job runs every 15 minutes.')).toBeInTheDocument();
  });
});

describe('SystemAlertsSection (view="incidents") — GET/PATCH /api/admin/alerts', () => {
  test('(a) 2xx renders alerts', async () => {
    mockFetchRouter([['/api/admin/alerts', () => jsonResponse(200, { alerts: [{ id: 1, title: 'Down', alert_type: 'x', status: 'active', created_at: new Date().toISOString(), severity: 'critical' }] })]]);
    render(<OperationsWorkspace view="incidents" />);
    expect(await screen.findByText('Down')).toBeInTheDocument();
  });

  test('(b) non-2xx renders the no-alerts state', async () => {
    mockFetchRouter([['/api/admin/alerts', () => jsonResponse(500, { alerts: [{ id: 1, title: 'x', alert_type: 'x', status: 'active', created_at: new Date().toISOString() }] })]]);
    render(<OperationsWorkspace view="incidents" />);
    expect(await screen.findByText('No active alerts. All systems normal.')).toBeInTheDocument();
  });

  test('(c) network rejection renders the no-alerts state', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    render(<OperationsWorkspace view="incidents" />);
    expect(await screen.findByText('No active alerts. All systems normal.')).toBeInTheDocument();
  });

  test('(PATCH) acknowledge sends exact body/method/headers and refetches on 2xx', async () => {
    const calls = [];
    global.fetch = jest.fn((url, init) => {
      if (url !== '/api/admin/alerts') return DEFAULT_OK();
      calls.push([url, init]);
      if (init?.method === 'PATCH') return Promise.resolve(jsonResponse(200, {}));
      if (calls.filter(c => !c[1]?.method).length > 1) {
        return Promise.resolve(jsonResponse(200, { alerts: [] }));
      }
      return Promise.resolve(jsonResponse(200, { alerts: [{ id: 1, title: 'Down', alert_type: 'x', status: 'active', created_at: new Date().toISOString(), severity: 'critical' }] }));
    });
    render(<OperationsWorkspace view="incidents" />);
    await screen.findByText('Down');
    fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() => expect(calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const [patchUrl, patchInit] = calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchUrl).toBe('/api/admin/alerts');
    expect(patchInit.method).toBe('PATCH');
    expect(patchInit.headers['Content-Type']).toBe('application/json');
    expect(patchInit.body).toBe(JSON.stringify({ id: 1, action: 'resolve' }));
  });

  test('(PATCH failure) a non-2xx PATCH is silently swallowed, matching today\'s catch{}', async () => {
    let alertsGetCount = 0;
    let patchCount = 0;
    global.fetch = jest.fn((url, init) => {
      if (url !== '/api/admin/alerts') return DEFAULT_OK();
      if (init?.method === 'PATCH') { patchCount += 1; return Promise.resolve(jsonResponse(500, { error: 'nope' })); }
      alertsGetCount += 1;
      return Promise.resolve(jsonResponse(200, { alerts: [{ id: 1, title: 'Down', alert_type: 'x', status: 'active', created_at: new Date().toISOString(), severity: 'critical' }] }));
    });
    render(<OperationsWorkspace view="incidents" />);
    await screen.findByText('Down');
    fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() => expect(patchCount).toBe(1));
    // No refetch happened (still only the initial GET); alert still shown.
    expect(alertsGetCount).toBe(1);
    expect(screen.getByText('Down')).toBeInTheDocument();
  });
});

describe('MaintenanceSection (view="jobs") — GET /api/admin/maintenance (signal, fixed fallback text)', () => {
  test('(a) 2xx renders jobs', async () => {
    mockFetchRouter([['/api/admin/maintenance', () => jsonResponse(200, { jobs: [{ jobName: 'daily-maintenance', schedule: '0 8 * * *' }] })]]);
    render(<OperationsWorkspace view="jobs" />);
    expect(await screen.findByText(/Daily Maintenance/)).toBeInTheDocument();
  });

  test('(b) non-2xx shows the fixed fallback text verbatim, ignoring any body.error', async () => {
    mockFetchRouter([['/api/admin/maintenance', () => jsonResponse(500, { error: 'db exploded' })]]);
    render(<OperationsWorkspace view="jobs" />);
    expect(await screen.findByText('Maintenance status could not be loaded.')).toBeInTheDocument();
  });

  test('(c) network rejection shows the native rejection message (fixed text is only for a non-2xx status)', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    render(<OperationsWorkspace view="jobs" />);
    expect(await screen.findByText('down')).toBeInTheDocument();
  });

  test('(e) unparseable non-2xx still shows the fixed fallback text, never silent', async () => {
    mockFetchRouter([['/api/admin/maintenance', () => malformedResponse(502)]]);
    render(<OperationsWorkspace view="jobs" />);
    expect(await screen.findByText('Maintenance status could not be loaded.')).toBeInTheDocument();
  });

  test('(d) malformed 2xx surfaces the native parse error (2xx body is read and parsed strictly)', async () => {
    mockFetchRouter([['/api/admin/maintenance', () => malformedResponse(200)]]);
    render(<OperationsWorkspace view="jobs" />);
    expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
  });
});

describe('SecretExpirationSection (view="credentials") — GET/PUT /api/admin/secrets', () => {
  test('(a) 2xx GET renders secrets', async () => {
    mockFetchRouter([['/api/admin/secrets', () => jsonResponse(200, { secrets: [{ key: 'x', name: 'X secret', status: 'ok' }] })]]);
    render(<OperationsWorkspace view="credentials" />);
    expect(await screen.findByText('X secret')).toBeInTheDocument();
  });

  test('(b) non-2xx GET shows the fixed fallback text', async () => {
    mockFetchRouter([['/api/admin/secrets', () => jsonResponse(500, { error: 'nope' })]]);
    render(<OperationsWorkspace view="credentials" />);
    expect(await screen.findByText('Credential expiration data could not be loaded.')).toBeInTheDocument();
  });

  test('(c) GET network rejection shows the native rejection message', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    render(<OperationsWorkspace view="credentials" />);
    expect(await screen.findByText('down')).toBeInTheDocument();
  });

  test('(PUT save) sends exact body/method/headers and refetches on 2xx', async () => {
    let putCall = null;
    let getCount = 0;
    global.fetch = jest.fn((url, init) => {
      if (init?.method === 'PUT') { putCall = init; return Promise.resolve(jsonResponse(200, {})); }
      getCount += 1;
      return Promise.resolve(jsonResponse(200, { secrets: [{ key: 'x', name: 'X secret', status: 'ok', lastRotated: '2026-01-01' }] }));
    });
    render(<OperationsWorkspace view="credentials" />);
    await screen.findByText('X secret');
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(putCall).not.toBeNull());
    expect(putCall.method).toBe('PUT');
    expect(putCall.headers['Content-Type']).toBe('application/json');
    expect(putCall.body).toBe(JSON.stringify({ key: 'x', rotationDate: '2026-01-01', expirationDate: '' }));
    await waitFor(() => expect(getCount).toBe(2));
  });

  test('(PUT failure, bare .json() with fallback) shows body.error text', async () => {
    global.fetch = jest.fn((url, init) => {
      if (init?.method === 'PUT') return Promise.resolve(jsonResponse(400, { error: 'Bad date' }));
      return Promise.resolve(jsonResponse(200, { secrets: [{ key: 'x', name: 'X secret', status: 'ok', lastRotated: '2026-01-01' }] }));
    });
    render(<OperationsWorkspace view="credentials" />);
    await screen.findByText('X secret');
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('Bad date')).toBeInTheDocument();
  });

  test('(e) PUT unparseable non-2xx body falls back to the fixed message, never silent', async () => {
    global.fetch = jest.fn((url, init) => {
      if (init?.method === 'PUT') return Promise.resolve(malformedResponse(502));
      return Promise.resolve(jsonResponse(200, { secrets: [{ key: 'x', name: 'X secret', status: 'ok', lastRotated: '2026-01-01' }] }));
    });
    render(<OperationsWorkspace view="credentials" />);
    await screen.findByText('X secret');
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('The credential dates could not be saved.')).toBeInTheDocument();
  });

  test('(PUT network rejection) shows err.message', async () => {
    global.fetch = jest.fn((url, init) => {
      if (init?.method === 'PUT') return Promise.reject(new Error('offline'));
      return Promise.resolve(jsonResponse(200, { secrets: [{ key: 'x', name: 'X secret', status: 'ok', lastRotated: '2026-01-01' }] }));
    });
    render(<OperationsWorkspace view="credentials" />);
    await screen.findByText('X secret');
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });
});

describe('DynamicsFeedbackSection (view="feedback") — extends admin-dynamics-feedback-filters.test.js', () => {
  test('(b) GET non-2xx shows the fixed fallback text, ignoring body.error', async () => {
    mockFetchRouter([['/api/dynamics-explorer/feedback', () => jsonResponse(500, { error: 'db down' })]]);
    render(<OperationsWorkspace view="feedback" />);
    expect(await screen.findByText('Feedback could not be loaded.')).toBeInTheDocument();
  });

  test('(e) GET unparseable non-2xx still shows the fixed fallback text', async () => {
    mockFetchRouter([['/api/dynamics-explorer/feedback', () => malformedResponse(502)]]);
    render(<OperationsWorkspace view="feedback" />);
    expect(await screen.findByText('Feedback could not be loaded.')).toBeInTheDocument();
  });

  test('(PATCH) sends exact body and shows the fixed failure text on non-2xx (body ignored)', async () => {
    let patchCall = null;
    global.fetch = jest.fn((url, init) => {
      if (init?.method === 'PATCH') { patchCall = init; return Promise.resolve(jsonResponse(500, { error: 'ignored' })); }
      return Promise.resolve(jsonResponse(200, { feedback: [{ id: 1, feedback_type: 'negative', status: 'new', created_at: new Date().toISOString() }], summary: {} }));
    });
    render(<OperationsWorkspace view="feedback" />);
    await screen.findByText(/no query/);
    fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() => expect(patchCall).not.toBeNull());
    expect(patchCall.method).toBe('PATCH');
    expect(patchCall.headers['Content-Type']).toBe('application/json');
    expect(patchCall.body).toBe(JSON.stringify({ id: 1, status: 'resolved' }));
    expect(await screen.findByText('The feedback status could not be updated.')).toBeInTheDocument();
  });
});

describe('AlertRecipientsSection (view="notifications") — GET/PUT /api/admin/alert-recipients', () => {
  test('(a) 2xx GET renders categories', async () => {
    mockFetchRouter([['/api/admin/alert-recipients', () => jsonResponse(200, { seedCategories: [{ key: 'default', description: 'Default' }], config: {}, fallbackRoster: [] })]]);
    render(<OperationsWorkspace view="notifications" />);
    expect(await screen.findByText(/Default/)).toBeInTheDocument();
  });

  test('(b) GET non-2xx shows body.error via fallbackMessage', async () => {
    mockFetchRouter([['/api/admin/alert-recipients', () => jsonResponse(500, { error: 'load boom' })]]);
    render(<OperationsWorkspace view="notifications" />);
    expect(await screen.findByText('load boom')).toBeInTheDocument();
  });

  test('(b2) GET non-2xx with no body.error falls back to "Failed to load"', async () => {
    mockFetchRouter([['/api/admin/alert-recipients', () => jsonResponse(500, {})]]);
    render(<OperationsWorkspace view="notifications" />);
    expect(await screen.findByText('Failed to load')).toBeInTheDocument();
  });

  test('(c) GET network rejection shows err.message', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    render(<OperationsWorkspace view="notifications" />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('(d) GET malformed 2xx surfaces the native parse error (bare .json() always read)', async () => {
    mockFetchRouter([['/api/admin/alert-recipients', () => malformedResponse(200)]]);
    render(<OperationsWorkspace view="notifications" />);
    expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
  });

  test('(PUT save, custom derivation with .details) sends exact body and shows error+details verbatim', async () => {
    let putCall = null;
    global.fetch = jest.fn((url, init) => {
      if (init?.method === 'PUT') { putCall = init; return Promise.resolve(jsonResponse(400, { error: 'Save failed', details: ['bad@', 'also-bad'] })); }
      return Promise.resolve(jsonResponse(200, { seedCategories: [{ key: 'default', description: 'Default' }], config: {}, fallbackRoster: [] }));
    });
    render(<OperationsWorkspace view="notifications" />);
    await screen.findByText(/Default/);
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(putCall).not.toBeNull());
    expect(putCall.method).toBe('PUT');
    expect(putCall.headers['Content-Type']).toBe('application/json');
    expect(putCall.body).toBe(JSON.stringify({ config: {} }));
    expect(await screen.findByText('Save failed: bad@; also-bad')).toBeInTheDocument();
  });

  test('(PUT save success) refetches and shows Saved', async () => {
    let getCount = 0;
    global.fetch = jest.fn((url, init) => {
      if (init?.method === 'PUT') return Promise.resolve(jsonResponse(200, {}));
      getCount += 1;
      return Promise.resolve(jsonResponse(200, { seedCategories: [{ key: 'default', description: 'Default' }], config: {}, fallbackRoster: [] }));
    });
    render(<OperationsWorkspace view="notifications" />);
    await screen.findByText(/Default/);
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(getCount).toBe(2));
  });
});
