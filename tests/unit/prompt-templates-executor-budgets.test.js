/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PromptTemplatesSection, {
  ExecutorBudgetEditor,
  OutputBudgetLine,
} from '../../shared/components/admin/PromptTemplatesSection';

jest.mock('../../shared/components/admin/DataverseFieldInfoButton', () => function FieldInfo() {
  return <span data-testid="field-info" />;
});

const prompt = {
  id: 'prompt-1',
  name: 'pre-site-visit.proposal-core.generate',
  version: 5,
  hasCurrent: true,
  body: 'body',
  systemPrompt: 'system',
  outputSchema: '',
  model: 'claude-sonnet-5',
  maxTokens: 16384,
};

function budgetConfig(version = 0, maxTokensOverride = 32768) {
  return {
    schemaVersion: 1,
    version,
    latestRevision: version,
    source: version ? 'dataverse' : 'code_fallback',
    publishedAt: version ? '2026-08-29T12:00:00.000Z' : null,
    settingKey: version ? `executor.budgets.v${String(version).padStart(6, '0')}` : null,
    budgets: {
      'pre-site-visit.proposal-core.generate': {
        kind: 'standing', maxTokensOverride, timeoutMsOverride: 240000,
      },
      'review-synthesis.generate': { kind: 'retry', floor: 16000, ceiling: 32000 },
    },
    limits: {
      'pre-site-visit.proposal-core.generate': {
        maxTokensOverride: { min: 4096, max: 128000 },
        timeoutMsOverride: { min: 60000, max: 240000 },
      },
      'review-synthesis.generate': {
        floor: { min: 4096, max: 128000 },
        ceiling: { min: 4096, max: 128000 },
      },
    },
    descriptions: {
      'pre-site-visit.proposal-core.generate': { reason: 'Long proposal.' },
    },
    storageWarnings: [],
  };
}

function response(body, ok = true, status = 200) {
  return { ok, status, json: jest.fn(async () => body) };
}

beforeEach(() => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/admin/prompts') return response({ prompts: [prompt] });
    if (url === '/api/admin/models') {
      return response({
        defaultModel: 'sonnet',
        defaultModelResolved: 'claude-sonnet-5',
        tiers: [],
        availableModels: [],
        modelStatuses: {
          'claude-sonnet-5': {
            capability: { status: 'reviewed', maxOutputTokens: 128000 },
          },
        },
      });
    }
    if (url === '/api/admin/executor-budgets' && options.method === 'PUT') {
      return response({ status: 'completed', config: budgetConfig(1, 40000) });
    }
    if (url === '/api/admin/executor-budgets') return response(budgetConfig());
    throw new Error(`Unexpected fetch ${url}`);
  });
});

test('Admin edits and atomically publishes the complete Executor budget revision', async () => {
  render(<PromptTemplatesSection />);

  const maxTokens = await screen.findByLabelText(/Maximum output tokens/);
  expect(screen.getByText(/No published revision/)).toBeInTheDocument();
  expect(screen.getByTestId('output-budget')).toHaveTextContent('32,768 tokens');

  fireEvent.change(maxTokens, { target: { value: '40000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish v1' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/admin/executor-budgets',
    expect.objectContaining({ method: 'PUT' }),
  ));
  const put = global.fetch.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(put[1].body)).toMatchObject({
    expectedVersion: 0,
    budgets: {
      'pre-site-visit.proposal-core.generate': { maxTokensOverride: 40000 },
      'review-synthesis.generate': { floor: 16000, ceiling: 32000 },
    },
  });
  expect(JSON.parse(put[1].body).requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await screen.findByText('Published Executor budget revision 1.')).toBeInTheDocument();
  expect(screen.getByTestId('output-budget')).toHaveTextContent('published revision 1');
});

test('a budget-load failure leaves unrelated prompt editing available', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/admin/prompts') return response({ prompts: [prompt] });
    if (url === '/api/admin/models') {
      return response({
        defaultModel: 'sonnet',
        defaultModelResolved: 'claude-sonnet-5',
        tiers: [],
        availableModels: [],
        modelStatuses: {},
      });
    }
    if (url === '/api/admin/executor-budgets') {
      return response({ error: 'unavailable' }, false, 503);
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  render(<PromptTemplatesSection />);

  expect(await screen.findByText('pre-site-visit.proposal-core.generate')).toBeInTheDocument();
  expect(await screen.findByText(/Failed to load Executor budgets/)).toHaveTextContent(
    'Prompt editing remains available',
  );
  expect(screen.getByRole('button', { name: 'Edit & publish' })).toBeEnabled();
});

test('a dirty budget draft must be field-level reapplied after a concurrent reload', async () => {
  const onPublished = jest.fn();
  const { rerender } = render(
    <ExecutorBudgetEditor config={budgetConfig(1, 32768)} onPublished={onPublished} />,
  );
  fireEvent.change(screen.getByLabelText(/Maximum output tokens/), { target: { value: '40000' } });

  const current = budgetConfig(2, 50000);
  current.budgets['pre-site-visit.proposal-core.generate'].timeoutMsOverride = 180000;
  rerender(<ExecutorBudgetEditor config={current} onPublished={onPublished} />);
  expect(screen.getByText(/changed after this draft was loaded/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish v2' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Reapply my changes to v2' }));
  expect(screen.getByLabelText(/Maximum output tokens/)).toHaveValue(40000);
  expect(screen.getByLabelText(/Timeout/)).toHaveValue(180000);
  fireEvent.click(screen.getByRole('button', { name: 'Publish v3' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/admin/executor-budgets',
    expect.objectContaining({ method: 'PUT' }),
  ));
  const put = global.fetch.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(put[1].body)).toMatchObject({
    expectedVersion: 2,
    budgets: {
      'pre-site-visit.proposal-core.generate': {
        maxTokensOverride: 40000,
        timeoutMsOverride: 180000,
      },
    },
  });
});

test('a version conflict retains the draft and pauses publishing until explicit reapply', async () => {
  const current = budgetConfig(2, 50000);
  global.fetch.mockResolvedValueOnce(response({
    error: 'Executor budgets changed after this editor was loaded.',
    code: 'version_conflict',
    current,
  }, false, 409));
  const onPublished = jest.fn();
  render(<ExecutorBudgetEditor config={budgetConfig(1, 32768)} onPublished={onPublished} />);
  fireEvent.change(screen.getByLabelText(/Maximum output tokens/), { target: { value: '40000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish v2' }));

  expect(await screen.findByText(/changed after this editor was loaded/)).toBeInTheDocument();
  expect(onPublished).toHaveBeenCalledWith(current);
  expect(screen.getByLabelText(/Maximum output tokens/)).toHaveValue(40000);
  expect(screen.getByRole('button', { name: 'Publish v2' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reapply my changes to v2' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Reapply my changes to v2' }));
  expect(screen.getByLabelText(/Maximum output tokens/)).toHaveValue(40000);
  expect(screen.getByRole('button', { name: 'Publish v3' })).toBeEnabled();
});

test('an unknown future storage schema is visible and disables publication', () => {
  const current = budgetConfig(1, 32768);
  current.storageWarnings = [{
    settingKey: 'executor.budgets.v000002',
    version: 2,
    code: 'unsupported_executor_budget_schema',
    message: 'revision 2 uses schemaVersion 2',
  }];
  current.latestRevision = 2;
  render(<ExecutorBudgetEditor config={current} onPublished={jest.fn()} />);

  expect(screen.getByText(/schemaVersion 2/)).toHaveClass('text-red-800');
  fireEvent.change(screen.getByLabelText(/Maximum output tokens/), { target: { value: '40000' } });
  expect(screen.getByRole('button', { name: 'Publish v3' })).toBeDisabled();
});

test('budget display distinguishes a configured override from the final model-capped value', () => {
  render(<OutputBudgetLine
    prompt={{ ...prompt, maxTokens: 16384 }}
    executorBudgetConfig={budgetConfig(1, 96000)}
    modelCatalog={{
      tiers: [],
      defaultModel: 'claude-sonnet-5',
      defaultModelResolved: 'claude-sonnet-5',
      modelStatuses: {
        'claude-sonnet-5': { capability: { status: 'reviewed', maxOutputTokens: 64000 } },
      },
    }}
  />);
  expect(screen.getByTestId('output-budget')).toHaveTextContent('64,000 tokens');
  expect(screen.getByTestId('output-budget')).toHaveTextContent('96,000 configured');
  expect(screen.getByTestId('output-budget')).toHaveTextContent('configured override is capped');
});

test('retry display does not claim the retry override is capped when only the prompt row is invalid', () => {
  render(<OutputBudgetLine
    prompt={{ ...prompt, name: 'review-synthesis.generate', maxTokens: 96000 }}
    executorBudgetConfig={budgetConfig(1)}
    modelCatalog={{
      tiers: [],
      defaultModel: 'claude-sonnet-5',
      defaultModelResolved: 'claude-sonnet-5',
      modelStatuses: {
        'claude-sonnet-5': { capability: { status: 'reviewed', maxOutputTokens: 64000 } },
      },
    }}
  />);
  const line = screen.getByTestId('output-budget');
  expect(line).toHaveTextContent('PROMPT ROW OVER CEILING');
  expect(line).not.toHaveTextContent('effective retry ceiling');
  expect(line).not.toHaveTextContent('configured override is capped');
});
