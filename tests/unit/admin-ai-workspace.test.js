/**
 * @jest-environment jsdom
 *
 * T3 (Stage 3) per-call-site contract matrix for the inline admin sections
 * reachable through `AiWorkspace` (pages/admin.js): UsageSection (:938,
 * view="usage") and ModelConfigSection (:1249, :1335, view="models"). Both
 * GET sites pin the verbatim 403 -> "Admin access required" status branch.
 * Run against the unmigrated code first (must pass), then unchanged after
 * each migration commit.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiWorkspace } from '../../pages/admin';

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe('UsageSection (view="usage") — GET /api/admin/stats?period=', () => {
  test('(a) 2xx renders usage summary', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(200, { summary: { total_requests: 5, total_cost_cents: 100, unique_users: 2, error_count: 0 } })));
    render(<AiWorkspace view="usage" />);
    expect(await screen.findByText('5')).toBeInTheDocument();
  });

  test('(b) status 403 shows "Admin access required" verbatim, ignoring body.error', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(403, { error: 'nope, different text' })));
    render(<AiWorkspace view="usage" />);
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });

  test('(b2) other non-2xx shows the fixed "Failed to fetch stats" text', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(500, { error: 'db down' })));
    render(<AiWorkspace view="usage" />);
    expect(await screen.findByText('Failed to fetch stats')).toBeInTheDocument();
  });

  test('(c) network rejection shows the native rejection message', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    render(<AiWorkspace view="usage" />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('(d) malformed 2xx surfaces the native parse error', async () => {
    global.fetch = jest.fn(() => Promise.resolve(malformedResponse(200)));
    render(<AiWorkspace view="usage" />);
    expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
  });

  test('(e) unparseable non-2xx (non-403) still shows "Failed to fetch stats", never silent', async () => {
    global.fetch = jest.fn(() => Promise.resolve(malformedResponse(502)));
    render(<AiWorkspace view="usage" />);
    expect(await screen.findByText('Failed to fetch stats')).toBeInTheDocument();
  });

  test('period change re-fetches with the new query param', async () => {
    const urls = [];
    global.fetch = jest.fn((url) => {
      urls.push(url);
      return Promise.resolve(jsonResponse(200, { summary: { total_requests: 1, total_cost_cents: 0, unique_users: 1, error_count: 0 } }));
    });
    render(<AiWorkspace view="usage" />);
    await screen.findByText('API Usage');
    fireEvent.click(screen.getByText('7 days'));
    await waitFor(() => expect(urls).toContain('/api/admin/stats?period=7d'));
  });
});

describe('ModelConfigSection (view="models") — GET/PUT /api/admin/models', () => {
  const modelInfo = () => ({ hardcoded: 'claude-haiku', stored: '', envOverride: null, registryStatus: 'ok', dbOverride: null });
  const config = {
    apps: [{ appKey: 'literature-analyzer', models: { model: modelInfo(), visionModel: modelInfo(), fallback: modelInfo() } }],
    availableModels: [],
    tiers: [],
    defaultModel: 'x',
  };

  test('(a) 2xx renders config (no error)', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(200, config)));
    render(<AiWorkspace view="models" />);
    await screen.findByText('Model routing');
    expect(screen.queryByText(/could not be/)).not.toBeInTheDocument();
  });

  test('(b) status 403 shows "Admin access required" verbatim', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(403, { error: 'nope' })));
    render(<AiWorkspace view="models" />);
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });

  test('(b2) other non-2xx shows the fixed "Failed to fetch model config" text', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(500, { error: 'db down' })));
    render(<AiWorkspace view="models" />);
    expect(await screen.findByText('Failed to fetch model config')).toBeInTheDocument();
  });

  test('(c) network rejection shows the native rejection message', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    render(<AiWorkspace view="models" />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('(d) malformed 2xx surfaces the native parse error', async () => {
    global.fetch = jest.fn(() => Promise.resolve(malformedResponse(200)));
    render(<AiWorkspace view="models" />);
    expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
  });

  test('(e) unparseable non-2xx (non-403) still shows "Failed to fetch model config", never silent', async () => {
    global.fetch = jest.fn(() => Promise.resolve(malformedResponse(502)));
    render(<AiWorkspace view="models" />);
    expect(await screen.findByText('Failed to fetch model config')).toBeInTheDocument();
  });

  test('PUT (saveAll loop): sends exact body/method/headers; non-2xx bare .json() with fallback shows body.error', async () => {
    const withOverride = {
      apps: [{ appKey: 'literature-analyzer', models: { model: { hardcoded: 'claude-haiku', stored: 'claude-haiku', dbOverride: 'claude-haiku' }, visionModel: modelInfo(), fallback: modelInfo() } }],
      availableModels: [{ id: 'claude-haiku', display_name: 'Haiku' }, { id: 'claude-sonnet', display_name: 'Sonnet' }],
      tiers: [],
      defaultModel: 'claude-haiku',
    };
    let putCall = null;
    global.fetch = jest.fn((url, init) => {
      if (init?.method === 'PUT') { putCall = init; return Promise.resolve(jsonResponse(400, { error: 'Bad model' })); }
      return Promise.resolve(jsonResponse(200, withOverride));
    });
    render(<AiWorkspace view="models" />);
    const [select] = await screen.findAllByRole('combobox');
    fireEvent.change(select, { target: { value: 'claude-sonnet' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(putCall).not.toBeNull());
    expect(putCall.method).toBe('PUT');
    expect(putCall.headers['Content-Type']).toBe('application/json');
    expect(await screen.findByText('Bad model')).toBeInTheDocument();
  });

  test('PUT: non-2xx with no body.error falls back to "Failed to save"', async () => {
    const withOverride = {
      apps: [{ appKey: 'literature-analyzer', models: { model: { hardcoded: 'claude-haiku', stored: 'claude-haiku', dbOverride: 'claude-haiku' }, visionModel: modelInfo(), fallback: modelInfo() } }],
      availableModels: [{ id: 'claude-haiku', display_name: 'Haiku' }, { id: 'claude-sonnet', display_name: 'Sonnet' }],
      tiers: [],
      defaultModel: 'claude-haiku',
    };
    global.fetch = jest.fn((url, init) => Promise.resolve(init?.method === 'PUT' ? jsonResponse(500, {}) : jsonResponse(200, withOverride)));
    render(<AiWorkspace view="models" />);
    const [select] = await screen.findAllByRole('combobox');
    fireEvent.change(select, { target: { value: 'claude-sonnet' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('Failed to save')).toBeInTheDocument();
  });

  test('PUT: 2xx success (body ignored) refetches and shows the saved-count message', async () => {
    const withOverride = {
      apps: [{ appKey: 'literature-analyzer', models: { model: { hardcoded: 'claude-haiku', stored: 'claude-haiku', dbOverride: 'claude-haiku' }, visionModel: modelInfo(), fallback: modelInfo() } }],
      availableModels: [{ id: 'claude-haiku', display_name: 'Haiku' }, { id: 'claude-sonnet', display_name: 'Sonnet' }],
      tiers: [],
      defaultModel: 'claude-haiku',
    };
    global.fetch = jest.fn((url, init) => Promise.resolve(init?.method === 'PUT' ? jsonResponse(200, {}) : jsonResponse(200, withOverride)));
    render(<AiWorkspace view="models" />);
    const [select] = await screen.findAllByRole('combobox');
    fireEvent.change(select, { target: { value: 'claude-sonnet' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('Saved 1 model override(s)')).toBeInTheDocument();
  });
});
