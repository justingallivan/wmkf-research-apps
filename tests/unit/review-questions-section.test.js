/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ReviewQuestionsSection from '../../shared/components/admin/ReviewQuestionsSection';

const GET_BODY = {
  questions: [
    { id: 'id-1', key: 'impact', label: 'Q1 impact', type: 'picklist', required: true, order: 0, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
    { id: 'id-2', key: 'q2', label: 'Q2 narrative', type: 'richtext', required: true, order: 1 },
  ],
  version: 'v1',
};

function mockFetch({ postResponse } = {}) {
  return jest.fn(async (url, opts = {}) => {
    if (String(url) === '/api/admin/review-questions' && (!opts.method || opts.method === 'GET')) {
      return { ok: true, status: 200, json: async () => GET_BODY };
    }
    if (String(url) === '/api/admin/review-questions' && opts.method === 'POST') {
      return postResponse || { ok: true, status: 200, json: async () => ({ status: 'completed', summary: { created: 0, updated: 1, deleted: 0, reordered: 0 }, version: 'v2' }) };
    }
    throw new Error(`unexpected fetch ${url} ${opts.method}`);
  });
}

beforeEach(() => { global.fetch = mockFetch(); });

test('renders rows; existing keys are locked, new rows get an editable key input', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));

  // Existing keys are shown locked (no key input for them).
  expect(screen.getByText(/key: impact/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Question key')).not.toBeInTheDocument();

  // Adding a row exposes an editable key input.
  fireEvent.click(screen.getByRole('button', { name: /add question/i }));
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(3));
  expect(screen.getByLabelText('Question key')).toBeInTheDocument();
});

test('save POSTs the full set + baseVersion, then reloads', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));

  // Edit Q2's text → becomes dirty.
  const q2 = within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text');
  fireEvent.change(q2, { target: { value: 'Q2 edited' } });

  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => {
    const post = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse(post[1].body);
    expect(body.baseVersion).toBe('v1');
    expect(body.questions).toHaveLength(2);
    expect(body.questions[1]).toMatchObject({ id: 'id-2', key: 'q2', label: 'Q2 edited' });
  });
  // Reload after success: a second GET fired.
  await waitFor(() => {
    const gets = global.fetch.mock.calls.filter(([, o]) => !o?.method || o.method === 'GET');
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });
});

test('multiselect uses the option editor and saves numeric value/label pairs', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));

  const narrativeRow = within(screen.getAllByTestId('rq-row')[1]);
  fireEvent.change(narrativeRow.getByLabelText('Question type'), {
    target: { value: 'multiselect' },
  });
  expect(narrativeRow.queryByLabelText('Max length')).not.toBeInTheDocument();
  fireEvent.click(narrativeRow.getByRole('button', { name: /add option/i }));
  fireEvent.change(narrativeRow.getByLabelText('Option 1 label'), {
    target: { value: 'First category' },
  });

  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await waitFor(() => {
    const post = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    const body = JSON.parse(post[1].body);
    expect(body.questions[1]).toMatchObject({
      key: 'q2',
      type: 'multiselect',
      options: [{ value: 1, label: 'First category' }],
    });
  });
});

test('a 409 set_changed preserves the operator edits instead of discarding them', async () => {
  global.fetch = mockFetch({ postResponse: { ok: false, status: 409, json: async () => ({ status: 'set_changed', error: 'The question set changed since you loaded it.' }) } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));

  const edited = within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text');
  fireEvent.change(edited, { target: { value: 'my unsaved wording' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  // The conflict is reported...
  await waitFor(() => expect(screen.getByTestId('rq-message-conflict')).toBeInTheDocument());
  // ...the typed edit is STILL THERE (the regression this guards: it used to be
  // recoverable only by reloading, which threw it away)...
  expect(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text')).toHaveValue('my unsaved wording');
  // ...and Save is usable again, because the resync re-baselined the version.
  expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled();
  // Discarding remains available, but only as an explicit choice.
  expect(screen.getByRole('button', { name: /discard my edits/i })).toBeInTheDocument();
});

test('a 409 resync retains the draft and retries with the new server version', async () => {
  let gets = 0;
  let posts = 0;
  global.fetch = jest.fn(async (url, opts = {}) => {
    if (opts.method === 'POST') {
      posts++;
      if (posts > 2) throw new Error('Unexpected extra POST');
      return posts === 1
        ? { ok: false, status: 409, json: async () => ({ status: 'set_changed' }) }
        : { ok: true, status: 200, json: async () => ({ status: 'completed', summary: { updated: 1 }, version: 'v3' }) };
    }
    gets++;
    if (gets > 3) throw new Error('Unexpected extra GET');
    const state = gets === 1 ? GET_BODY : {
      ...GET_BODY, version: gets === 2 ? 'v2' : 'v3',
      questions: GET_BODY.questions.map(q => q.id === 'id-2' ? { ...q, label: gets === 2 ? 'Concurrent wording' : 'My retained wording' } : q),
    };
    return { ok: true, status: 200, json: async () => state };
  });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'My retained wording' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await screen.findByTestId('rq-message-conflict');
  expect(within(screen.getAllByTestId('rq-row')[1]).getByTestId('rq-row-conflict')).toBeInTheDocument();
  expect(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text')).toHaveValue('My retained wording');
  await waitFor(() => expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await screen.findByRole('button', { name: /^no changes$/i });
  expect(gets).toBe(3);
  expect(posts).toBe(2);
  expect(screen.queryByTestId('rq-row-conflict')).not.toBeInTheDocument();
  expect(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text')).toHaveValue('My retained wording');
  const bodies = global.fetch.mock.calls.filter(([, o]) => o?.method === 'POST').map(([, o]) => JSON.parse(o.body));
  expect(bodies).toHaveLength(2);
  expect(bodies[0].baseVersion).toBe('v1');
  expect(bodies[1]).toEqual({ questions: bodies[0].questions, baseVersion: 'v2' });
  expect(bodies[1].questions[1].label).toBe('My retained wording');
});

test('a no-op save is reported neutrally, not as a success', async () => {
  global.fetch = mockFetch({ postResponse: { ok: true, status: 200, json: async () => ({ status: 'completed', summary: { created: 0, updated: 0, deleted: 0, reordered: 0 }, version: 'v1' }) } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'edited but server saw no diff' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  // Nothing was written, so it must NOT wear the success styling — that is what
  // made a swallowed edit look like a completed one.
  await waitFor(() => expect(screen.getByTestId('rq-message-noop')).toBeInTheDocument());
  expect(screen.queryByTestId('rq-message-saved')).not.toBeInTheDocument();
  expect(screen.getByTestId('rq-message-noop')).toHaveTextContent(/nothing was written/i);
});

test('a completed save with auditWritten:false surfaces a persistent audit warning', async () => {
  global.fetch = mockFetch({ postResponse: { ok: true, status: 200, json: async () => ({ status: 'completed', summary: { created: 0, updated: 1, deleted: 0, reordered: 0 }, version: 'v2', auditWritten: false }) } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'edited' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  // The warning survives the post-save reload (it's separate from the transient message).
  await waitFor(() => expect(screen.getByTestId('rq-audit-warning')).toBeInTheDocument());
  expect(screen.getByTestId('rq-audit-warning')).toHaveTextContent(/audit record could not be written/i);
});

test('drag-to-reorder changes the submitted order', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  const rowsEls = screen.getAllByTestId('rq-row');

  // Drag row 0 (impact) onto row 1 (q2) → order becomes [q2, impact].
  fireEvent.dragStart(rowsEls[0]);
  fireEvent.dragOver(rowsEls[1]);
  fireEvent.drop(rowsEls[1]);

  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await waitFor(() => {
    const post = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
    const body = JSON.parse(post[1].body);
    expect(body.questions.map((q) => q.key)).toEqual(['q2', 'impact']);
  });
});

test('move buttons provide a keyboard-operable reorder path', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));

  fireEvent.click(screen.getByRole('button', { name: 'Move question 1 down' }));
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => {
    const post = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    const body = JSON.parse(post[1].body);
    expect(body.questions.map((question) => question.key)).toEqual(['q2', 'impact']);
  });
});

// T3 matrix (Stage 3, group A) ahead of migrating all three fetch sites onto
// shared/utils/api-request.js. load (:99) and resyncPreservingEdits (:130)
// branch on status/ok before the body; the 403 -> 'Admin access required'
// message is pinned verbatim (plan §2.3). save (:205) is tolerant with
// several status/body-flag branches.
test('(b) load: 403 shows "Admin access required" verbatim', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'ignored' }) }));
  render(<ReviewQuestionsSection />);
  expect(await screen.findByText('Admin access required')).toBeInTheDocument();
});

test('(b) load: non-403 non-2xx shows the generic load failure', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'ignored' }) }));
  render(<ReviewQuestionsSection />);
  expect(await screen.findByText('Failed to load review questions')).toBeInTheDocument();
});

test('(c) load: a network rejection surfaces the rejection\'s own message', async () => {
  global.fetch = jest.fn(async () => { throw new Error('network down'); });
  render(<ReviewQuestionsSection />);
  expect(await screen.findByText('network down')).toBeInTheDocument();
});

test('(d) load: a malformed 2xx body rejects into the same error state', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }));
  render(<ReviewQuestionsSection />);
  expect(await screen.findByText('bad json')).toBeInTheDocument();
});

test('(c) save: a network rejection shows "Save failed." with the rejection message', async () => {
  global.fetch = mockFetch();
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  const postSpy = global.fetch;
  global.fetch = jest.fn(async (url, opts = {}) => {
    if (opts.method === 'POST') throw new Error('network down');
    return postSpy(url, opts);
  });
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'edited' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  expect(await screen.findByTestId('rq-message-error')).toHaveTextContent('network down');
});

test('(e) save: a non-2xx unparseable body (502) shows "Save failed." (tolerant parse), never silent', async () => {
  global.fetch = mockFetch({ postResponse: { ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'edited' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  expect(await screen.findByTestId('rq-message-error')).toHaveTextContent('Save failed.');
});

// D3-adjacent (Stage 3 correction round 1, review item 3): a 2xx save whose
// body is empty/unparseable is tolerant (:205 `tolerantBody: true`), so
// `data` is `{}`; `data.status !== 'completed'` is then true and the save
// falls into today's "Save failed." fallback rather than surfacing the raw
// parse error.
test('(save, 2xx empty body) a 2xx save with an empty/unparseable body falls back to "Save failed." (tolerant parse)', async () => {
  global.fetch = mockFetch({ postResponse: { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'edited' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  expect(await screen.findByTestId('rq-message-error')).toHaveTextContent('Save failed.');
});

test('discard after a conflict explicitly replaces the retained draft', async () => {
  global.fetch = mockFetch({ postResponse: { ok: false, status: 409, json: async () => ({ status: 'set_changed' }) } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'Discard this edit' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await screen.findByTestId('rq-message-conflict');
  fireEvent.click(screen.getByRole('button', { name: /discard my edits/i }));
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  expect(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text')).toHaveValue('Q2 narrative');
  expect(screen.queryByTestId('rq-message-conflict')).not.toBeInTheDocument();
});

test('type switches clear incompatible fields and retain options between option types', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  const first = within(screen.getAllByTestId('rq-row')[0]);
  fireEvent.change(first.getByLabelText('Question type'), { target: { value: 'richtext' } });
  fireEvent.change(first.getByLabelText('Question type'), { target: { value: 'picklist' } });
  expect(first.queryByLabelText('Option 1 label')).not.toBeInTheDocument();
  const second = within(screen.getAllByTestId('rq-row')[1]);
  fireEvent.change(second.getByLabelText('Max length'), { target: { value: '500' } });
  fireEvent.change(second.getByLabelText('Question type'), { target: { value: 'multiselect' } });
  expect(second.queryByLabelText('Max length')).not.toBeInTheDocument();
  fireEvent.click(second.getByRole('button', { name: /add option/i }));
  fireEvent.change(second.getByLabelText('Option 1 label'), { target: { value: 'Retained option' } });
  fireEvent.change(second.getByLabelText('Question type'), { target: { value: 'picklist' } });
  expect(second.getByLabelText('Option 1 label')).toHaveValue('Retained option');
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(true));
  const post = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
  const questions = JSON.parse(post[1].body).questions;
  expect(questions[0].options).toEqual([]);
  expect(questions[1]).toEqual({ id: 'id-2', key: 'q2', label: 'Q2 narrative', type: 'picklist', required: true, options: [{ value: 1, label: 'Retained option' }] });
});
