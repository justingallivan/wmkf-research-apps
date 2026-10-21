/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModelConfigSection from '../../shared/components/admin/ModelConfigSection';

const response = (status, data) => ({ ok: status < 300, status, json: async () => data });
const info = (dbOverride = null) => ({ hardcoded: 'old', stored: dbOverride || 'old', dbOverride });
const config = {
  apps: [{ appKey: 'sample:app', models: { model: info('old'), visionModel: info(), fallback: info() } }],
  availableModels: [{ id: 'old', display_name: 'Old' }, { id: 'new', display_name: 'New' }],
  tiers: [], defaultModel: 'old',
};
const puts = () => global.fetch.mock.calls.filter(([, init]) => init?.method === 'PUT');
const gets = () => global.fetch.mock.calls.filter(([, init]) => init?.method !== 'PUT');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

test('initial overrides and Discard use the same server values without writes', async () => {
  global.fetch = jest.fn(async () => response(200, config));
  render(<ModelConfigSection />);
  const selects = await screen.findAllByRole('combobox');
  expect(selects.map(s => s.value)).toEqual(['old', '', '']);
  expect(screen.getByRole('button', { name: 'No Changes' })).toBeDisabled();
  fireEvent.change(selects[0], { target: { value: '' } });
  fireEvent.change(selects[2], { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(selects.map(s => s.value)).toEqual(['old', '', '']);
  expect(screen.getByRole('button', { name: 'No Changes' })).toBeDisabled();
  expect(screen.queryByText(/unsaved change\(s\)/)).not.toBeInTheDocument();
  expect(puts()).toHaveLength(0);
  expect(gets()).toHaveLength(1);
});

test('clearing an override sends null and reloads after success', async () => {
  const refreshed = { ...config, apps: [{ ...config.apps[0], models: { ...config.apps[0].models, model: info() } }] };
  global.fetch = jest.fn(async (url, init) => response(200, init?.method === 'PUT' ? {} : puts().length ? refreshed : config));
  render(<ModelConfigSection />);
  const selects = await screen.findAllByRole('combobox');
  fireEvent.change(selects[0], { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await screen.findByText('Saved 1 model override(s)');
  expect(puts()).toHaveLength(1);
  expect(JSON.parse(puts()[0][1].body)).toEqual({ appKey: 'sample:app', modelType: 'model', modelId: null });
  expect(gets()).toHaveLength(2);
  expect((await screen.findAllByRole('combobox'))[0]).toHaveValue('');
  expect(screen.getByRole('button', { name: 'No Changes' })).toBeDisabled();
});

test('save follows server-key order, waits per request, and stops after a partial failure', async () => {
  let resolveFirst;
  global.fetch = jest.fn((url, init) => {
    if (init?.method !== 'PUT') return Promise.resolve(response(200, config));
    if (puts().length === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return Promise.resolve(response(500, { error: 'Second write failed' }));
  });
  render(<ModelConfigSection />);
  const selects = await screen.findAllByRole('combobox');
  // Edit the new override first: save order must still put existing server keys first.
  for (const i of [2, 1, 0]) fireEvent.change(selects[i], { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(puts()[0][1].body)).toEqual({ appKey: 'sample:app', modelType: 'model', modelId: 'new' });
  await act(async () => { resolveFirst(response(200, {})); });
  await screen.findByText('Second write failed');
  expect(puts().map(([, init]) => JSON.parse(init.body))).toEqual([
    { appKey: 'sample:app', modelType: 'model', modelId: 'new' },
    { appKey: 'sample:app', modelType: 'fallback', modelId: 'new' },
  ]);
  expect(gets()).toHaveLength(1);
  expect(selects.map(s => s.value)).toEqual(['new', 'new', 'new']);
  expect(screen.getByText('3 unsaved change(s). Changed dropdowns are highlighted.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
});
