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
  await screen.findByLabelText('Default subject');
  return details;
}

beforeEach(() => {
  window.confirm = jest.fn(() => true);
});

afterEach(() => jest.restoreAllMocks());

describe('accepted release dialog', () => {
  test('saving the sender default preserves the email, unsaved note, and original notes baseline', async () => {
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
    fireEvent.change(within(details).getByLabelText('Default subject'), { target: { value: 'PD subject' } });
    fireEvent.click(within(details).getByRole('button', { name: 'Save as my default' }));

    await within(details).findByText('Saved for future emails. The current email is unchanged.');
    expect(screen.getAllByLabelText('Subject')[0]).toHaveValue('Admin subject');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(note).toHaveValue('My unsaved note');

    fireEvent.click(screen.getByRole('button', { name: 'Release reviewer' }));
    await waitFor(() => expect(onRelease).toHaveBeenCalled());
    const payload = onRelease.mock.calls[0][0];
    expect(payload.internalNotes).toEqual({ [SUGGESTION_ID]: 'My unsaved note' });
    expect(payload.overrides[SUGGESTION_ID]).toMatchObject({
      expectedNotes: 'Existing note',
      subject: 'Admin subject',
      bodyText: 'Admin body',
      senderId: PD,
    });
  });

  test('saving a default preserves edited email copy without replacement confirmation', async () => {
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

    await within(details).findByText('Saved for future emails. The current email is unchanged.');
    expect(window.confirm).not.toHaveBeenCalled();
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
    await within(details).findByText('Saved for future emails. The current email is unchanged.');
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

  test('saving the sender default preserves every draft and one-off edits', async () => {
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

    await within(details).findByText('Saved for future emails. The current email is unchanged.');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('One-off')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Admin subject')).toHaveLength(2);
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('render-withdraw-emails'))).toHaveLength(1);
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

describe('a slow Save locks the dialog until it settles (Codex build review)', () => {
  function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  }

  test('accepted release: email fields and Release are locked while saving, then the current email remains intact', async () => {
    const save = deferred();
    routeFetch({
      'POST /api/review-manager/terminal-transition': [
        response({ ok: true, drafts: [acceptedDraft()] }),
        response({ ok: true, drafts: [acceptedDraft({ subject: 'PD subject', templateSource: 'personal' })] }),
      ],
      [`GET ${PREFS}`]: [prefsGet(PD)],
      [`PUT ${PREFS}`]: [() => save.promise],
    });
    const onRelease = jest.fn();
    render(<AcceptedReviewerReleaseModal reviewer={{ suggestionId: SUGGESTION_ID }} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={onRelease} />);
    const details = await openDefaults();
    fireEvent.click(within(details).getByRole('button', { name: 'Save as my default' }));

    await waitFor(() => expect(screen.getAllByLabelText('Subject')[0]).toBeDisabled());
    expect(screen.getAllByLabelText('Message')[0]).toBeDisabled();
    const release = screen.getByRole('button', { name: 'Release reviewer' });
    expect(release).toBeDisabled();
    fireEvent.click(release);
    expect(onRelease).not.toHaveBeenCalled();

    save.resolve(response({ ok: true, kind: 'release', template: sharedTemplate }));
    await within(details).findByText('Saved for future emails. The current email is unchanged.');
    expect(screen.getAllByLabelText('Subject')[0]).toHaveValue('Admin subject');
    expect(screen.getAllByLabelText('Subject')[0]).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Release reviewer' })).not.toBeDisabled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  test('pending withdrawal: drafts and Release are locked while saving, then preserve current drafts', async () => {
    const save = deferred();
    routeFetch({
      'POST /api/review-manager/render-withdraw-emails': [
        response({ ok: true, drafts: [{
          suggestionId: SUGGESTION_ID, status: 'ok', name: 'R', to: 'r@example.org', from: 'pd@example.org',
          senderId: PD, subject: 'Admin subject', bodyText: 'Admin body', templateSource: 'shared',
        }] }),
        response({ ok: true, drafts: [{
          suggestionId: SUGGESTION_ID, status: 'ok', name: 'R', to: 'r@example.org', from: 'pd@example.org',
          senderId: PD, subject: 'PD subject', bodyText: 'PD body', templateSource: 'personal',
        }] }),
      ],
      [`GET ${PREFS}`]: [prefsGet(PD)],
      [`PUT ${PREFS}`]: [() => save.promise],
    });
    render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[SUGGESTION_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/No longer needed/));
    const draftSubject = await screen.findByDisplayValue('Admin subject');
    const details = await openDefaults();
    fireEvent.click(within(details).getByRole('button', { name: 'Save as my default' }));

    await waitFor(() => expect(draftSubject).toBeDisabled());
    const release = screen.getByRole('button', { name: /Release \(1\)/ });
    expect(release).toBeDisabled();
    fireEvent.click(release);
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('withdraw-sufficient'))).toBe(false);

    save.resolve(response({ ok: true, kind: 'withdraw', template: sharedTemplate }));
    await within(details).findByText('Saved for future emails. The current email is unchanged.');
    expect(draftSubject).toHaveValue('Admin subject');
    expect(draftSubject).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Release \(1\)/ })).not.toBeDisabled();
  });
});
