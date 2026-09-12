/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  buildLaunchPayload,
  default as CycleDossierPage,
  CycleDossierWorkspace,
  formatCostRange,
  groupedCandidates,
  isCurrentGeneration,
  parseBudgetUsd,
  retainSelection,
} from '../../pages/cycle-dossier';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <main>{children}</main>,
  Button: ({ children, loading, ...props }) => <button {...props}>{loading ? 'Loading…' : children}</button>,
  Card: ({ children }) => <section>{children}</section>,
  PageHeader: ({ title, subtitle }) => <header><h1>{title}</h1><p>{subtitle}</p></header>,
}));

jest.mock('../../shared/components/RequireAppAccess', () => ({ __esModule: true, default: ({ children }) => children }));
jest.mock('../../shared/components/RequireAuth', () => ({ __esModule: true, default: ({ children }) => children }));
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => ({ isSuperuser: true }) }));

const candidates = [
  { requestId: 'a', requestNumber: '102', title: 'Alpha', institution: 'North', pi: 'Dr A', programDirector: 'PD Two', latestRevision: { id: 'r1', revision: 1 } },
  { requestId: 'b', requestNumber: '101', title: 'Beta', institution: 'South', pi: 'Dr B', programDirector: 'PD One', latestRevision: null },
];

const dossierResponse = (selection = ['a', 'b'], extra = {}) => ({
  dossier: { id: 'd1', cycle: 'D26', selection, latestEditionId: null },
  candidates,
  runs: [],
  editions: [],
  configuration: { ready: true, estimatedPerEntryUsd: 1, prompts: [{ name: 'cycle-dossier.entry', version: 3, model: 'model-b' }] },
  control: { stopRequested: false, reason: null },
  ...extra,
});

function response(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe('cycle dossier page', () => {
  afterEach(() => jest.restoreAllMocks());

  it('parses only finite positive budget caps within the authorization limit', () => {
    expect(parseBudgetUsd('')).toBeNull();
    expect(parseBudgetUsd('12.50')).toBe(12.5);
    expect(() => parseBudgetUsd('NaN')).toThrow(/between \$0\.01 and \$10,000/);
    expect(() => parseBudgetUsd('0')).toThrow();
    expect(() => parseBudgetUsd('10001')).toThrow();
  });

  it('groups by program director and sorts requests within each group', () => {
    expect(groupedCandidates(candidates)).toEqual([
      ['PD One', [candidates[1]]],
      ['PD Two', [candidates[0]]],
    ]);
  });

  it('retains manual exclusions on a refreshed roster and rejects stale A-B-A generations', () => {
    expect([...retainSelection(['a'], ['a', 'b'], true)]).toEqual(['a']);
    expect([...retainSelection([], ['a', 'b'], true)]).toEqual([]);
    expect(isCurrentGeneration(3, 1)).toBe(false);
    expect(isCurrentGeneration(3, 3)).toBe(true);
  });

  it('builds the launch request from the reviewed preview and budget', () => {
    expect(buildLaunchPayload({
      previewId: 'preview-7',
      selectedIds: ['a'],
      generateIds: ['a'],
      budgetUsd: '12.50',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    })).toEqual({
      action: 'launch',
      previewId: 'preview-7',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      budgetUsd: 12.5,
    });
  });

  it('rounds the cost-range display to two decimals', () => {
    expect(formatCostRange({ lowUsd: 2.87775, highUsd: 14.38875 })).toBe('$2.88–$14.39');
    expect(formatCostRange({})).toBe('Unknown');
  });

  it('starts all returned candidates included and persists an exclusion', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(dossierResponse()));
    render(<CycleDossierWorkspace />);

    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByLabelText('Include request 102')).toBeChecked();
    expect(screen.getByLabelText('Include request 101')).toBeChecked();

    fireEvent.click(screen.getByLabelText('Include request 102'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/cycle-dossier', expect.objectContaining({ method: 'POST' })));
    const selectionCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(selectionCall[1].body)).toEqual({ action: 'selection', selectedRequestIds: ['b'] });
    expect(screen.getByText('1 of 2 included')).toBeInTheDocument();
  });

  it('serializes rapid selection writes while keeping the latest UI generation', async () => {
    let releaseFirst;
    const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
      if (init?.method !== 'POST') return Promise.resolve(response(dossierResponse()));
      const body = JSON.parse(init.body);
      if (body.action !== 'selection') return Promise.resolve(response({}));
      if (body.selectedRequestIds.length === 1) return firstWrite;
      return Promise.resolve(response(dossierResponse(body.selectedRequestIds)));
    });
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Include request 102'));
    fireEvent.click(screen.getByLabelText('Include request 101'));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length).toBe(1));
    expect(JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')[1].body).selectedRequestIds).toEqual(['b']);

    releaseFirst(response(dossierResponse(['b'])));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length).toBe(2));
    const selectionBodies = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body).selectedRequestIds);
    expect(selectionBodies).toEqual([['b'], []]);
  });

  it('selects the current roster only for an untouched null selection', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(dossierResponse(null)));
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByLabelText('Include request 102')).toBeChecked();
    expect(screen.getByLabelText('Include request 101')).toBeChecked();
  });

  it('loads the roster under React StrictMode after the effect is replayed', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(dossierResponse()));
    render(<React.StrictMode><CycleDossierWorkspace /></React.StrictMode>);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('2 of 2 included')).toBeInTheDocument());
  });

  it('allows a superuser through the direct page wrapper without app membership', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(dossierResponse()));
    render(<CycleDossierPage />);
    await waitFor(() => expect(screen.getByText('Cycle Dossier')).toBeInTheDocument());
    expect(screen.getByText('Superuser workspace')).toBeInTheDocument();
  });

  it('shows the durable processing control and confirms stop/resume actions', async () => {
    const confirmMock = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(dossierResponse(['a', 'b'], { control: { stopRequested: false, reason: null } })))
      .mockResolvedValueOnce(response({ control: { stopRequested: true, reason: 'Stopped by operator.' } }))
      .mockResolvedValueOnce(response(dossierResponse(['a', 'b'], { control: { stopRequested: true, reason: 'Stopped by operator.' } })))
      .mockResolvedValue(response(dossierResponse(['a', 'b'], { control: { stopRequested: true, reason: 'Stopped by operator.' } })));
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Processing control' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Stop all processing' }));
    await waitFor(() => expect(screen.getByText(/All dossier processing is stopped/)).toBeInTheDocument());
    expect(confirmMock).toHaveBeenCalledWith(expect.stringMatching(/Stop all/));
    const stopCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(stopCall[1].body)).toMatchObject({ action: 'operator-stop', stop: true });
    fireEvent.click(screen.getByRole('button', { name: 'Resume processing' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST' && JSON.parse(init.body).stop === false)).toBe(true));
    expect(confirmMock).toHaveBeenCalledWith(expect.stringMatching(/Resume/));
  });

  it('sends separate generate choices in the preview and uses the reviewed preview on launch', async () => {
    const preview = { id: 'preview-9', expiresAt: '2026-09-07T12:00:00Z', items: [{ requestId: 'b', status: 'queued' }], estimate: { lowUsd: 1, highUsd: 2, newCount: 1, reuseCount: 0 }, errors: [{ requestId: 'b', error: 'Source unavailable; publish as a gap.' }] };
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(dossierResponse(['b'])))
      .mockResolvedValueOnce(response({ preview }))
      .mockResolvedValueOnce(response({ run: { id: 'run-1', status: 'queued', items: [] } }))
      .mockResolvedValue(response(dossierResponse(['b'], { runs: [{ id: 'run-1', status: 'queued', items: [] }] })));
    render(<CycleDossierWorkspace />);

    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /generate new/i }));
    fireEvent.click(screen.getByRole('button', { name: /review cost & sources/i }));
    await waitFor(() => expect(screen.getByText('Preview ready')).toBeInTheDocument());
    expect(screen.getByText('cycle-dossier.entry')).toBeInTheDocument();

    const previewCall = fetchMock.mock.calls.find(([, init]) => {
      if (init?.method !== 'POST') return false;
      return JSON.parse(init.body).action === 'preview';
    });
    expect(JSON.parse(previewCall[1].body)).toMatchObject({ action: 'preview', selectedRequestIds: ['b'], generateRequestIds: ['b'] });

    fireEvent.change(screen.getByLabelText(/optional spending cap/i), { target: { value: '7.25' } });
    fireEvent.click(screen.getByRole('button', { name: /launch dossier run/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST' && JSON.parse(init.body).action === 'launch')).toBe(true));
    const launchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && JSON.parse(init.body).action === 'launch');
    expect(JSON.parse(launchCall[1].body)).toMatchObject({ action: 'launch', previewId: 'preview-9', budgetUsd: 7.25 });
    expect(JSON.parse(launchCall[1].body).idempotencyKey).toEqual(expect.any(String));
  });

  it('reuses the launch idempotency key when a response is lost and the user retries', async () => {
    const preview = { id: 'preview-retry', expiresAt: '2026-09-07T12:00:00Z', items: [{ requestId: 'b', status: 'queued' }], estimate: { lowUsd: 1, highUsd: 2, newCount: 1, reuseCount: 0 }, errors: [] };
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(dossierResponse(['b'])))
      .mockResolvedValueOnce(response({ preview }))
      .mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValueOnce(response({ run: { id: 'run-1', status: 'queued', items: [] } }))
      .mockResolvedValue(response(dossierResponse(['b'], { runs: [{ id: 'run-1', status: 'queued', items: [] }] })));
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /review cost & sources/i }));
    await waitFor(() => expect(screen.getByText('Preview ready')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /launch dossier run/i }));
    await waitFor(() => expect(screen.getAllByText('network lost').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /launch dossier run/i }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' && JSON.parse(init.body).action === 'launch').length).toBe(2));
    const launchBodies = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' && JSON.parse(init.body).action === 'launch').map(([, init]) => JSON.parse(init.body));
    expect(launchBodies[0].idempotencyKey).toBe(launchBodies[1].idempotencyKey);
  });

  it('rejects an invalid nonblank cap before launch and retry POSTs', async () => {
    const failedRun = { id: 'run-old', status: 'failed', items: [{ requestId: 'b', status: 'failed' }] };
    const preview = { id: 'preview-budget', expiresAt: '2026-09-07T12:00:00Z', items: [{ requestId: 'b', status: 'queued' }], estimate: { lowUsd: 1, highUsd: 2, newCount: 1, reuseCount: 0 }, errors: [] };
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(dossierResponse(['b'], { runs: [failedRun] })))
      .mockResolvedValueOnce(response({ preview }))
      .mockResolvedValue(response(dossierResponse(['b'], { runs: [failedRun] })));
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /review cost & sources/i }));
    await waitFor(() => expect(screen.getByText('Preview ready')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/optional spending cap/i), { target: { value: '10001' } });
    fireEvent.click(screen.getByRole('button', { name: /launch dossier run/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/between \$0\.01 and \$10,000/));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST' && JSON.parse(init.body).action === 'launch')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /progress & editions/i }));
    expect(screen.getByRole('button', { name: 'Retry failed entries' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed entries' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/between \$0\.01 and \$10,000/));
    expect(screen.getAllByTestId('cycle-dossier-inline-error')).toHaveLength(1);
    expect(screen.getByTestId('cycle-dossier-inline-error')).toHaveTextContent(/between \$0\.01 and \$10,000/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST' && JSON.parse(init.body).action === 'retry')).toBe(false);
  });

  it('shows the error inline under the Launch button in addition to the top banner', async () => {
    const preview = { id: 'preview-inline', expiresAt: '2026-09-07T12:00:00Z', items: [{ requestId: 'b', status: 'queued' }], estimate: { lowUsd: 1, highUsd: 2, newCount: 1, reuseCount: 0 }, errors: [] };
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(dossierResponse(['b'])))
      .mockResolvedValueOnce(response({ preview }))
      .mockRejectedValueOnce(new Error('launch rejected: 409'))
      .mockResolvedValue(response(dossierResponse(['b'])));
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /review cost & sources/i }));
    await waitFor(() => expect(screen.getByText('Preview ready')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /launch dossier run/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('launch rejected: 409'));
    expect(screen.getByTestId('cycle-dossier-inline-error')).toHaveTextContent('launch rejected: 409');
  });

  it('formats the Spent amount to two decimals and warns about editing files in Word Online', async () => {
    const runningRun = { id: 'run-1', status: 'running', spentUsd: 0.135, reservedUsd: 0, budgetUsd: null, items: [{ requestId: 'b', status: 'processing', stage: 'docx-saved' }] };
    jest.spyOn(global, 'fetch').mockResolvedValue(response(dossierResponse(['b'], { runs: [runningRun] })));
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByText('Run progress')).toBeInTheDocument());
    expect(screen.getByText(/Spent \$0\.14/)).toBeInTheDocument();
    expect(screen.getByTestId('cycle-dossier-word-online-note')).toBeInTheDocument();
  });

  it('defaults to the Progress tab on first load when the latest run is unsettled, but not when completed', async () => {
    const runningRun = { id: 'run-1', status: 'running', items: [] };
    jest.spyOn(global, 'fetch').mockResolvedValue(response(dossierResponse(['b'], { runs: [runningRun] })));
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Run progress' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Choose requests' })).not.toBeInTheDocument();
  });

  it('stays on the Choose requests tab on first load when the latest run is completed', async () => {
    const completedRun = { id: 'run-2', status: 'completed', items: [] };
    jest.spyOn(global, 'fetch').mockResolvedValue(response(dossierResponse(['b'], { runs: [completedRun] })));
    render(<CycleDossierWorkspace />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Choose requests' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Run progress' })).not.toBeInTheDocument();
  });
});
