/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SiteVisitEditor, { noEmailHint, withApplicantAttendees } from '../../shared/components/meeting-tracker/SiteVisitEditor';

let routerQuery = {};
jest.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: routerQuery }) }));
jest.mock('next/link', () => function MockLink({ children, href }) {
  return <a href={typeof href === 'string' ? href : href.pathname}>{children}</a>;
});
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/meeting-tracker/RecordingAndTranscriptCard', () => ({
  __esModule: true,
  default: ({ requestId }) => <div data-testid="recording-transcript-in-editor">{requestId}</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const recipients = {
  staff: [{ ref: { kind: 'staff', profileId: 7 }, name: 'Duncan Staff', email: 'd@wmkeck.org' }, { ref: { kind: 'staff', profileId: 8 }, name: 'Chris Staff', email: 'c@wmkeck.org' }],
  board: [{ ref: { kind: 'roster', rosterId: 3 }, name: 'Board Member', email: 'b@example.org' }],
};
function response(body, status = 200) { return { ok: status < 300, status, json: async () => body }; }

beforeEach(() => {
  routerQuery = { requestId: REQUEST_ID, n: '1003222', cycleCode: 'D26', programId: 'p1' };
});

test('visit attendee chip hints distinguish linked Contact failures from manual roster email', () => {
  expect(noEmailHint({ linked: true })).toMatch(/linked Dataverse contact.*fix or relink.*unlink/i);
  expect(noEmailHint({ linked: false })).toMatch(/preferred email.*Expertise Finder roster/i);
});

test('applicant prefill deduplicates the PI and liaison and preserves existing staff, Board, and manual attendees', () => {
  const form = {
    organizer: { kind: 'staff', profileId: 7 },
    requiredAttendees: [{ kind: 'manual', name: 'Justin', email: 'justin@example.edu' }],
    optionalAttendees: [{ kind: 'roster', rosterId: 3 }],
  };
  const suggested = [
    { kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' },
    { kind: 'manual', name: 'Franklin Cat', email: 'FRANKLIN@example.edu' },
    { kind: 'manual', name: 'Board Member', email: 'b@example.org' },
  ];
  expect(withApplicantAttendees(form, suggested, recipients).requiredAttendees).toEqual([
    form.requiredAttendees[0],
    { kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' },
  ]);
});

test('existing visit offers a missing applicant as one-click Add and includes them only after Save', async () => {
  let visit = { activityId: 'a1', etag: 'W/"1"', subject: 'Site Visit', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00', timeZone: 'America/Los_Angeles', format: 100000001, locationOrLink: 'Campus', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [{ kind: 'manual', name: 'Justin', email: 'justin@example.edu' }], optionalAttendees: [] };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).includes('/recipients')) return response(recipients);
    if (String(url).endsWith('/materials')) return response({ error: 'not enabled' }, 503);
    if (options.method === 'PATCH') {
      visit = { ...visit, requiredAttendees: JSON.parse(options.body).requiredAttendees };
      return response({ success: true, siteVisit: visit });
    }
    return response({ success: true, siteVisit: visit, applicantAttendees: [{ kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' }] });
  });
  render(<SiteVisitEditor />);
  expect(await screen.findByTestId('recording-transcript-in-editor')).toHaveTextContent(REQUEST_ID);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit visit details' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add Franklin Cat (franklin@example.edu)' }));
  expect(screen.getByText(/Franklin Cat · franklin@example.edu/)).toBeInTheDocument();
  expect(screen.getByText(/Justin · justin@example.edu/)).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save site visit' }));
  const [, options] = await waitFor(() => global.fetch.mock.calls.find(([, value]) => value?.method === 'PATCH'));
  expect(JSON.parse(options.body).requiredAttendees).toEqual([
    { kind: 'manual', name: 'Justin', email: 'justin@example.edu' },
    { kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' },
  ]);
});

test('removing a saved applicant attendee and reopening shows Add without re-adding them', async () => {
  let visit = { activityId: 'a1', etag: 'W/"1"', subject: 'Site Visit', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00', timeZone: 'America/Los_Angeles', format: 100000001, locationOrLink: 'Campus', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [{ kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' }], optionalAttendees: [] };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).includes('/recipients')) return response(recipients);
    if (String(url).endsWith('/materials')) return response({ error: 'not enabled' }, 503);
    if (options.method === 'PATCH') {
      visit = { ...visit, requiredAttendees: JSON.parse(options.body).requiredAttendees };
      return response({ success: true, siteVisit: visit });
    }
    return response({ success: true, siteVisit: visit, applicantAttendees: [{ kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' }] });
  });
  const first = render(<SiteVisitEditor />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit visit details' }));
  fireEvent.click(await screen.findByRole('button', { name: /Franklin Cat · franklin@example.edu.*×/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save site visit' }));
  await waitFor(() => expect(visit.requiredAttendees).toEqual([]));
  first.unmount();

  render(<SiteVisitEditor />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit visit details' }));
  expect(await screen.findByRole('button', { name: 'Add Franklin Cat (franklin@example.edu)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Franklin Cat · franklin@example.edu.*×/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save site visit' }));
  await waitFor(() => expect(global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(2));
  const patches = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(patches[1][1].body).requiredAttendees).toEqual([]);
});

test('a new visit automatically prefills a distinct applicant attendee without saving', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/recipients')) return response(recipients);
    return response({ success: true, siteVisit: null, applicantAttendees: [{ kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' }] });
  });
  render(<SiteVisitEditor />);
  expect(await screen.findByRole('button', { name: /Franklin Cat · franklin@example.edu.*×/ })).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
});

test('a new visit: the form posts the fields the logistics service expects, with the id from the path and no activity/etag', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/recipients')) return response(recipients);
    if (target.endsWith('/materials')) return response({ error: 'not enabled' }, 503);
    if (options.method === 'PATCH') return response({ success: true, siteVisit: { activityId: 'a1', etag: 'W/"1"', subject: 'Site Visit — #1003222', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00', timeZone: 'America/Los_Angeles', format: 100000000, locationOrLink: 'Campus', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [{ kind: 'manual', name: 'PI', email: 'pi@example.edu' }], optionalAttendees: [] } });
    return response({ success: true, siteVisit: null });
  });
  render(<SiteVisitEditor />);

  expect(await screen.findByRole('heading', { name: /Schedule the site visit · #1003222/ })).toBeInTheDocument();
  expect(await screen.findByLabelText('Subject')).toHaveValue('Site Visit — #1003222');
  // Virtual by default (owner 2026-09-10).
  expect(screen.getByLabelText('Format')).toHaveValue('100000001');
  const save = screen.getByRole('button', { name: 'Schedule site visit' });
  expect(save).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-01T09:00' } });
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-01T12:00' } });
  fireEvent.change(screen.getByLabelText('Location or meeting link'), { target: { value: 'Campus' } });
  // Organizer is a single-person search picker (Site Visit redesign §3.1).
  fireEvent.change(screen.getByLabelText('Organizer'), { target: { value: 'dun' } });
  fireEvent.click(screen.getByRole('button', { name: /Choose Duncan Staff/ }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'PI' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'PI@example.edu' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByText(/PI · pi@example.edu/)).toBeInTheDocument();
  expect(save).toBeEnabled();
  fireEvent.click(save);

  await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(true));
  const [url, options] = global.fetch.mock.calls.find(([, o]) => o?.method === 'PATCH');
  expect(url).toBe(`/api/meeting-tracker/visits/${REQUEST_ID}`);
  const payload = JSON.parse(options.body);
  expect(payload).toEqual({
    subject: 'Site Visit — #1003222', description: '', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00',
    timeZone: 'America/Los_Angeles', format: 100000001, locationOrLink: 'Campus',
    organizer: { kind: 'staff', profileId: 7 },
    requiredAttendees: [{ kind: 'manual', name: 'PI', email: 'pi@example.edu' }],
    optionalAttendees: [],
  });
  expect(payload).not.toHaveProperty('requestId');
  expect(payload).not.toHaveProperty('activityId');
  expect(await screen.findAllByText('Site visit saved.')).not.toHaveLength(0);
  // Once saved, the visit returns to its read-only summary.
  expect(screen.getByRole('button', { name: 'Edit visit details' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save site visit' })).not.toBeInTheDocument();
});

test('an existing visit: the form loads it, sends activityId + etag, and a write conflict reloads with an explanation', async () => {
  const visit = { activityId: 'a1', etag: 'W/"1"', subject: 'Site Visit — #1003222', description: 'Bring slides', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00', timeZone: 'America/Los_Angeles', format: 100000001, locationOrLink: 'https://zoom.example/v', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [{ kind: 'roster', rosterId: 3 }], optionalAttendees: [{ kind: 'staff', profileId: 8 }] };
  let gets = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/recipients')) return response(recipients);
    if (target.endsWith('/presentation-materials')) return response({ error: 'not enabled' }, 503);
    if (target.endsWith('/materials')) return response({ error: 'not enabled' }, 503);
    if (options.method === 'PATCH') return response({ error: 'The Site Visit changed or a different activity is active. Reload before saving.', code: 'site_visit_write_conflict' }, 409);
    gets += 1;
    return response({ success: true, siteVisit: { ...visit, etag: gets === 1 ? 'W/"1"' : 'W/"2"' } });
  });
  render(<SiteVisitEditor />);

  expect(await screen.findByRole('heading', { name: /^Site visit · #1003222/ })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit visit details' }));
  expect(screen.getByLabelText('Location or meeting link')).toHaveValue('https://zoom.example/v');
  expect(screen.getByLabelText('Format')).toHaveValue('100000001');
  fireEvent.click(screen.getByRole('button', { name: 'Save site visit' }));

  const [, options] = await waitFor(() => global.fetch.mock.calls.find(([, o]) => o?.method === 'PATCH'));
  expect(JSON.parse(options.body)).toMatchObject({ activityId: 'a1', etag: 'W/"1"', requiredAttendees: [{ kind: 'roster', rosterId: 3 }], optionalAttendees: [{ kind: 'staff', profileId: 8 }] });
  expect(await screen.findByRole('alert')).toHaveTextContent('changed since this page loaded');
  await waitFor(() => expect(gets).toBe(2));
});

test('a saved visit opens as a read-only summary: names not ids, a short meeting link, editing only after Edit, Cancel discards', async () => {
  const visit = { activityId: 'a1', etag: 'W/"1"', subject: 'Site Visit — #1003222', description: 'Bring slides', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00', timeZone: 'America/Los_Angeles', format: 100000001, locationOrLink: 'https://zoom.example/j/123?pwd=secret', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [{ kind: 'roster', rosterId: 3 }, { kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' }], optionalAttendees: [{ kind: 'staff', profileId: 8 }] };
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/recipients')) return response(recipients);
    if (target.endsWith('/materials')) return response({ error: 'not enabled' }, 503);
    if (options.method === 'PATCH') throw new Error('no save expected');
    return response({ success: true, siteVisit: visit });
  });
  render(<SiteVisitEditor />);

  const summary = await screen.findByRole('region', { name: 'Visit details' });
  expect(summary).toHaveTextContent('Thu, Oct 1, 2026 · 9:00 AM – 12:00 PM (America/Los_Angeles)');
  expect(summary).toHaveTextContent('Duncan Staff');
  expect(summary).toHaveTextContent('Board Member, Franklin Cat');
  expect(summary).toHaveTextContent('Chris Staff');
  expect(summary).toHaveTextContent('Bring slides');
  const link = screen.getByRole('link', { name: 'Open meeting link (zoom.example)' });
  expect(link).toHaveAttribute('href', 'https://zoom.example/j/123?pwd=secret');
  expect(summary).not.toHaveTextContent('pwd=secret');
  expect(screen.queryByLabelText('Location or meeting link')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save site visit' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Edit visit details' }));
  fireEvent.change(screen.getByLabelText('Location or meeting link'), { target: { value: 'Campus' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('region', { name: 'Visit details' })).toHaveTextContent('Open meeting link (zoom.example)');
  fireEvent.click(screen.getByRole('button', { name: 'Edit visit details' }));
  expect(screen.getByLabelText('Location or meeting link')).toHaveValue('https://zoom.example/j/123?pwd=secret');
  expect(global.fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
});

describe('one attendee picker (Site Visit redesign §3.1)', () => {
  const visit = { activityId: 'a1', etag: 'W/"1"', subject: 'Site Visit — #1003222', description: '', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00', timeZone: 'America/Los_Angeles', format: 100000001, locationOrLink: 'Campus', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [{ kind: 'roster', rosterId: 3 }], optionalAttendees: [] };
  const withNoEmail = { ...recipients, staff: [...recipients.staff, { ref: { kind: 'staff', profileId: 9 }, name: 'Pat Noemail', email: '', linked: false }] };
  function route() {
    global.fetch = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/recipients')) return response(withNoEmail);
      if (target.endsWith('/materials') || target.endsWith('/presentation-materials')) return response({ error: 'not enabled' }, 503);
      if (options.method === 'PATCH') return response({ success: true, siteVisit: visit });
      return response({ success: true, siteVisit: visit });
    });
  }
  async function openEditor() {
    route();
    render(<SiteVisitEditor />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit visit details' }));
  }

  test('each person appears once; the saved roles show; add, switch role and remove send the same ref shape', async () => {
    await openEditor();
    // Not every name rendered twice: the directory is searched, not listed.
    expect(screen.queryByRole('button', { name: /Chris Staff/ })).toBeNull();
    const chosen = screen.getByRole('list', { name: 'Find a staff or Board member: chosen' });
    expect(within(chosen).getByRole('group', { name: 'Board Member: attendance' })).toBeInTheDocument();
    expect(within(chosen).getByRole('button', { name: 'Required' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Find a staff or Board member'), { target: { value: 'chris' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Chris Staff/ }));
    fireEvent.click(within(within(chosen).getByRole('group', { name: 'Chris Staff: attendance' })).getByRole('button', { name: 'Optional' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Board Member' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save site visit' }));
    await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(true));
    const payload = JSON.parse(global.fetch.mock.calls.find(([, o]) => o?.method === 'PATCH')[1].body);
    expect(payload.requiredAttendees).toEqual([]);
    expect(payload.optionalAttendees).toEqual([{ kind: 'staff', profileId: 8 }]);
    expect(payload.organizer).toEqual({ kind: 'staff', profileId: 7 });
  });

  test('a person with no email is listed but cannot be added, with the reason on hover', async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText('Find a staff or Board member'), { target: { value: 'pat' } });
    const option = screen.getByRole('button', { name: /Add Pat Noemail · no email/ });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute('title', noEmailHint({ linked: false }));
  });

  describe('the 100-per-list limit, manual applicant rows included (Codex review, commit 6)', () => {
    const manualRows = (n, prefix) => Array.from({ length: n }, (_, i) => ({ kind: 'manual', name: `${prefix} ${i}`, email: `${prefix}${i}@example.edu` }));
    async function openWith(required, optional) {
      const full = { ...visit, requiredAttendees: required, optionalAttendees: optional };
      global.fetch = jest.fn(async (url, options = {}) => {
        const target = String(url);
        if (target.includes('/recipients')) return response(withNoEmail);
        if (target.endsWith('/materials') || target.endsWith('/presentation-materials')) return response({ error: 'not enabled' }, 503);
        if (options.method === 'PATCH') return response({ success: true, siteVisit: full });
        return response({ success: true, siteVisit: full });
      });
      render(<SiteVisitEditor />);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit visit details' }));
    }
    const saved = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save site visit' }));
      await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(true));
      return JSON.parse(global.fetch.mock.calls.find(([, o]) => o?.method === 'PATCH')[1].body);
    };

    test('with Required full, a new person is added to Optional', async () => {
      await openWith(manualRows(100, 'r'), []);
      fireEvent.change(screen.getByLabelText('Find a staff or Board member'), { target: { value: 'chris' } });
      fireEvent.click(screen.getByRole('button', { name: /Add Chris Staff/ }));
      const payload = await saved();
      expect(payload.requiredAttendees).toHaveLength(100);
      expect(payload.optionalAttendees).toEqual([{ kind: 'staff', profileId: 8 }]);
    });

    test('a role change into a full list is refused and leaves the selection as it was', async () => {
      await openWith([{ kind: 'roster', rosterId: 3 }], manualRows(100, 'o'));
      const toggle = within(screen.getByRole('group', { name: 'Board Member: attendance' })).getByRole('button', { name: 'Optional' });
      expect(toggle).toBeDisabled();
      expect(toggle).toHaveAttribute('title', 'The Optional list is full.');
      fireEvent.click(toggle);
      const payload = await saved();
      expect(payload.requiredAttendees).toEqual([{ kind: 'roster', rosterId: 3 }]);
      expect(payload.optionalAttendees).toHaveLength(100);
    });

    test('with both lists full the search is disabled', async () => {
      await openWith(manualRows(100, 'r'), manualRows(100, 'o'));
      expect(screen.getByLabelText('Find a staff or Board member')).toBeDisabled();
      expect(screen.getByText('Both attendee lists are full.')).toBeInTheDocument();
    });
  });

  test('the organizer can be changed through its picker', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Change organizer' }));
    fireEvent.change(screen.getByLabelText('Organizer'), { target: { value: 'chris' } });
    fireEvent.click(screen.getByRole('button', { name: /Choose Chris Staff/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save site visit' }));
    await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(true));
    expect(JSON.parse(global.fetch.mock.calls.find(([, o]) => o?.method === 'PATCH')[1].body).organizer).toEqual({ kind: 'staff', profileId: 8 });
  });
});
