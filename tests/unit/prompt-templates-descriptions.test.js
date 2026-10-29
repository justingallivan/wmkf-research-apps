/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PromptTemplatesSection from '../../shared/components/admin/PromptTemplatesSection';
import { ADMIN_PROMPT_CATALOG } from '../../shared/config/adminPromptCatalog';

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

async function renderOpenWorkflows() {
  render(<PromptTemplatesSection />);
  await screen.findByLabelText('Search prompts');
  for (const summary of document.querySelectorAll('details > summary')) {
    if (!summary.textContent.startsWith('Legacy app prompts')) fireEvent.click(summary);
  }
}

test('shows an audited title, explanation, Used by label and technical key together', async () => {
  serve([prompt('executor.echo-parity')]);
  await renderOpenWorkflows();
  const card = await screen.findByRole('article', { name: 'Executor echo and cache diagnostic' });
  expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent('Executor echo and cache diagnostic');
  expect(within(card).getByText(/Copies a request number and supplied test text/)).toBeInTheDocument();
  expect(within(card).getByText('Used by:').parentElement).toHaveTextContent('Developer smoke tests.');
  expect(within(card).getByText('Developer diagnostic')).toBeInTheDocument();
  expect(within(card).getByText('executor.echo-parity').tagName).toBe('CODE');
});

test('keeps application use, stored reference and live publication state separate', async () => {
  serve([prompt('review-synthesis.generate'), prompt('phase-ii.qa'), prompt('phase-i.checkin', false)]);
  await renderOpenWorkflows();
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
  await renderOpenWorkflows();
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
  await renderOpenWorkflows();
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
  await renderOpenWorkflows();
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
  await renderOpenWorkflows();
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
  await renderOpenWorkflows();
  fireEvent.change(await screen.findByLabelText('Search prompts'), { target: { value: query } });
  expect(screen.getByRole('article', { name: title })).toBeVisible();
  expect(screen.getByText('1 of 3 prompts')).toBeInTheDocument();
  const visibleCards = screen.getAllByRole('article').filter(card => !card.closest('[hidden]'));
  expect(visibleCards).toHaveLength(1);
});

test('search reveals matching legacy references and clearing restores the collapsed group', async () => {
  serve([prompt('executor.echo-parity'), prompt('phase-ii.qa'), prompt('phase-ii.refine')]);
  await renderOpenWorkflows();
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
  await renderOpenWorkflows();
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
  fireEvent.click(screen.getByText('Diagnostics and drafts (1)'));
  expect(within(card).getByLabelText(/^Prompt body/)).toHaveValue('Keep this unsaved draft.');
  expect(global.fetch.mock.calls.every(([, options]) => options?.method !== 'PUT')).toBe(true);
});


test('shows workflow counts in collapsed sections, including Pre-flight, with distinct review subgroups', async () => {
  serve([
    prompt('phase-i.summary'), prompt('initial-assessment.generate'), prompt('pre-site-visit.proposal-core.generate'), prompt('field-primer.generate'),
    prompt('review-synthesis.generate'), prompt('review-panel.chair'), prompt('multi-perspective.optimist'),
  ]);
  render(<PromptTemplatesSection />);
  const preflight = await screen.findByText('Pre-flight (4)', { selector: 'summary' });
  const reviews = screen.getByText('Reviews and evaluations (3)', { selector: 'summary' });
  expect(preflight.closest('details')).not.toHaveAttribute('open');
  expect(reviews.closest('details')).not.toHaveAttribute('open');
  expect(screen.queryByText(/Proposal preparation/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Reviewer selection/)).not.toBeInTheDocument();
  fireEvent.click(preflight);
  expect(within(preflight.closest('details')).getAllByRole('article')).toHaveLength(4);
  fireEvent.click(reviews);
  expect(screen.getByRole('region', { name: 'Human peer reviews' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'AI Review Panel' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Multi-Perspective Evaluator' })).toBeVisible();
});

test('searches workflow and subgroup labels, expands matching groups, and hides empty groups', async () => {
  serve([prompt('phase-i.summary'), prompt('initial-assessment.generate'), prompt('review-panel.seat'), prompt('review-synthesis.generate')]);
  render(<PromptTemplatesSection />);
  const input = await screen.findByLabelText('Search prompts');
  fireEvent.change(input, { target: { value: 'Pre-flight' } });
  expect(screen.getByText('Pre-flight (2)', { selector: 'summary' }).closest('details')).toHaveAttribute('open');
  expect(screen.getByText('2 of 4 prompts')).toBeInTheDocument();
  expect(screen.getByText('Reviews and evaluations (0)', { selector: 'summary' })).not.toBeVisible();
  fireEvent.change(input, { target: { value: 'Human peer reviews' } });
  expect(screen.getByRole('article', { name: 'Synthesize submitted human peer reviews' })).toBeVisible();
  expect(screen.getByText('AI Review Panel (0)').closest('section')).not.toBeVisible();
  expect(screen.getByText('Reviews and evaluations (1)', { selector: 'summary' }).closest('details')).toHaveAttribute('open');
  expect(screen.getByText('1 of 4 prompts')).toBeInTheDocument();
});


test('all audited prompts appear once across the proposed workflow groups and their subgroups', async () => {
  serve(Object.keys(ADMIN_PROMPT_CATALOG).map(name => prompt(name, name !== 'phase-i.checkin')));
  render(<PromptTemplatesSection />);
  await screen.findByLabelText('Search prompts');
  for (const label of [
    'Pre-flight (4)', 'Reviewer selection (3)', 'Reviews and evaluations (11)',
    'Meetings and briefings (7)', 'Awardee content (2)', 'Research and office tools (7)',
    'Diagnostics and drafts (2)', 'Legacy app prompts — stored reference (4)',
  ]) expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getAllByRole('article', { hidden: true })).toHaveLength(40);
  fireEvent.click(screen.getByText('Reviews and evaluations (11)', { selector: 'summary' }));
  expect(within(screen.getByRole('region', { name: 'Human peer reviews' })).getAllByRole('article')).toHaveLength(3);
  expect(within(screen.getByRole('region', { name: 'AI Review Panel' })).getAllByRole('article')).toHaveLength(2);
  expect(within(screen.getByRole('region', { name: 'Multi-Perspective Evaluator' })).getAllByRole('article')).toHaveLength(6);
});

test('workflow disclosures expand independently and preserve an unsaved draft when collapsed', async () => {
  serve([prompt('phase-i.summary'), prompt('reviewer-finder.analyze')]);
  render(<PromptTemplatesSection />);
  const preflight = await screen.findByText('Pre-flight (1)', { selector: 'summary' });
  const reviewers = screen.getByText('Reviewer selection (1)');
  fireEvent.click(preflight);
  expect(reviewers.closest('details')).not.toHaveAttribute('open');
  const card = screen.getByRole('article', { name: 'Phase I proposal summary' });
  fireEvent.click(within(card).getByRole('button', { name: 'Edit & publish' }));
  fireEvent.change(within(card).getByLabelText(/^Prompt body/), { target: { value: 'Retain this workflow draft.' } });
  fireEvent.click(preflight);
  expect(card).not.toBeVisible();
  fireEvent.click(reviewers);
  expect(preflight.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(preflight);
  expect(within(card).getByLabelText(/^Prompt body/)).toHaveValue('Retain this workflow draft.');
});


test('a new search reopens matching workflow sections after a manual collapse', async () => {
  serve([prompt('phase-i.summary'), prompt('initial-assessment.generate')]);
  render(<PromptTemplatesSection />);
  const input = await screen.findByLabelText('Search prompts');
  fireEvent.change(input, { target: { value: 'Pre-flight' } });
  const summary = screen.getByText('Pre-flight (2)', { selector: 'summary' });
  fireEvent.click(summary);
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.change(input, { target: { value: 'Initial Assessment' } });
  expect(screen.getByText('Pre-flight (1)', { selector: 'summary' }).closest('details')).toHaveAttribute('open');
  expect(screen.getByRole('article', { name: 'Initial Assessment narrative draft' })).toBeVisible();
});
