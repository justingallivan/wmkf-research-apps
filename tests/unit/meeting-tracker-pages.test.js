/** @jest-environment jsdom */

jest.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { email: 'pc@example.org' } } }) }));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  Button: ({ children, variant, size, loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('next/link', () => function MockLink({ children, href }) {
  return <a href={typeof href === 'string' ? href : href.pathname}>{children}</a>;
});
let mockDndHandlers;
jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children, ...handlers }) => { mockDndHandlers = handlers; return children; },
  Droppable: ({ children, droppableId }) => children({ innerRef: () => {}, droppableProps: { 'data-droppable-id': droppableId }, placeholder: null }),
  Draggable: ({ children, draggableId, isDragDisabled }) => children({ innerRef: () => {}, draggableProps: { 'data-drag-id': draggableId }, dragHandleProps: isDragDisabled ? null : { tabIndex: 0, role: 'button', 'data-handle-id': draggableId } }, { isDragging: false }),
}));
function simulateAgendaDrop(container, from, to) {
  const rows = container.querySelectorAll('[data-drag-id]');
  const draggableId = rows[from].getAttribute('data-drag-id');
  const droppableId = rows[from].closest('[data-droppable-id]').getAttribute('data-droppable-id');
  act(() => mockDndHandlers.onDragStart({ draggableId }));
  act(() => mockDndHandlers.onDragEnd({ draggableId, source: { index: from, droppableId }, destination: to === null ? null : { index: to, droppableId } }));
}
import SessionEditor, { moveSlot, noEmailHint, ProposalOrderList, reorderSessionSlots, slotBriefingText } from '../../shared/components/meeting-tracker/SessionEditor';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_SLOT_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_SLOT_ID = '33333333-3333-4333-8333-333333333333';

function proposal(overrides = {}) {
  return {
    requestId: '44444444-4444-4444-8444-444444444444',
    requestNumber: '1002003',
    title: 'Programmable tissue repair',
    materialsAvailability: 'available',
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
  expect(screen.getByRole('link', { name: /Schedule research presentation/ }))
    .toHaveAttribute('href', `/meeting-tracker/visits/${proposal().requestId}?cycleCode=D26&programId=p1&n=1002003`);
  expect(screen.getByRole('link', { name: /Schedule research presentation/ }))
    .toHaveAttribute('data-full-page-navigation', 'true');
});

test('list row puts the institution beside the request number and labels the PD and PI', () => {
  const { rerender } = render(<MeetingTrackerRequestRow proposal={proposal({ institution: 'Caltech' })} cycleCode="D26" programId="p1" />);
  expect(screen.getByRole('heading', { name: '#1002003' }).nextElementSibling).toHaveTextContent('Caltech');
  expect(screen.getByText('PD: Alex Staff · PI: Jordan Investigator')).toBeInTheDocument();
  rerender(<MeetingTrackerRequestRow proposal={proposal({ institution: null, programDirector: null, projectLeader: null })} cycleCode="D26" programId="p1" />);
  expect(screen.getByText('PD: Not assigned')).toBeInTheDocument();
  expect(screen.queryByText('Caltech')).not.toBeInTheDocument();
});

test('a saved visit is labeled as the workspace entry, while a missing visit only offers scheduling', () => {
  const { rerender } = render(<MeetingTrackerRequestRow proposal={proposal({ siteVisit: { activityId: 'visit-1' } })} cycleCode="D26" programId="p1" />);
  expect(screen.getByRole('link', { name: /Open research presentation/ })).toHaveAttribute('href', expect.stringContaining('/meeting-tracker/visits/'));
  rerender(<MeetingTrackerRequestRow proposal={proposal({ siteVisit: null })} cycleCode="D26" programId="p1" />);
  expect(screen.getByRole('link', { name: /Schedule research presentation/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Open research presentation/ })).not.toBeInTheDocument();
});

test('compact rows keep both scheduling actions visible and logistics in the detail workspace', () => {
  const { rerender } = render(<MeetingTrackerRequestRow proposal={proposal()} cycleCode="D26" programId={SESSION_ID} />);
  expect(screen.getByRole('link', { name: /Open session/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Schedule research presentation/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Join' })).not.toBeInTheDocument();
  expect(screen.getByText('PD: Alex Staff · PI: Jordan Investigator')).toBeVisible();
  expect(screen.queryByText('People and share status')).not.toBeInTheDocument();
  expect(screen.queryByText('Ready for review')).not.toBeInTheDocument();
  rerender(<MeetingTrackerRequestRow proposal={proposal({ deliberation: null, siteVisit: { scheduledStartIso: '2026-09-16T18:00:00.000Z' } })} cycleCode="D26" programId={SESSION_ID} />);
  expect(screen.getByRole('link', { name: /Schedule session/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open research presentation/ })).toBeInTheDocument();
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
  const cycleCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/dashboard') && String(u).includes('cycleCode='));
  expect(new URL(String(cycleCall[0]), 'https://example.org').searchParams.get('projection')).toBe('schedule');
  expect(new URL(String(pickerCalls[0][0]), 'https://example.org').searchParams.get('projection')).toBe('schedule');
});

test('SessionEditor uses the schedule projection for its proposal lookup', async () => {
  routerQuery = { id: 'new', cycleCode: 'D26', programId: 'p1' };
  global.fetch = jest.fn(async (url) => {
    const target = String(url);
    const body = target.includes('/recipients')
      ? { staff: [], board: [], defaultAttendeeRefs: [] }
      : target.includes('/sessions')
        ? { sessions: [] }
        : { proposals: [] };
    return { ok: true, status: 200, json: async () => body };
  });
  render(<SessionEditor />);
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/dashboard?'))).toBe(true));
  const dashboardCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/dashboard?'));
  expect(new URL(String(dashboardCall[0]), 'https://example.org').searchParams.get('projection')).toBe('schedule');
});

test('a slot without a live briefing link says who shares it; with one it offers Open briefing', () => {
  expect(slotBriefingText({ briefing: null })).toBe('Briefing link unavailable');
  expect(slotBriefingText({ briefing: { url: 'https://apps.test/external/briefing/t' } })).toBe('Open briefing');
});

test('a saved site visit offers the recording workspace with request and cycle context', () => {
  const row = proposal({ siteVisit: { activityId: 'visit-1' } });
  const slot = { wmkf_deliberationslotid: FIRST_SLOT_ID, _wmkf_request_value: row.requestId, wmkf_minutes: 15, briefing: null };
  render(<ProposalOrderList slots={[slot]} proposalById={new Map([[row.requestId.toLowerCase(), row]])} sessions={[]} sessionId={SESSION_ID} cycleCode="D26" programId="p1" busy={false} savingSlotId={null} readOnly />);
  expect(screen.getByRole('link', { name: 'Open research presentation · recording and transcript' })).toHaveAttribute('href',
    `/meeting-tracker/visits/${row.requestId}?cycleCode=D26&programId=p1&n=1002003#recording-and-transcript-card`);
  expect(screen.getByRole('link', { name: 'Check Staff Deliberations' })).toHaveAttribute('href', `/workbench/${row.requestId}?tab=staff-deliberations&n=1002003`);
});

test('session attendee chip hints distinguish linked Contact failures from manual roster email', () => {
  expect(noEmailHint({ linked: true })).toMatch(/linked Dataverse contact.*fix or relink.*unlink/i);
  expect(noEmailHint({ linked: false })).toMatch(/preferred email.*Expertise Finder roster/i);
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

  function renderList(onReorder, { busy = false, savingSlotId = null } = {}) {
    const slots = [orderSlot('slot-a', 'W/"1"'), orderSlot('slot-b', 'W/"2"'), orderSlot('slot-c', 'W/"3"')];
    const { container } = render(
      <ProposalOrderList
        slots={slots}
        proposalById={new Map()}
        sessions={[]}
        sessionId={SESSION_ID}
        busy={busy}
        savingSlotId={savingSlotId}
        onChange={jest.fn()}
        onMove={jest.fn()}
        onRemove={jest.fn()}
        onReorder={onReorder}
      />,
    );
    return { container, slots };
  }

  test.each([[2,0,['slot-c','slot-a','slot-b']], [0,2,['slot-b','slot-c','slot-a']], [0,1,['slot-b','slot-a','slot-c']]])('library drop from %s to %s preserves IDs and ETags', (from,to,expected) => {
    const onReorder=jest.fn();const {container,slots}=renderList(onReorder);
    simulateAgendaDrop(container,from,to);
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder.mock.calls[0][0]).toEqual(expected.map(id=>slots.find(row=>row.wmkf_deliberationslotid===id)));
    expect(onReorder.mock.calls[0][1]).toBe(slots[from]);
    expect(onReorder.mock.calls[0][2]).toBe(to);
  });
  test.each([null,1])('cancel or same-position drop does not save: %s', to => {
    const onReorder=jest.fn();const {container}=renderList(onReorder);simulateAgendaDrop(container,1,to);expect(onReorder).not.toHaveBeenCalled();
  });
  test('busy controls cannot initiate a library move or save a drop',()=>{
    const onReorder=jest.fn();const {container}=renderList(onReorder,{busy:true});
    expect(container.querySelectorAll('[data-handle-id]')).toHaveLength(0);
    simulateAgendaDrop(container,2,0);expect(onReorder).not.toHaveBeenCalled();
  });
  test.each(['etag','membership','session'])('a %s change during a drag refuses the stale move', change=>{
    const onReorder=jest.fn();const slots=[orderSlot('slot-a','v1'),orderSlot('slot-b','v1'),orderSlot('slot-c','v1')];
    // Update the same mounted instance rather than remounting its drag ref.
    const viewProps={slots,proposalById:new Map(),sessions:[],sessionId:SESSION_ID,busy:false,onChange:jest.fn(),onMove:jest.fn(),onRemove:jest.fn(),onReorder};
    // Use a separate mounted list to make the initial and updated renders explicit.
    const view=render(<ProposalOrderList {...viewProps}/>);
    act(()=>mockDndHandlers.onDragStart({draggableId:'slot-c'}));
    const updated=change==='etag'?slots.map((row,i)=>i===1?{...row,_etag:'new'}:row):change==='membership'?slots.slice(1):slots;
    view.rerender(<ProposalOrderList {...viewProps} slots={updated} sessionId={change==='session'?'other':SESSION_ID}/>);
    act(()=>mockDndHandlers.onDragEnd({draggableId:'slot-c',source:{index:2,droppableId:`session-${SESSION_ID}`},destination:{index:0,droppableId:`session-${SESSION_ID}`}}));
    expect(onReorder).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('agenda changed');
  });

  test('no arrow buttons remain; the position select lets keyboard users move any distance in one save', async () => {
    const onReorder = jest.fn();
    const { container } = renderList(onReorder);
    expect(screen.queryByRole('button', { name: /move.*(up|down)/i })).not.toBeInTheDocument();

    expect(screen.queryByRole('combobox', { name: 'Position of #slot-a' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /More actions for #/ })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change position…' }));
    const select = screen.getByRole('combobox', { name: 'Position of #slot-a' });
    expect(select.querySelectorAll('option')).toHaveLength(3);
    fireEvent.change(select, { target: { value: '3' } });

    expect(onReorder).toHaveBeenCalledTimes(1);
    const [nextSlots, movedSlot, targetIndex] = onReorder.mock.calls[0];
    expect(nextSlots.map((slot) => slot.wmkf_deliberationslotid)).toEqual(['slot-b', 'slot-c', 'slot-a']);
    expect(movedSlot.wmkf_deliberationslotid).toBe('slot-a');
    expect(targetIndex).toBe(2);
    expect(screen.queryByRole('combobox', { name: 'Position of #slot-a' })).not.toBeInTheDocument();
  });

  test('the overflow menu exposes exactly Change position, Move to another session, and Remove', async () => {
    renderList(jest.fn());
    fireEvent.click(screen.getAllByRole('button', { name: /More actions for #/ })[0]);
    const menuItems = await screen.findAllByRole('menuitem');
    expect(menuItems.map((item) => item.textContent)).toEqual(['Change position…', 'Move to another session…', 'Remove…']);
  });

  test('each row shows its position once, in the header beside the request number', () => {
    const { container } = renderList(jest.fn());
    const headers = [...container.querySelectorAll('li p.font-semibold')].map((node) => node.textContent);
    expect(headers).toEqual(['Position 1 · #slot-a', 'Position 2 · #slot-b', 'Position 3 · #slot-c']);
    expect(container.querySelectorAll('select')).toHaveLength(0); // no position select in the gutter, no Lead PD select
  });

  test('Remove is not called until the inline confirm panel\'s Remove is clicked (menu select alone must not remove)', async () => {
    const onRemove = jest.fn();
    const slots = [orderSlot('slot-a', 'W/"1"'), orderSlot('slot-b', 'W/"2"'), orderSlot('slot-c', 'W/"3"')];
    render(
      <ProposalOrderList
        slots={slots}
        proposalById={new Map()}
        sessions={[]}
        sessionId={SESSION_ID}
        busy={false}
        savingSlotId={null}
        onChange={jest.fn()}
        onMove={jest.fn()}
        onRemove={onRemove}
        onReorder={jest.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /More actions for #/ })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove…' }));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(slots[0]);
  });

  test('while busy, the row that initiated the save is opacity-70 and its controls disabled; other rows only disable', () => {
    const { container } = renderList(jest.fn(), { busy: true, savingSlotId: 'slot-b' });
    const rows = container.querySelectorAll('li');
    expect(rows[1]).toHaveClass('opacity-70');
    expect(rows[0]).not.toHaveClass('opacity-70');
    container.querySelectorAll('input[type="number"]').forEach((input) => expect(input).toBeDisabled());
    // The More actions trigger is a load-bearing guard: an enabled Change position…
    // select would fire a second reorder PATCH against ETags the pending refetch
    // is about to invalidate.
    const menuButtons = screen.getAllByRole('button', { name: /More actions for #/ });
    expect(menuButtons).toHaveLength(3);
    menuButtons.forEach((button) => expect(button).toBeDisabled());
  });

  test('the institution renders under the title from the slot (session read), falling back to the cycle dashboard, and is omitted otherwise', () => {
    const slots = [{ ...orderSlot('slot-a', 'W/"1"'), institution: 'Caltech' }, orderSlot('slot-b', 'W/"2"'), { ...orderSlot('slot-c', 'W/"3"'), institution: null }];
    const proposalById = new Map([['slot-a', { requestNumber: '1001', title: 'Proposal A', institution: 'Stale dashboard name' }], ['slot-b', { requestNumber: '1002', title: 'Proposal B', institution: null }], ['slot-c', { requestNumber: '1003', title: 'Proposal C', institution: 'UCLA' }]]);
    render(
      <ProposalOrderList slots={slots} proposalById={proposalById} sessions={[]} sessionId={SESSION_ID} busy={false} savingSlotId={null} onChange={jest.fn()} onMove={jest.fn()} onRemove={jest.fn()} onReorder={jest.fn()} />,
    );
    const institution = screen.getByText('Caltech');
    expect(institution.previousElementSibling).toHaveTextContent('Proposal A');
    expect(institution.nextElementSibling).toHaveTextContent('Lead PD: Not assigned');
    expect(screen.queryByText('Stale dashboard name')).not.toBeInTheDocument();
    expect(screen.getByText('UCLA')).toBeInTheDocument();
    expect(screen.getAllByText(/^Lead PD:/)).toHaveLength(3);
  });

  test('the lead PD is display-only on the row: no select, one "Lead PD:" line from the slot lookup', () => {
    const slots = [
      { ...orderSlot('slot-a', 'W/"1"'), wmkf_LeadPd: { systemuserid: 'u1', fullname: 'Alex Staff' } },
      orderSlot('slot-b', 'W/"2"'),
    ];
    const { container } = render(
      <ProposalOrderList slots={slots} proposalById={new Map()} sessions={[]} sessionId={SESSION_ID} busy={false} savingSlotId={null} onChange={jest.fn()} onMove={jest.fn()} onRemove={jest.fn()} onReorder={jest.fn()} />,
    );
    expect(screen.queryByLabelText(/Lead Program Director/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(screen.getByText('Lead PD: Alex Staff')).toBeInTheDocument();
    expect(screen.getByText('Lead PD: Not assigned')).toBeInTheDocument();
  });

  test('the dedicated full-height handle is keyboard focusable and inert while busy', () => {
    const {container}=renderList(jest.fn(),{busy:true});const handle=screen.getByRole('button',{name:'Reorder proposal #slot-a, position 1'});
    expect(handle).toBeDisabled();expect(handle).toHaveClass('self-stretch');expect(handle.parentElement.tagName).toBe('LI');
    expect(container.querySelectorAll('[data-handle-id]')).toHaveLength(0);
  });

  test('the position select carries the request number even when proposal is undefined, falling back to the expanded request', async () => {
    const slots = [{
      wmkf_deliberationslotid: 'slot-x',
      _etag: 'W/"1"',
      _wmkf_request_value: 'req-x',
      wmkf_minutes: 15,
      wmkf_Request: { akoya_requestnum: '1009001' },
    }];
    render(
      <ProposalOrderList
        slots={slots}
        proposalById={new Map()}
        sessions={[]}
        sessionId={SESSION_ID}
        busy={false}
        savingSlotId={null}
        onChange={jest.fn()}
        onMove={jest.fn()}
        onRemove={jest.fn()}
        onReorder={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions for #1009001' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change position…' }));
    expect(screen.getByRole('combobox', { name: 'Position of #1009001' })).toBeInTheDocument();
  });

  test('only the dedicated grip carries the library handle, not row inputs or menu controls',()=>{
    const {container}=renderList(jest.fn());const handles=container.querySelectorAll('[data-handle-id]');expect(handles).toHaveLength(3);
    handles.forEach(handle=>{expect(handle.tagName).toBe('BUTTON');expect(handle).toHaveAttribute('tabindex','0');expect(handle.querySelector('input,select')).toBeNull();});
    expect(container.querySelectorAll('li[data-handle-id],input[data-handle-id],select[data-handle-id]')).toHaveLength(0);
  });
});

describe('SessionEditor optimistic reorder', () => {
  const SESSION = {
    sessionId: SESSION_ID,
    scheduledStartIso: '2026-09-14T16:00:00.000Z',
    scheduledEndIso: '2026-09-14T17:00:00.000Z',
    ianaTimeZone: 'America/Los_Angeles',
    location: '',
    meetingLink: '',
    notes: '',
    status: 'planned',
    attendeeRefs: [],
  };
  function detailSlots(order) {
    return order.map((id, index) => ({
      wmkf_deliberationslotid: id, _etag: `W/"${id}"`, _wmkf_request_value: id, wmkf_minutes: 15, wmkf_order: index + 1,
      wmkf_Request: { akoya_requestnum: id.toUpperCase(), akoya_title: `Title ${id}` },
    }));
  }
  function mockFetch({ reorder }) {
    let detailOrder = ['a', 'b', 'c'];
    global.fetch = jest.fn(async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/slots/reorder')) return reorder(init);
      if (target.endsWith('/recipients')) return { ok: true, status: 200, json: async () => ({ staff: [], board: [] }) };
      if (target.endsWith(`/sessions/${SESSION_ID}`)) return { ok: true, status: 200, json: async () => ({ session: SESSION, slots: detailSlots(detailOrder) }) };
      if (target.endsWith('/sessions')) return { ok: true, status: 200, json: async () => ({ sessions: [] }) };
      throw new Error(`unexpected fetch ${target}`);
    });
    return { setDetailOrder: (order) => { detailOrder = order; } };
  }
  function headers(container) {
    return [...container.querySelectorAll('ol[aria-label="Proposal order"] li p.font-semibold')].map((node) => node.textContent);
  }
  function drag(container, fromIndex, toIndex) { simulateAgendaDrop(container,fromIndex,toIndex); }

  beforeEach(() => { routerQuery = { id: SESSION_ID }; });

  test('the row moves before the reorder PATCH resolves; the reload then confirms the order', async () => {
    let resolveReorder;
    const mocks = mockFetch({ reorder: () => new Promise((resolve) => { resolveReorder = resolve; }) });
    const { container } = render(<SessionEditor />);
    await waitFor(() => expect(headers(container)).toEqual(['Position 1 · #A', 'Position 2 · #B', 'Position 3 · #C']));
    fireEvent.click(screen.getByRole('button', { name: 'Edit proposal order' }));

    drag(container, 2, 0, 5);
    // Discriminating: the PATCH is still pending, and the DOM already shows the new order.
    expect(resolveReorder).toBeDefined();
    expect(headers(container)).toEqual(['Position 1 · #C', 'Position 2 · #A', 'Position 3 · #B']);
    expect(container.querySelectorAll('ol[aria-label="Proposal order"] li')[0]).toHaveClass('opacity-70');

    mocks.setDetailOrder(['c', 'a', 'b']);
    resolveReorder({ ok: true, status: 200, json: async () => ({ slots: [] }) });
    await waitFor(() => expect(container.querySelectorAll('ol[aria-label="Proposal order"] li')[0]).not.toHaveClass('opacity-70'));
    expect(headers(container)).toEqual(['Position 1 · #C', 'Position 2 · #A', 'Position 3 · #B']);
    expect(screen.getAllByText('Moved #C to position 1.').length).toBeGreaterThan(0);
  });

  test('a failed reorder restores the previous order and shows the error', async () => {
    mockFetch({ reorder: async () => ({ ok: false, status: 409, json: async () => ({ error: 'The session order changed.' }) }) });
    const { container } = render(<SessionEditor />);
    await waitFor(() => expect(headers(container)).toEqual(['Position 1 · #A', 'Position 2 · #B', 'Position 3 · #C']));
    fireEvent.click(screen.getByRole('button', { name: 'Edit proposal order' }));

    drag(container, 2, 0, 5);
    expect(headers(container)).toEqual(['Position 1 · #C', 'Position 2 · #A', 'Position 3 · #B']);

    await screen.findByText(/The session order changed\. Please try again\./);
    expect(headers(container)).toEqual(['Position 1 · #A', 'Position 2 · #B', 'Position 3 · #C']);
  });

  test('proposal order opens read-only; Edit proposal order shows the controls and Done hides them', async () => {
    mockFetch({});
    const { container } = render(<SessionEditor />);
    await waitFor(() => expect(headers(container)).toEqual(['Position 1 · #A', 'Position 2 · #B', 'Position 3 · #C']));
    expect(container.querySelectorAll('[data-handle-id]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /More actions for #/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Proposal to add' })).not.toBeInTheDocument();
    expect(container.querySelector('ol[aria-label="Proposal order"] input[type="number"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit proposal order' }));
    expect(container.querySelectorAll('[data-handle-id]')).toHaveLength(3);
    expect(screen.getByRole('combobox', { name: 'Proposal to add' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(container.querySelectorAll('[data-handle-id]')).toHaveLength(0);
  });
});

test('compact materials statuses preserve counts in the accessible description and open their workspace task', () => {
  const visit = { activityId: 'v' };
  const row = (overrides = {}) => <MeetingTrackerRequestRow proposal={proposal({ siteVisit: visit, materials: null, ...overrides })} cycleCode="D26" programId="p1" />;
  const { rerender } = render(row());
  expect(screen.getByRole('link', { name: /Not requested.*Open materials/ })).toHaveAttribute('href', `/meeting-tracker/visits/${proposal().requestId}?cycleCode=D26&programId=p1&n=1002003#materials`);
  rerender(row({ materials: { state: 'missing', receivedCount: 2, requiredCount: 3, overdue: true, invited: true } }));
  expect(screen.getByTestId('materials-status')).toHaveTextContent('Late');
  expect(screen.getByTestId('materials-status')).toHaveTextContent('2/3 received');
  rerender(row({ materials: { state: 'received', receivedCount: 3, requiredCount: 3, overdue: false, invited: true } }));
  expect(screen.getByRole('link', { name: /Check files.*Open materials/ })).toHaveAttribute('data-full-page-navigation', 'true');
  expect(screen.getByRole('link', { name: /Check files.*Open materials/ })).toHaveAccessibleName('Check files. 3/3 received; awaiting confirmation. Open materials');
  rerender(row({ siteVisit: null }));
  expect(screen.getByTestId('materials-status')).toHaveTextContent('No research presentation');
  expect(screen.queryByRole('link', { name: /Open materials/ })).not.toBeInTheDocument();
});

test('a saved session opens as a read-only summary with its status; Edit opens the form and Cancel discards', async () => {
  routerQuery = { id: SESSION_ID, cycleCode: 'D26', programId: 'p1' };
  const session = {
    sessionId: SESSION_ID, etag: 'W/"1"', status: 100000001,
    scheduledStartIso: '2026-09-14T16:00:00.000Z', scheduledEndIso: '2026-09-14T17:30:00.000Z', ianaTimeZone: 'America/Los_Angeles',
    location: 'Board room', meetingLink: 'https://zoom.example/j/9?pwd=secret', notes: 'Bring printouts',
    attendeeRefs: [{ kind: 'staff', profileId: 7 }, { kind: 'roster', rosterId: 3 }],
  };
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (options.method && options.method !== 'GET') throw new Error('no write expected');
    const body = target.includes('/recipients')
      ? { staff: [{ ref: { kind: 'staff', profileId: 7 }, name: 'Duncan Staff', email: 'd@wmkeck.org' }], board: [{ ref: { kind: 'roster', rosterId: 3 }, name: 'Board Member', email: 'b@example.org' }] }
      : target.endsWith(`/sessions/${SESSION_ID}`)
        ? { session, slots: [] }
        : target.includes('/sessions')
          ? { sessions: [] }
          : { proposals: [] };
    return { ok: true, status: 200, json: async () => body };
  });
  render(<SessionEditor />);

  const summary = await screen.findByRole('region', { name: 'Session details' });
  expect(screen.getByText('Held')).toBeInTheDocument();
  expect(summary).toHaveTextContent('Mon, Sep 14, 2026');
  expect(summary).toHaveTextContent('90 minutes');
  expect(summary).toHaveTextContent('Duncan Staff, Board Member');
  expect(summary).toHaveTextContent('Board room');
  expect(screen.getByRole('link', { name: 'Open meeting link (zoom.example)' })).toHaveAttribute('href', session.meetingLink);
  expect(summary).not.toHaveTextContent('pwd=secret');
  expect(screen.queryByRole('button', { name: 'Save session' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Edit session details' }));
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Elsewhere' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('region', { name: 'Session details' })).toHaveTextContent('Board room');
  fireEvent.click(screen.getByRole('button', { name: 'Edit session details' }));
  expect(screen.getByLabelText('Location')).toHaveValue('Board room');
  expect(screen.getByRole('button', { name: 'Save session' })).toBeInTheDocument();
});

test('a failed existing-session load gates edits and retry opens the session after prerequisites recover', async () => {
  routerQuery = { id: SESSION_ID, cycleCode: 'nope' };
  let failDashboard = true;
  const session = {
    sessionId: SESSION_ID, etag: 'W/"1"', status: 100000000,
    scheduledStartIso: '2026-09-14T16:00:00.000Z', scheduledEndIso: '2026-09-14T17:00:00.000Z', ianaTimeZone: 'America/Los_Angeles',
    location: 'Loaded location', meetingLink: '', notes: '', attendeeRefs: [],
  };
  global.fetch = jest.fn(async (url) => {
    const target = String(url);
    if (target.includes('/dashboard') && failDashboard) return { ok: false, status: 400, json: async () => ({ error: 'Unknown cycle.' }) };
    const body = target.includes('/recipients') ? { staff: [], board: [] }
      : target.endsWith(`/sessions/${SESSION_ID}`) ? { session, slots: [] }
        : target.endsWith('/sessions') ? { sessions: [] } : { proposals: [] };
    return { ok: true, status: 200, json: async () => body };
  });
  render(<SessionEditor />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unknown cycle.');
  expect(screen.queryByRole('button', { name: 'Save session' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit proposal order' })).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([url]) => String(url).endsWith(`/sessions/${SESSION_ID}`))).toBe(false);

  failDashboard = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('region', { name: 'Session details' })).toHaveTextContent('Loaded location');
});

test('a delayed old session detail cannot populate or be saved under the new route context', async () => {
  const secondId = '77777777-7777-4777-8777-777777777777';
  const baseSession = (id, location) => ({
    sessionId: id, etag: `W/"${location}"`, status: 100000000,
    scheduledStartIso: '2026-09-14T16:00:00.000Z', scheduledEndIso: '2026-09-14T17:00:00.000Z', ianaTimeZone: 'America/Los_Angeles',
    location, meetingLink: '', notes: '', attendeeRefs: [],
  });
  let resolveFirst;
  const firstDetail = new Promise((resolve) => { resolveFirst = resolve; });
  const writes = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (options.method === 'PATCH') {
      writes.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ session: baseSession(secondId, 'B saved') }) };
    }
    const body = target.includes('/recipients') ? { staff: [], board: [] }
      : target.endsWith('/sessions') ? { sessions: [] }
        : target.endsWith(`/sessions/${SESSION_ID}`) ? null
          : target.endsWith(`/sessions/${secondId}`) ? { session: baseSession(secondId, 'B location'), slots: [] }
            : { proposals: [] };
    if (target.endsWith(`/sessions/${SESSION_ID}`)) return firstDetail;
    return { ok: true, status: 200, json: async () => body };
  });
  routerQuery = { id: SESSION_ID };
  const view = render(<SessionEditor />);
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => String(url).endsWith(`/sessions/${SESSION_ID}`))).toBe(true));

  routerQuery = { id: secondId };
  view.rerender(<SessionEditor />);
  expect(await screen.findByRole('region', { name: 'Session details' })).toHaveTextContent('B location');
  resolveFirst({ ok: true, status: 200, json: async () => ({ session: baseSession(SESSION_ID, 'A stale location'), slots: [] }) });
  await waitFor(() => expect(screen.getByRole('region', { name: 'Session details' })).toHaveTextContent('B location'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit session details' }));
  expect(screen.getByLabelText('Location')).toHaveValue('B location');
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'B changed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save session' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ etag: 'W/"B location"', location: 'B changed' });
  expect(writes[0].etag).not.toBe('W/"A stale location"');
});

test('retry after a failed post-create navigation reuses the created session', async () => {
  routerQuery = { id: 'new' };
  routerReplace.mockReset().mockResolvedValueOnce(false).mockResolvedValue(true);
  let sessionPosts = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/recipients')) return { ok: true, status: 200, json: async () => ({ staff: [], board: [] }) };
    if (target.endsWith('/sessions') && options.method === 'POST') {
      sessionPosts += 1;
      return { ok: true, status: 200, json: async () => ({ session: { sessionId: SESSION_ID } }) };
    }
    if (target.endsWith('/sessions')) return { ok: true, status: 200, json: async () => ({ sessions: [] }) };
    return { ok: true, status: 200, json: async () => ({ proposals: [] }) };
  });
  render(<SessionEditor />);
  const start = await screen.findByLabelText('Date and start time');
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.change(start, { target: { value: '2026-10-10T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The created session could not be opened. Please try again.');
  expect(screen.getByLabelText('Date and start time')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to created session' }));
  await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(2));
  expect(sessionPosts).toBe(1);
});

test('retry after an ambiguous initial-slot failure checks saved slots before creating one again', async () => {
  const requestId = proposal().requestId;
  routerQuery = { id: 'new', cycleCode: 'D26', requestId };
  routerReplace.mockReset().mockResolvedValue(true);
  let sessionPosts = 0;
  let slotPosts = 0;
  let detailReads = 0;
  const slot = { wmkf_deliberationslotid: FIRST_SLOT_ID, _wmkf_request_value: requestId, _etag: 'W/"slot"', wmkf_minutes: 15 };
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/recipients')) return { ok: true, status: 200, json: async () => ({ staff: [], board: [] }) };
    if (target.includes('/dashboard')) return { ok: true, status: 200, json: async () => ({ proposals: [{ ...proposal(), leadPdId: null }] }) };
    if (target.endsWith('/sessions') && options.method === 'POST') {
      sessionPosts += 1;
      return { ok: true, status: 200, json: async () => ({ session: { sessionId: SESSION_ID } }) };
    }
    if (target.endsWith('/sessions')) return { ok: true, status: 200, json: async () => ({ sessions: [] }) };
    if (target.endsWith('/slots') && options.method === 'POST') {
      slotPosts += 1;
      return { ok: false, status: 503, json: async () => ({ error: 'The slot response was lost.' }) };
    }
    if (target.endsWith(`/sessions/${SESSION_ID}`)) {
      detailReads += 1;
      return { ok: true, status: 200, json: async () => ({ session: { sessionId: SESSION_ID }, slots: [slot] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  render(<SessionEditor />);
  fireEvent.change(await screen.findByLabelText('Date and start time'), { target: { value: '2026-10-10T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The slot response was lost.');
  expect(screen.getByRole('button', { name: 'Continue to created session' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to created session' }));
  await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(1));
  expect(sessionPosts).toBe(1);
  expect(slotPosts).toBe(1);
  expect(detailReads).toBe(1);
});

test('partial session creation recovery is scoped to its route across saved and new sessions', async () => {
  const requestA = proposal().requestId;
  const requestB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const secondSessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  routerQuery = { id: 'new', cycleCode: 'D26', requestId: requestA };
  routerReplace.mockReset().mockResolvedValue(true);
  let sessionPosts = 0;
  let slotPosts = 0;
  const slotRequests = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/recipients')) return { ok: true, status: 200, json: async () => ({ staff: [], board: [] }) };
    if (target.includes('/dashboard')) {
      const requestId = target.includes('D27') ? requestB : requestA;
      return { ok: true, status: 200, json: async () => ({ proposals: [{ ...proposal({ requestId }), leadPdId: null }] }) };
    }
    if (target.endsWith('/sessions') && options.method === 'POST') {
      sessionPosts += 1;
      return { ok: true, status: 200, json: async () => ({ session: { sessionId: sessionPosts === 1 ? SESSION_ID : secondSessionId } }) };
    }
    if (target.endsWith('/sessions')) return { ok: true, status: 200, json: async () => ({ sessions: [] }) };
    if (target.endsWith('/slots') && options.method === 'POST') {
      slotPosts += 1;
      slotRequests.push(JSON.parse(options.body).requestId);
      return slotPosts === 1
        ? { ok: false, status: 503, json: async () => ({ error: 'The slot response was lost.' }) }
        : { ok: true, status: 200, json: async () => ({}) };
    }
    if (target.endsWith(`/sessions/${SESSION_ID}`)) return { ok: true, status: 200, json: async () => ({
      session: { sessionId: SESSION_ID, etag: 'W/"1"', status: 100000000,
        scheduledStartIso: '2026-10-10T17:00:00.000Z', scheduledEndIso: '2026-10-10T18:00:00.000Z',
        ianaTimeZone: 'America/Los_Angeles', location: '', meetingLink: '', notes: '', attendeeRefs: [] }, slots: [],
    }) };
    return { ok: true, status: 200, json: async () => ({ proposals: [] }) };
  });
  const view = render(<SessionEditor />);
  fireEvent.change(await screen.findByLabelText('Date and start time'), { target: { value: '2026-10-10T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The slot response was lost.');
  expect(screen.getByLabelText('Date and start time')).toBeDisabled();

  routerQuery = { id: SESSION_ID };
  view.rerender(<SessionEditor />);
  expect(await screen.findByRole('region', { name: 'Session details' })).toBeInTheDocument();

  routerQuery = { id: 'new', cycleCode: 'D27', requestId: requestB };
  view.rerender(<SessionEditor />);
  const start = await screen.findByLabelText('Date and start time');
  await waitFor(() => expect(start).toBeEnabled());
  expect(screen.queryByText(/The session has been created/)).toBeNull();
  fireEvent.change(start, { target: { value: '2026-10-11T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
  await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(1));
  expect(sessionPosts).toBe(2);
  expect(slotRequests).toEqual([requestA, requestB]);
});
