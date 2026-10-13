/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PromptTemplatesSection from '../../shared/components/admin/PromptTemplatesSection';

jest.mock('../../shared/components/admin/DataverseFieldInfoButton', () => function FieldInfo() {
  return <span data-testid="field-info" />;
});

const PROMPT = {
  id: 'prompt-1',
  name: 'scratch.max-tokens-test',
  version: 5,
  hasCurrent: true,
  body: 'Hello there.',
  systemPrompt: '',
  outputSchema: '',
  model: 'claude-sonnet-4-5', // reviewed ceiling 64,000 in the catalog below
  maxTokens: 16384,
};

const response = (body, ok = true, status = 200) => ({ ok, status, json: jest.fn(async () => body) });

function modelsPayload() {
  return {
    defaultModel: 'sonnet',
    defaultModelResolved: 'claude-sonnet-5-5',
    tiers: [{ key: 'haiku', resolvedId: 'claude-haiku-5-5' }],
    availableModels: [
      { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
    ],
    modelStatuses: {
      'claude-sonnet-4-5': { ok: true, capability: { maxOutputTokens: 64000 } },
      'claude-sonnet-5-5': { ok: true, capability: { maxOutputTokens: 128000 } },
      'claude-haiku-5-5': { ok: true, capability: { maxOutputTokens: 128000 } },
    },
  };
}

let putBodies;
beforeEach(() => {
  putBodies = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/admin/prompts') return response({ prompts: [PROMPT] });
    if (url === '/api/admin/models') return response(modelsPayload());
    if (url === '/api/admin/executor-budgets') return response({ schemaVersion: 1, version: 0, budgets: {}, limits: {}, descriptions: {}, storageWarnings: [] });
    if (url === `/api/admin/prompts/${encodeURIComponent(PROMPT.name)}` && options.method === 'PUT') {
      putBodies.push(JSON.parse(options.body));
      return response({ status: 'completed', newPromptId: 'n', targetVersion: 6 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
});

async function openEditor() {
  render(<PromptTemplatesSection />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit & publish' }));
  return screen.findByLabelText(/Max output tokens/);
}

const publishButton = () => screen.getByRole('button', { name: /^Publish v6$/ });

test('renders an editable number input prefilled from the stored row, with the model ceiling hint', async () => {
  const input = await openEditor();
  expect(input).toHaveAttribute('type', 'number');
  expect(input).not.toBeDisabled();
  expect(input).toHaveValue(16384);
  expect(screen.getByText(/up to 64,000/)).toBeInTheDocument();
  expect(publishButton()).toBeDisabled(); // unchanged
});

test('publishes an edited max tokens in the PUT payload', async () => {
  const input = await openEditor();
  fireEvent.change(input, { target: { value: '30000' } });
  expect(publishButton()).not.toBeDisabled();
  fireEvent.click(publishButton());
  await waitFor(() => expect(putBodies).toHaveLength(1));
  expect(putBodies[0]).toMatchObject({ maxTokens: 30000, model: 'claude-sonnet-4-5', expectedVersion: 5 });
});

test.each([['0'], ['-5'], ['1.5'], ['1e3']])('blocks save for invalid max tokens %p', async (bad) => {
  const input = await openEditor();
  fireEvent.change(input, { target: { value: bad } });
  expect(screen.getByText('Max tokens must be a positive whole number.')).toBeInTheDocument();
  expect(publishButton()).toBeDisabled();
});

test('blocks save above the selected model ceiling and re-checks when the model changes', async () => {
  const input = await openEditor();
  fireEvent.change(input, { target: { value: '64001' } });
  expect(screen.getByText(/exceeds this model's output limit of 64,000/)).toBeInTheDocument();
  expect(publishButton()).toBeDisabled();

  // Switching to a 128K model makes the same value valid.
  fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: 'claude-sonnet-5-5' } });
  expect(screen.queryByText(/exceeds this model's output limit/)).not.toBeInTheDocument();
  expect(publishButton()).not.toBeDisabled();

  // Switching back to the 64K model refuses the existing value again.
  fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: 'claude-sonnet-4-5' } });
  expect(screen.getByText(/exceeds this model's output limit of 64,000/)).toBeInTheDocument();
  expect(publishButton()).toBeDisabled();
});

test('a blank field is omitted from the payload so the server keeps the stored value', async () => {
  const input = await openEditor();
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: 'claude-sonnet-5-5' } });
  fireEvent.click(publishButton());
  await waitFor(() => expect(putBodies).toHaveLength(1));
  expect(putBodies[0]).not.toHaveProperty('maxTokens');
});
