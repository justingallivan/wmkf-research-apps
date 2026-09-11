/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppCard, getServerSideProps as getLandingProps } from '../../pages/index';
import MeetingTrackerList, { MeetingTrackerRequestRow } from '../../shared/components/meeting-tracker/MeetingTrackerList';

let routerQuery = {};
const routerReplace = jest.fn(async () => true);
jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: routerQuery, replace: routerReplace, pathname: '/meeting-tracker' }),
}));
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
jest.mock('next/link', () => function MockLink({ children, href }) {
  return <a href={typeof href === 'string' ? href : href.pathname}>{children}</a>;
});
import { moveSlot, ProposalOrderList, reorderSessionSlots, slotBriefingText } from '../../shared/components/meeting-tracker/SessionEditor';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_SLOT_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_SLOT_ID = '33333333-3333-4333-8333-333333333333';

function proposal(overrides = {}) {
  return {
    requestId: '44444444-4444-4444-8444-444444444444',
    requestNumber: '1002003',
    title: 'Programmable tissue repair',
    programDirector: 'Alex Staff',
    projectLeader: 'Jordan Investigator',
    shareState: { lifecycleLabel: 'Ready for review' },
    deliberation: {
      sessionId: SESSION_ID,
      scheduledStartIso: '2026-09-14T16:00:00.000Z',
      order: 2,
      minutes: 15,
      meetingLink: '',
    },
    siteVisit: null,
    needsScheduling: true,
    ...overrides,
  };
}

test('list row links to the tracker\'s visit editor with the request number and cycle context (slice 2b)', () => {
  render(<MeetingTrackerRequestRow proposal={proposal({ siteVisit: null })} cycleCode="D26" programId="p1" />);
  expect(screen.getByRole('link', { name: 'Schedule visit' }))
    .toHaveAttribute('href', `/meeting-tracker/visits/${proposal().requestId}?cycleCode=D26&programId=p1&n=1002003`);
});

test('list row shows scheduling and missing-link cues when either meeting is missing', () => {
  const { rerender } = render(<MeetingTrackerRequestRow proposal={proposal()} cycleCode="D26" programId={SESSION_ID} />);

  expect(screen.getByText('Needs scheduling')).toBeInTheDocument();
  expect(screen.getByText('No link')).toBeInTheDocument();
  expect(screen.getByText('No site visit')).toBeInTheDocument();

  rerender(<MeetingTrackerRequestRow proposal={proposal({
    deliberation: null,
    siteVisit: { scheduledStartIso: '2026-09-16T18:00:00.000Z', formatLabel: 'In person', location: 'Los Angeles' },
  })} cycleCode="D26" programId={SESSION_ID} />);
  expect(screen.getByText('Needs scheduling')).toBeInTheDocument();
  expect(screen.getByText('No session')).toBeInTheDocument();
});

test('valid meeting link renders as a protected Join link and complete rows omit the cue', () => {
  render(<MeetingTrackerRequestRow proposal={proposal({
    deliberation: { ...proposal().deliberation, meetingLink: 'https://zoom.us/j/123' },
    siteVisit: { scheduledStartIso: '2026-09-16T18:00:00.000Z', formatLabel: 'In person', location: 'Los Angeles' },
    needsScheduling: false,
  })} cycleCode="D26" programId={SESSION_ID} />);

  expect(screen.queryByText('Needs scheduling')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('rel', 'noopener noreferrer');
});

test('session reorder posts every slot with its current ETag and complete new order', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ slots: [] }) }));
  await reorderSessionSlots({
    sessionId: SESSION_ID,
    slots: [
      { wmkf_deliberationslotid: SECOND_SLOT_ID, _etag: 'W/"2"' },
      { wmkf_deliberationslotid: FIRST_SLOT_ID, _etag: 'W/"1"' },
    ],
    fetchImpl,
  });

  expect(fetchImpl).toHaveBeenCalledWith('/api/meeting-tracker/slots/reorder', expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({
      sessionId: SESSION_ID,
      slots: [
        { slotId: SECOND_SLOT_ID, etag: 'W/"2"', order: 1 },
        { slotId: FIRST_SLOT_ID, etag: 'W/"1"', order: 2 },
      ],
    }),
  }));
});

test('landing tile remains visible and disabled while readiness is unset', async () => {
  const previous = process.env.MEETING_TRACKER_SCHEMA_READY;
  delete process.env.MEETING_TRACKER_SCHEMA_READY;
  await expect(getLandingProps()).resolves.toEqual({
    props: { runtimeAppStatus: { 'meeting-tracker': 'not-ready' } },
  });
  if (previous === undefined) delete process.env.MEETING_TRACKER_SCHEMA_READY;
  else process.env.MEETING_TRACKER_SCHEMA_READY = previous;

  render(<AppCard app={{
    id: 'meeting-tracker',
    title: 'Meeting Tracker',
    description: 'Plan deliberation sessions.',
    icon: 'MT',
    status: 'not-ready',
    path: '/meeting-tracker',
  }} />);
  expect(screen.getAllByText('Not yet enabled')).toHaveLength(2);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('arriving with a cycle in the URL still loads the cycle picker (the session page links back this way)', async () => {
  routerQuery = { cycleCode: 'D26', programId: 'p1' };
  global.fetch = jest.fn(async (url) => {
    const target = String(url);
    const body = target.includes('/sessions')
      ? { sessions: [] }
      : target.includes('cycleCode=')
        ? { programs: [{ id: 'p1', name: 'Research' }], programId: 'p1', cycleCode: 'D26', proposals: [], notices: [] }
        : { programs: [{ id: 'p1', name: 'Research' }], programId: 'p1', cycles: [{ code: 'D26', label: 'December 2026' }, { code: 'J27', label: 'June 2027' }], defaultCycleCode: 'D26' };
    return { ok: true, status: 200, json: async () => body };
  });
  render(<MeetingTrackerList />);

  const cycleSelect = await screen.findByLabelText('Grant cycle');
  await waitFor(() => expect(cycleSelect).toBeEnabled());
  expect(cycleSelect).toHaveValue('D26');
  expect(screen.getByRole('option', { name: 'June 2027' })).toBeInTheDocument();
  // Discriminating: the picker payload was fetched once, without a cycle.
  const pickerCalls = global.fetch.mock.calls.filter(([u]) => String(u).includes('/dashboard') && !String(u).includes('cycleCode='));
  expect(pickerCalls).toHaveLength(1);
});

test('a slot without a live briefing link says who shares it; with one it offers Open briefing', () => {
  expect(slotBriefingText({ briefing: null })).toMatch(/not yet shared.*lead PD shares the writeup/);
  expect(slotBriefingText({ briefing: { url: 'https://apps.test/external/briefing/t' } })).toBe('Open briefing');
});

describe('moveSlot', () => {
  test('moves an item forward', () => {
    expect(moveSlot(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  test('moves an item backward', () => {
    expect(moveSlot(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  test('returns the same array reference when from equals to', () => {
    const input = ['a', 'b', 'c'];
    expect(moveSlot(input, 1, 1)).toBe(input);
  });

  test('returns the same array reference for an out-of-range index', () => {
    const input = ['a', 'b', 'c'];
    expect(moveSlot(input, 0, 5)).toBe(input);
    expect(moveSlot(input, -1, 1)).toBe(input);
  });

  test('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    moveSlot(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

describe('ProposalOrderList drag-and-drop', () => {
  function orderSlot(id, etag) {
    return { wmkf_deliberationslotid: id, _etag: etag, _wmkf_request_value: id, wmkf_minutes: 15 };
  }

  function renderList(onReorder, { busy = false } = {}) {
    const slots = [orderSlot('slot-a', 'W/"1"'), orderSlot('slot-b', 'W/"2"'), orderSlot('slot-c', 'W/"3"')];
    const { container } = render(
      <ProposalOrderList
        slots={slots}
        proposalById={new Map()}
        leadOptions={[]}
        sessions={[]}
        sessionId={SESSION_ID}
        busy={busy}
        onShift={jest.fn()}
        onChange={jest.fn()}
        onMove={jest.fn()}
        onRemove={jest.fn()}
        onReorder={onReorder}
      />,
    );
    return { container, slots };
  }

  test('dragging row 3\'s handle onto row 1 reorders the list and calls onReorder', () => {
    const onReorder = jest.fn();
    const { container, slots } = renderList(onReorder);
    const rows = container.querySelectorAll('li');
    const handles = container.querySelectorAll('[draggable="true"]');
    expect(rows).toHaveLength(3);
    expect(handles).toHaveLength(3);

    jest.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100 });

    // React's synthetic drag events only need the native event type to fire; the
    // MouseEvent constructor (unlike jsdom's DragEvent init dict) reliably applies
    // `clientY`, which the drop-edge calculation depends on.
    fireEvent(handles[2], new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    fireEvent(rows[0], new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 5 }));
    fireEvent(rows[0], new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 5 }));

    expect(onReorder).toHaveBeenCalledTimes(1);
    const [nextSlots, movedSlot, targetIndex] = onReorder.mock.calls[0];
    expect(nextSlots.map((slot) => slot.wmkf_deliberationslotid)).toEqual(['slot-c', 'slot-a', 'slot-b']);
    expect(nextSlots.map((slot) => slot._etag)).toEqual(['W/"3"', 'W/"1"', 'W/"2"']);
    expect(movedSlot).toBe(slots[2]);
    expect(targetIndex).toBe(0);
  });

  test('drop is a no-op when nothing is being dragged', () => {
    const onReorder = jest.fn();
    const { container } = renderList(onReorder);
    const rows = container.querySelectorAll('li');
    fireEvent(rows[0], new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 5 }));
    expect(onReorder).not.toHaveBeenCalled();
  });

  test('dragging row 1 onto the lower half of the last row moves it to the end', () => {
    const onReorder = jest.fn();
    const { container, slots } = renderList(onReorder);
    const rows = container.querySelectorAll('li');
    const handles = container.querySelectorAll('[draggable="true"]');

    jest.spyOn(rows[2], 'getBoundingClientRect').mockReturnValue({ top: 80, height: 40, bottom: 120, left: 0, right: 100, width: 100 });

    fireEvent(handles[0], new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    fireEvent(rows[2], new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 115 }));
    fireEvent(rows[2], new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 115 }));

    expect(onReorder).toHaveBeenCalledTimes(1);
    const [nextSlots, movedSlot, targetIndex] = onReorder.mock.calls[0];
    expect(nextSlots.map((slot) => slot.wmkf_deliberationslotid)).toEqual(['slot-b', 'slot-c', 'slot-a']);
    expect(nextSlots.map((slot) => slot._etag)).toEqual(['W/"2"', 'W/"3"', 'W/"1"']);
    expect(movedSlot).toBe(slots[0]);
    expect(targetIndex).toBe(2);
  });

  test('dragging row 1 onto the upper half of the last row moves it just before it', () => {
    const onReorder = jest.fn();
    const { container, slots } = renderList(onReorder);
    const rows = container.querySelectorAll('li');
    const handles = container.querySelectorAll('[draggable="true"]');

    jest.spyOn(rows[2], 'getBoundingClientRect').mockReturnValue({ top: 80, height: 40, bottom: 120, left: 0, right: 100, width: 100 });

    fireEvent(handles[0], new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    fireEvent(rows[2], new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 90 }));
    fireEvent(rows[2], new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 90 }));

    expect(onReorder).toHaveBeenCalledTimes(1);
    const [nextSlots, movedSlot, targetIndex] = onReorder.mock.calls[0];
    expect(nextSlots.map((slot) => slot.wmkf_deliberationslotid)).toEqual(['slot-b', 'slot-a', 'slot-c']);
    expect(movedSlot).toBe(slots[0]);
    expect(targetIndex).toBe(1);
  });

  test('dropping a row onto its own lower half is a no-op', () => {
    const onReorder = jest.fn();
    const { container } = renderList(onReorder);
    const rows = container.querySelectorAll('li');
    const handles = container.querySelectorAll('[draggable="true"]');

    jest.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100 });

    fireEvent(handles[1], new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    fireEvent(rows[0], new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 30 }));
    fireEvent(rows[0], new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 30 }));

    expect(onReorder).not.toHaveBeenCalled();
  });

  test('while busy, no handle is draggable and the drag sequence is inert', () => {
    const onReorder = jest.fn();
    const { container } = renderList(onReorder, { busy: true });
    const rows = container.querySelectorAll('li');
    const draggableHandles = container.querySelectorAll('[draggable="true"]');
    const handles = container.querySelectorAll('.cursor-grab');
    expect(draggableHandles).toHaveLength(0);

    jest.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100 });
    fireEvent(handles[2], new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    fireEvent(rows[0], new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 5 }));
    fireEvent(rows[0], new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 5 }));

    expect(onReorder).not.toHaveBeenCalled();
  });

  test('the drag handle covers only the grip and index, not the row, arrows, or form controls', () => {
    const { container } = renderList(jest.fn());
    const draggableElements = container.querySelectorAll('[draggable="true"]');
    expect(draggableElements).toHaveLength(3);
    draggableElements.forEach((handle) => {
      expect(handle.tagName).not.toBe('LI');
      expect(handle.querySelector('button')).toBeNull();
      expect(handle.querySelector('input')).toBeNull();
      expect(handle.querySelector('select')).toBeNull();
    });
    expect(container.querySelectorAll('li[draggable="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[draggable="true"], select[draggable="true"], button[draggable="true"]')).toHaveLength(0);
  });
});
