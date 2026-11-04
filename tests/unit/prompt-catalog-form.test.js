/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PromptCatalogForm from '../../shared/components/admin/PromptCatalogForm';
import { getAdminPromptDescription } from '../../shared/config/adminPromptCatalog';

const ROW = '44444444-4444-4444-8444-444444444444';
const NAME = 'review-synthesis.generate';
const catalog = { title: 'Stored title', description: 'Stored description', group: 'reviews', section: 'human', usedBy: 'Workbench', usage: 'application' };
const prompt = (over = {}) => ({ id: ROW, name: NAME, hasCurrent: true, version: 4, catalog, ...over });

function setup(over = {}, data = { status: 'catalog_updated' }) {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => data }));
  const handlers = { onSuccess: jest.fn(), onOutcome: jest.fn(), onCancel: jest.fn() };
  render(<PromptCatalogForm prompt={prompt(over)} fallback={getAdminPromptDescription(NAME)} {...handlers} />);
  return handlers;
}

test('prefills stored values and keeps Save disabled until something changes', () => {
  setup();
  expect(screen.getByLabelText('Title')).toHaveValue('Stored title');
  expect(screen.getByLabelText('Section')).toHaveValue('human');
  expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
});

test('a prompt with no stored values starts blank, with the built-in text only as placeholders', () => {
  setup({ catalog: { title: null, description: null, group: null, section: null, usedBy: null, usage: null } });
  expect(screen.getByLabelText('Title')).toHaveValue('');
  expect(screen.getByLabelText('Title')).toHaveAttribute('placeholder', getAdminPromptDescription(NAME).title);
});

test('saves a PATCH with the loaded row, the loaded values and the trimmed edits', async () => {
  const { onSuccess } = setup();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  New title  ' } });
  expect(screen.getByRole('option', { name: 'Power Automate flow' })).toHaveValue('power-automate');
  fireEvent.change(screen.getByLabelText('Usage'), { target: { value: 'power-automate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ status: 'catalog_updated' }));
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe(`/api/admin/prompts/${encodeURIComponent(NAME)}`);
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ rowId: ROW, expected: catalog, catalog: { ...catalog, title: 'New title', usage: 'power-automate' } });
});

test('changing to a group with sections requires a section; a group without sections clears it', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'reviews' } });
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'tools' } });
  expect(screen.queryByLabelText('Section')).toBeNull();
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'reviews' } });
  expect(screen.getByLabelText('Section')).toHaveValue('');
  expect(screen.getByText(/Choose a section for/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
});

test('a conflict is reported to the parent without internal warning codes', async () => {
  const { onOutcome, onSuccess } = setup({}, { status: 'catalog_conflict', error: 'Reload and re-apply.', warnings: ['row_etag_mismatch'] });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(onOutcome).toHaveBeenCalledWith({ status: 'catalog_conflict', error: 'Reload and re-apply.' }));
  expect(onSuccess).not.toHaveBeenCalled();
});
