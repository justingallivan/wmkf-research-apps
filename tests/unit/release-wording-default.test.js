/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AcceptedReviewerReleaseModal from '../../shared/components/reviewers/AcceptedReviewerReleaseModal';
import ReleaseEmailModal from '../../shared/components/reviewers/ReleaseEmailModal';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const PD = '44444444-4444-4444-8444-444444444444';
const SUPERUSER = '55555555-5555-4555-8555-555555555555';
const PREFS = '/api/review-manager/release-email-preferences';

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: jest.fn(async () => body) };
}

function acceptedDraft(over = {}) {
  return {
    suggestionId: SUGGESTION_ID,
    status: 'ok',
    name: 'Dr. Reviewer',
    to: 'reviewer@example.org',
    from: 'pd@example.org',
    senderId: PD,
    subject: 'Admin subject',
    bodyText: 'Admin body',
    templateSource: 'shared',
    expectedNotes: 'Existing note',
    existingNotes: 'Existing note',
    ...over,
  };
}

const sharedTemplate = { subject: 'Admin subject', body: '{{greeting}} admin {{signature}}' };

/** Route fetches by URL and method; each handler list is consumed in order. */
function routeFetch(routes) {
  global.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const key = `${method} ${String(url).split('?')[0]}`;
    const queue = routes[key];
    if (!queue || queue.length === 0) throw new Error(`unexpected fetch ${key}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return typeof next === 'function' ? next(init) : next;
  });
}

function prefsGet(ownSystemId) {
  return response({ ok: true, kind: 'release', ownSystemId, shared: sharedTemplate, configured: false, template: sharedTemplate });
}

async function openDefaults() {
  const summary = await screen.findByText('Your default wording');
  const details = summary.closest('details');
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await screen.findByText(/Used to start this email/);
  return details;
}

beforeEach(() => {
  window.confirm = jest.fn(() => true);
});

afterEach(() => jest.restoreAllMocks());

describe('accepted release dialog', () => {
  test('saving the sender default re-renders the email but keeps the unsaved note and the original notes baseline', async () => {
    routeFetch({
      'POST /api/review-manager/terminal-transition': [
        response({ ok: true, drafts: [acceptedDraft()] }),
        // A colleague changed the note meanwhile; the refresh must not adopt it.
        response({ ok: true, drafts: [acceptedDraft({
          subject: 'PD subject', bodyText: 'PD body', templateSource: 'personal',
          expectedNotes: 'Colleague note', existingNotes: 'Colleague note',
        })] }),
      ],
      [`GET ${PREFS}`]: [prefsGet(PD)],
      [`PUT ${PREFS}`]: [response({ ok: true, kind: 'release', template: { subject: 'PD subject', body: 'b {{signature}}' } })],
    });
    const onRelease = jest.fn(async () => ({ ok: true, data: { results: [{ status: 'released_emailed' }] } }));
    render(<AcceptedReviewerReleaseModal reviewer={{ suggestionId: SUGGESTION_ID, name: 'Dr. Reviewer' }} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={onRelease} />);

    const note = await screen.findByPlaceholderText(/Reviewer remained overdue/);
    expect(note).toHaveValue('Existing note');
    fireEvent.change(note, { target: { value: 'My unsaved note' } });

    const details = await openDefaults();
    fireEvent.change(within(details).getByLabelText('Subject'), { target: { value: 'PD subject' } });
    fireEvent.click(within(details).getByRole('button', { name: 'Save as my default' }));

    await waitFor(() => expect(screen.getAllByLabelText('Subject')[0]).toHaveValue('PD subject'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(note).toHaveValue('My unsaved note');

    fireEvent.click(screen.getByRole('button', { name: 'Release reviewer' }));
    await waitFor(() => expect(onRelease).toHaveBeenCalled());
    const payload = onRelease.mock.calls[0][0];
    expect(payload.internalNotes).toEqual({ [SUGGESTION_ID]: 'My unsaved note' });
    expect(payload.overrides[SUGGESTION_ID]).toMatchObject({
      expectedNotes: 'Existing note',
      subject: 'PD subject',
      bodyText: 'PD body',
      senderId: PD,
    });
  });

  test('edited email copy is replaced only after confirmation', async () => {
    routeFetch({
      'POST /api/review-manager/terminal-transition': [response({ ok: true, drafts: [acceptedDraft()] })],
      [`GET ${PREFS}`]: [prefsGet(PD)],
      [`PUT ${PREFS}`]: [response({ ok: true, kind: 'release', template: sharedTemplate })],
    });
    window.confirm = jest.fn(() => false);
    render(<AcceptedReviewerReleaseModal reviewer={{ suggestionId: SUGGESTION_ID }} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
    await screen.findByPlaceholderText(/Reviewer remained overdue/);
    fireEvent.change(screen.getAllByLabelText('Subject')[0], { target: { value: 'My one-off subject' } });

    const details = await openDefaults();
    fireEvent.click(within(details).getByRole('button', { name: 'Save as my default' }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('Replace your edits to this email with your saved wording?'));
    expect(screen.getAllByLabelText('Subject')[0]).toHaveValue('My one-off subject');
    const previewCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('terminal-transition'));
    expect(previewCalls).toHaveLength(1);
  });

  test('a superuser sending from a PD mailbox sees the notice and saving does not re-render', async () => {
    routeFetch({
      'POST /api/review-manager/terminal-transition': [response({ ok: true, drafts: [acceptedDraft()] })],
      [`GET ${PREFS}`]: [prefsGet(SUPERUSER)],
      [`PUT ${PREFS}`]: [response({ ok: true, kind: 'release', template: sharedTemplate })],
    });
    render(<AcceptedReviewerReleaseModal reviewer={{ suggestionId: SUGGESTION_ID }} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
    const details = await openDefaults();
    expect(within(details).getByText(/Saving here changes only your own default/)).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: 'Save as my default' }));
    await within(details).findByText('Saved as your default wording.');
    const previewCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('terminal-transition'));
    expect(previewCalls).toHaveLength(1);
  });

  test('a fallback draft shows why the Admin wording is used', async () => {
    routeFetch({
      'POST /api/review-manager/terminal-transition': [response({ ok: true, drafts: [acceptedDraft({ templateSource: 'shared_fallback', templateNotice: 'preference_invalid' })] })],
    });
    render(<AcceptedReviewerReleaseModal reviewer={{ suggestionId: SUGGESTION_ID }} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
    expect(await screen.findByText(/saved wording needs correction, so this email starts from the shared Admin wording/)).toBeInTheDocument();
  });

  test('a validation failure explains the problem and saves nothing', async () => {
    routeFetch({
      'POST /api/review-manager/terminal-transition': [response({ ok: true, drafts: [acceptedDraft()] })],
      [`GET ${PREFS}`]: [prefsGet(PD)],
      [`PUT ${PREFS}`]: [response({ ok: false, reason: 'validation', errors: ['unknown:body:externalLink'] }, { ok: false, status: 400 })],
    });
    render(<AcceptedReviewerReleaseModal reviewer={{ suggestionId: SUGGESTION_ID }} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
    const details = await openDefaults();
    fireEvent.click(within(details).getByRole('button', { name: 'Save as my default' }));
    expect(await within(details).findByText(/\{\{externalLink\}\} is not an available placeholder/)).toBeInTheDocument();
  });
});

describe('pending withdrawal dialog', () => {
  const SECOND = '33333333-3333-4333-8333-333333333333';
  function withdrawDraft(id, over = {}) {
    return {
      suggestionId: id, status: 'ok', name: `Reviewer ${id.slice(0, 2)}`, to: `${id.slice(0, 2)}@example.org`,
      from: 'pd@example.org', senderId: PD, subject: 'Admin subject', bodyText: 'Admin body', templateSource: 'shared', ...over,
    };
  }

  test('after confirmation, saving the sender default replaces every draft and clears one-off edits', async () => {
    routeFetch({
      'POST /api/review-manager/render-withdraw-emails': [
        response({ ok: true, drafts: [withdrawDraft(SUGGESTION_ID), withdrawDraft(SECOND)] }),
        response({ ok: true, drafts: [
          withdrawDraft(SUGGESTION_ID, { subject: 'PD subject', templateSource: 'personal' }),
          withdrawDraft(SECOND, { subject: 'PD subject', templateSource: 'personal' }),
        ] }),
      ],
      [`GET ${PREFS}`]: [prefsGet(PD)],
      [`PUT ${PREFS}`]: [response({ ok: true, kind: 'withdraw', template: sharedTemplate })],
    });
    render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[SUGGESTION_ID, SECOND]} onClose={jest.fn()} onReleased={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/No longer needed/));
    await waitFor(() => expect(screen.getAllByDisplayValue('Admin subject')).toHaveLength(2));
    fireEvent.change(screen.getAllByDisplayValue('Admin subject')[0], { target: { value: 'One-off' } });

    const details = await openDefaults();
    fireEvent.click(within(details).getByRole('button', { name: 'Save as my default' }));

    await waitFor(() => expect(screen.getAllByDisplayValue('PD subject')).toHaveLength(2));
    expect(window.confirm).toHaveBeenCalledWith('Replace your edits to these emails with your saved wording?');
    expect(screen.queryByDisplayValue('One-off')).not.toBeInTheDocument();
    const saves = global.fetch.mock.calls.filter(([url, init]) => String(url).startsWith(PREFS) && init?.method === 'PUT');
    expect(saves).toHaveLength(1);
  });

  test('sending never writes a preference', async () => {
    routeFetch({
      'POST /api/review-manager/render-withdraw-emails': [response({ ok: true, drafts: [withdrawDraft(SUGGESTION_ID)] })],
      'POST /api/review-manager/withdraw-sufficient': [response({ ok: true, withdrawn: 1, results: [{ suggestionId: SUGGESTION_ID, status: 'withdrawn_emailed' }] })],
    });
    render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[SUGGESTION_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/No longer needed/));
    const subject = await screen.findByDisplayValue('Admin subject');
    fireEvent.change(subject, { target: { value: 'One-off' } });
    fireEvent.click(screen.getByRole('button', { name: /Release \(1\)/ }));
    await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => String(url).includes('withdraw-sufficient'))).toBe(true));
    expect(global.fetch.mock.calls.some(([url]) => String(url).startsWith(PREFS))).toBe(false);
  });
});
