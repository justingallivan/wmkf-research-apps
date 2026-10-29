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
  fireEvent.click(screen.getByText(/Legacy app prompts — stored reference/));
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


test('collapses only audited stored references and preserves their drafts when toggled', async () => {
  serve([
    prompt('phase-ii.qa'), prompt('phase-ii.summarize'), prompt('phase-ii.refine'), prompt('phase-ii.extract-structured'),
    prompt('review-synthesis.generate'), prompt('executor.echo-parity'), prompt('phase-i.checkin', false), prompt('phase-ii.new-prompt'),
  ]);
  render(<PromptTemplatesSection />);
  const summary = await screen.findByText('Legacy app prompts — stored reference (4)');
  const disclosure = summary.closest('details');
  expect(disclosure).not.toHaveAttribute('open');
  expect(screen.getByRole('article', { name: 'Legacy Phase II proposal Q&A' })).not.toBeVisible();
  expect(screen.getByRole('article', { name: 'Synthesize submitted human peer reviews' })).toBeVisible();
  expect(screen.getByRole('article', { name: 'Executor echo and cache diagnostic' })).toBeVisible();
  expect(screen.getByRole('article', { name: 'Phase I application and budget checks' })).toBeVisible();
  expect(screen.getByText('phase-ii.new-prompt')).toBeVisible();

  fireEvent.click(summary);
  expect(disclosure).toHaveAttribute('open');
  expect(within(disclosure).getAllByRole('article')).toHaveLength(4);
  const reference = screen.getByRole('article', { name: 'Legacy Phase II proposal Q&A' });
  expect(reference).toBeVisible();
  expect(within(reference).getByText('phase-ii.qa')).toBeVisible();
  fireEvent.click(within(reference).getByRole('button', { name: 'Edit & publish' }));
  fireEvent.change(within(reference).getByLabelText(/^Prompt body/), { target: { value: 'Unsaved reference draft.' } });
  fireEvent.click(summary);
  expect(reference).not.toBeVisible();
  fireEvent.click(summary);
  expect(within(reference).getByLabelText(/^Prompt body/)).toHaveValue('Unsaved reference draft.');
});

test('omits an empty legacy-reference group', async () => {
  serve([prompt('executor.echo-parity')]);
  render(<PromptTemplatesSection />);
  await screen.findByText('executor.echo-parity');
  expect(screen.queryByText(/Legacy app prompts — stored reference/)).not.toBeInTheDocument();
});

test.each([
  ['ECHO-PAR', 'Executor echo and cache diagnostic'],
  ['receipt text', 'Extract expenses from receipt text'],
  ['cache use', 'Executor echo and cache diagnostic'],
  ['Awardee', 'Rewrite the grantee abstract in Foundation style'],
])('searches technical keys, titles, explanations and Used by without case sensitivity: %s', async (query, title) => {
  serve([prompt('executor.echo-parity'), prompt('expense-reporter.extract-document'), prompt('grantee-abstract.generate')]);
  render(<PromptTemplatesSection />);
  fireEvent.change(await screen.findByLabelText('Search prompts'), { target: { value: query } });
  expect(screen.getByRole('article', { name: title })).toBeVisible();
  expect(screen.getByText('1 of 3 prompts')).toBeInTheDocument();
  const visibleCards = screen.getAllByRole('article').filter(card => !card.closest('[hidden]'));
  expect(visibleCards).toHaveLength(1);
});

test('search reveals matching legacy references and clearing restores the collapsed group', async () => {
  serve([prompt('executor.echo-parity'), prompt('phase-ii.qa'), prompt('phase-ii.refine')]);
  render(<PromptTemplatesSection />);
  const input = await screen.findByLabelText('Search prompts');
  fireEvent.change(input, { target: { value: '  LEGACY   Q&A ' } });
  const summary = screen.getByText('Legacy app prompts — stored reference (1)');
  expect(summary.closest('details')).toHaveAttribute('open');
  expect(screen.getByRole('article', { name: 'Legacy Phase II proposal Q&A' })).toBeVisible();
  expect(screen.getByText('phase-ii.refine')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(input).toHaveValue('');
  expect(screen.getByText('3 of 3 prompts')).toBeInTheDocument();
  expect(summary.closest('details')).not.toHaveAttribute('open');
});

test('search preserves an unsaved editor and shows an actionable empty result', async () => {
  serve([prompt('executor.echo-parity'), prompt('new.prompt')]);
  render(<PromptTemplatesSection />);
  const input = await screen.findByLabelText('Search prompts');
  const card = screen.getByRole('article', { name: 'Executor echo and cache diagnostic' });
  fireEvent.click(within(card).getByRole('button', { name: 'Edit & publish' }));
  fireEvent.change(within(card).getByLabelText(/^Prompt body/), { target: { value: 'Keep this unsaved draft.' } });
  fireEvent.change(input, { target: { value: 'no-such-prompt' } });
  expect(screen.getByText('No prompts match your search.')).toBeVisible();
  expect(card).not.toBeVisible();
  expect(screen.getByText('0 of 2 prompts')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'new.prompt' } });
  expect(screen.getByText('new.prompt')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(within(card).getByLabelText(/^Prompt body/)).toHaveValue('Keep this unsaved draft.');
  expect(global.fetch.mock.calls.every(([, options]) => options?.method !== 'PUT')).toBe(true);
});
