/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PromptTemplatesSection from '../../shared/components/admin/PromptTemplatesSection';

jest.mock('../../shared/components/admin/DataverseFieldInfoButton', () => function FieldInfo() {
  return <span data-testid="field-info" />;
});

const response = data => ({ ok: true, status: 200, json: async () => data });
const prompt = (name, hasCurrent = true) => ({
  id: name, name, hasCurrent, version: 1, body: 'Original prompt body.',
  systemPrompt: '', outputSchema: '', model: 'claude-sonnet-4-5', maxTokens: 1024,
});

function serve(prompts) {
  global.fetch = jest.fn(async url => {
    if (url === '/api/admin/prompts') return response({ prompts });
    if (url === '/api/admin/models') return response({
      tiers: [], availableModels: [{ id: 'claude-sonnet-4-5', display_name: 'Sonnet' }],
      modelStatuses: { 'claude-sonnet-4-5': { ok: true, capability: { maxOutputTokens: 64000 } } },
    });
    if (url === '/api/admin/executor-budgets') return response({ budgets: {} });
    if (url.startsWith('/api/admin/prompts/')) return response({ status: 'completed', targetVersion: 2 });
    throw new Error(`Unexpected URL: ${url}`);
  });
}

test('shows an audited title, explanation, Used by label and technical key together', async () => {
  serve([prompt('executor.echo-parity')]);
  render(<PromptTemplatesSection />);
  const card = await screen.findByRole('article', { name: 'Executor echo and cache diagnostic' });
  expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent('Executor echo and cache diagnostic');
  expect(within(card).getByText(/Copies a request number and supplied test text/)).toBeInTheDocument();
  expect(within(card).getByText('Used by:').parentElement).toHaveTextContent('Developer smoke tests.');
  expect(within(card).getByText('Developer diagnostic')).toBeInTheDocument();
  expect(within(card).getByText('executor.echo-parity').tagName).toBe('CODE');
});

test('keeps application use, stored reference and live publication state separate', async () => {
  serve([prompt('review-synthesis.generate'), prompt('phase-ii.qa'), prompt('phase-i.checkin', false)]);
  render(<PromptTemplatesSection />);
  const active = await screen.findByRole('article', { name: 'Synthesize submitted human peer reviews' });
  expect(within(active).getByText('Application caller')).toBeInTheDocument();
  expect(within(active).getByText(/submitted reviewers’ ratings/)).toBeInTheDocument();
  const reference = screen.getByRole('article', { name: 'Legacy Phase II proposal Q&A' });
  expect(within(reference).getByText('Stored reference')).toBeInTheDocument();
  expect(within(reference).getByText(/current version/)).toHaveTextContent('v1');
  expect(within(reference).getByRole('button', { name: 'Edit & publish' })).toBeEnabled();
  const draft = screen.getByRole('article', { name: 'Phase I application and budget checks' });
  expect(within(draft).getByText('No application caller')).toBeInTheDocument();
  expect(within(draft).getByText('draft — no published version')).toBeInTheDocument();
  expect(within(draft).getByRole('button', { name: 'View' })).toBeEnabled();
});

test.each(['new.prompt', 'constructor', '__proto__'])('keeps an uncataloged name %s visible', async name => {
  serve([prompt(name)]);
  render(<PromptTemplatesSection />);
  const card = await screen.findByRole('article', { name: 'Description not cataloged' });
  expect(within(card).getByText(name)).toBeInTheDocument();
  expect(within(card).getByText('Not cataloged')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Edit & publish' })).toBeEnabled();
  if (name === 'new.prompt') {
    fireEvent.click(within(card).getByRole('button', { name: 'Edit & publish' }));
    expect(within(card).getByRole('button', { name: 'Publish v2' })).toBeDisabled();
  }
});

test('publishing a descriptively titled prompt still addresses its original technical key', async () => {
  serve([prompt('executor.echo-parity')]);
  render(<PromptTemplatesSection />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit & publish' }));
  fireEvent.change(screen.getByLabelText(/^Prompt body/), { target: { value: 'Updated prompt body.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish v2' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/prompts/executor.echo-parity', expect.objectContaining({ method: 'PUT' })));
  const [, options] = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
  expect(JSON.parse(options.body)).toMatchObject({ body: 'Updated prompt body.', expectedVersion: 1 });
  expect(JSON.parse(options.body)).not.toHaveProperty('title');
});
