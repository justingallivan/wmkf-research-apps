import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { Button, Card, PageHeader } from '../Layout';
import { conventionalCycles, cycleCodeToLabel, resolveWorkingCycle } from '../../../lib/utils/cycle-code';
import { createOperationId, loadProposalRanking, sendProposalRankingAction } from './client';
import { buildCumulativeTotals, errorMessage, formatMoney, moveProposal, PROGRAMS, pdRankColor } from './model';

const EMPTY_CAPABILITIES = {
  preview: false, open: false, saveOwnList: false, submitOwnList: false,
  generate: false, editMeetingOrder: false, publish: false,
  transferFacilitator: false, excuseParticipant: false, cancelRound: false, resetDryRun: false,
};
const EMPTY_ORDER = [];

function cycleOptions() {
  return conventionalCycles().slice().reverse().map((code) => ({
    code,
    label: `${code} · ${cycleCodeToLabel(code)}`,
  }));
}

function responseError(error) {
  return error?.current && typeof error.current === 'object' ? error.current : null;
}

function StatusBanner({ kind = 'info', children, className = '' }) {
  const classes = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-950',
    error: 'border-red-300 bg-red-50 text-red-900',
    success: 'border-green-200 bg-green-50 text-green-900',
  };
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${classes[kind]} ${className}`}>{children}</div>;
}

function ProposalCardRow({ proposal, position, programCount, total, score, rank, editable, dragging, dragProvided }) {
  const amount = proposal.amountMinorUnits == null
    ? 'Requested amount unavailable'
    : formatMoney(proposal.amountMinorUnits, proposal.currency);
  const accumulated = total
    ? formatMoney(total.cumulativeMinorUnits, proposal.currency, { incomplete: !total.complete })
    : 'Total incomplete';
  const rankNames = rank?.participants || [];
  return (
    <li
      ref={dragProvided?.innerRef}
      {...dragProvided?.draggableProps}
      className={`mb-3 rounded-xl border bg-white ${dragging ? 'border-blue-600 shadow-xl ring-2 ring-blue-500' : 'border-gray-200 shadow-sm'}`}
    >
      <div className="flex min-w-0 items-stretch">
        {editable && <div
          aria-label={`Drag ${proposal.title || 'Untitled proposal'} to reorder`}
          {...dragProvided?.dragHandleProps}
          title="Drag to reorder"
          className="flex w-8 shrink-0 cursor-grab items-center justify-center border-r border-gray-200 bg-gray-50 text-gray-400 active:cursor-grabbing"
        >
          <svg aria-hidden="true" width="16" height="24" viewBox="0 0 16 24" fill="currentColor"><circle cx="5" cy="6" r="1.5" /><circle cx="11" cy="6" r="1.5" /><circle cx="5" cy="12" r="1.5" /><circle cx="11" cy="12" r="1.5" /><circle cx="5" cy="18" r="1.5" /><circle cx="11" cy="18" r="1.5" /></svg>
        </div>}
        <div className="min-w-0 flex-1 space-y-3 p-4">
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <span aria-label={`Rank ${position + 1}: ${proposal.title || 'Untitled proposal'}`} className="min-w-8 shrink-0 text-3xl font-bold leading-none tabular-nums text-gray-900">{position + 1}</span>
            <div className="min-w-0">
              <h3 className="break-words text-base font-semibold leading-snug text-gray-900">{proposal.organization || 'Organization unavailable'}</h3>
              <p className="mt-1 break-words text-sm">
                <a href={`/workbench/${encodeURIComponent(proposal.requestId)}`} className="text-blue-800 underline underline-offset-2 hover:text-blue-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{proposal.title || 'Untitled proposal'}</a>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-gray-600">
                <span>{proposal.programKey.toUpperCase()}</span>
                {(proposal.institutionGeography === 'East' || proposal.institutionGeography === 'West') && <span
                  role="img"
                  aria-label={`${proposal.institutionGeography} institution`}
                  title={`${proposal.institutionGeography} institution`}
                  className="border-l border-gray-300 pl-2 text-xs font-medium text-gray-600"
                >{proposal.institutionGeography[0]}</span>}
                {proposal.leadName && <span>Lead PD: {proposal.leadName}</span>}
                {rank?.disagreement && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-900">Disagreement</span>}
              </div>
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="mr-1 font-medium text-gray-700">Reviews</span>
                  {proposal.score?.ratedCount > 0 && proposal.score?.distribution
                    ? [['Excellent', 'E'], ['Very Good', 'VG'], ['Good', 'G'], ['Fair', 'F'], ['Poor', 'P']].flatMap(([rating, grade]) =>
                      Array.from({ length: proposal.score.distribution[rating] || 0 }, (_, index) => <span
                        key={`${rating}-${index}`}
                        title={rating}
                        aria-label={rating}
                        className="inline-flex min-w-7 items-center justify-center rounded-md bg-gray-100 px-2 py-0.5 font-semibold text-gray-800"
                      >{grade}</span>))
                    : <span className="text-gray-500">Not scored</span>}
                  {proposal.score?.ratedCount > 0 && Number.isFinite(proposal.score?.displayMean) && <span title="Average reviewer grade" aria-label={`Average reviewer grade: ${proposal.score.displayMean.toFixed(1)}`} className="ml-1 inline-flex min-w-7 items-center justify-center rounded-md bg-gray-100 px-2 py-0.5 font-semibold text-gray-800">{proposal.score.displayMean.toFixed(1)}</span>}
                </div>
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                  {rankNames.length > 0 && (
                    <ul aria-label="PD ranks" className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-700">
                      {rankNames.map((entry) => <li key={entry.systemUserId} className="flex items-center gap-1.5 font-semibold" title={`${entry.name}: rank ${entry.rank} of ${programCount}`}>
                        {entry.name.trim().split(/\s+/)[0] || 'PD'}
                        <span aria-label={`${entry.name}: rank ${entry.rank} of ${programCount}`} style={{ backgroundColor: `${pdRankColor(entry.rank, programCount)}33` }} className="inline-flex min-w-7 items-center justify-center rounded-md px-2 py-0.5 font-semibold text-gray-900">{entry.rank}</span>
                      </li>)}
                      {score && <li className="flex items-center gap-1.5 font-semibold">
                        Average
                        <span aria-label={`Average PD rank: ${score.averageRank.toFixed(2)}`} title={`Average PD rank within ${proposal.programKey.toUpperCase()}${score.tied ? ' · tied' : ''}`} style={{ backgroundColor: `${pdRankColor(score.averageRank, programCount)}33` }} className="inline-flex min-w-7 items-center justify-center rounded-md px-2 py-0.5 font-semibold text-gray-900">{score.averageRank.toFixed(2)}</span>
                        {score.tied && <span className="text-xs font-normal text-gray-500">tied</span>}
                      </li>}
                    </ul>
                  )}
                  <div className="ml-auto flex flex-wrap justify-end items-start gap-x-6 gap-y-2 text-right text-sm">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-600">Requested</p>
                      <p className="mt-1 font-semibold tabular-nums text-gray-900">{amount}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-600">Cumulative Budget</p>
                      <p className="mt-1 font-semibold tabular-nums text-gray-900">{accumulated}</p>
                      {!total?.complete && <p className="mt-1 text-xs text-amber-800">A requested amount is missing or incompatible.</p>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function ProposalOrder({ list, proposals, order, editable, saveState, composite, remoteOrder, onMove, onRetry }) {
  const [dropPosition, setDropPosition] = useState(null);
  const previewId = useId();
  const byId = useMemo(() => new Map(proposals.map((proposal) => [proposal.requestId, proposal])), [proposals]);
  const activeOrder = order || list?.order || EMPTY_ORDER;
  const totals = useMemo(() => buildCumulativeTotals(activeOrder, proposals), [activeOrder, proposals]);
  const totalsById = useMemo(() => new Map(totals.map((entry) => [entry.requestId, entry])), [totals]);
  const ranksById = useMemo(() => new Map((composite?.ranks || []).map((rank) => [rank.requestId, rank])), [composite]);
  if (!activeOrder.length) return <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">No proposals in this program.</p>;
  return (
    <div>
      {saveState && <div className="mb-3" aria-live="polite">
        {saveState === 'saving' && <StatusBanner>Saving the latest order…</StatusBanner>}
        {saveState === 'saved' && <StatusBanner kind="success">Order saved.</StatusBanner>}
        {saveState === 'unsaved' && <StatusBanner kind="warning">This order is unsaved. Refresh to reconcile, then retry the latest order.</StatusBanner>}
        {saveState === 'conflict' && <StatusBanner kind="warning">Another change is newer than this order. Refresh before retrying.</StatusBanner>}
        {(saveState === 'unsaved' || saveState === 'conflict') && onRetry && <button type="button" onClick={onRetry} className="mt-2 rounded-md border border-amber-500 bg-white px-3 py-1.5 text-sm font-semibold text-amber-950 hover:bg-amber-100">Retry displayed order</button>}
        {(saveState === 'unsaved' || saveState === 'conflict') && remoteOrder && <details className="mt-2 text-sm text-amber-950">
          <summary className="cursor-pointer font-medium">Review the server-saved order</summary>
          <p className="mt-1">{remoteOrder.map((requestId) => `#${byId.get(requestId)?.requestNumber || requestId}`).join(' → ')}</p>
        </details>}
      </div>}
      <DragDropContext
        onDragStart={({ source }) => setDropPosition(source.index)}
        onDragUpdate={({ destination }) => setDropPosition(destination?.index ?? null)}
        onDragEnd={({ source, destination, reason }) => {
          setDropPosition(null);
          if (editable && reason === 'DROP' && destination && destination.droppableId === source.droppableId && destination.index !== source.index) onMove(source.index, destination.index);
        }}
      >
        {dropPosition !== null && <p className="pointer-events-none fixed bottom-6 right-6 z-50 rounded-md bg-blue-800 px-3 py-2 text-sm font-semibold text-white">Drop at position {dropPosition + 1} of {activeOrder.length}</p>}
        <Droppable droppableId={list?.listKey || previewId} isDropDisabled={!editable}>
          {(provided, snapshot) => <ol ref={provided.innerRef} {...provided.droppableProps} className={`rounded-xl ${snapshot.isDraggingOver ? 'bg-blue-100 ring-2 ring-blue-400' : ''}`} aria-label="Proposal ranking order">
            {activeOrder.map((requestId, position) => {
              const proposal = byId.get(requestId);
              if (!proposal) return null;
              return <Draggable key={requestId} draggableId={requestId} index={position} isDragDisabled={!editable}>
                {(dragProvided, dragSnapshot) => <ProposalCardRow
                  proposal={proposal}
                  position={position}
                  programCount={proposals.filter((item) => item.programKey === proposal.programKey).length}
                  total={totalsById.get(requestId)}
                  score={composite?.scores?.[requestId] || null}
                  rank={ranksById.get(requestId)}
                  editable={editable}
                  dragging={dragSnapshot.isDragging}
                  dragProvided={dragProvided}
                />}
              </Draggable>;
            })}
            {provided.placeholder}
          </ol>}
        </Droppable>
      </DragDropContext>
    </div>
  );
}

function SubmissionLists({ response, program, proposals, isFacilitator, readOnly = false, onSubmit, submitting, saveStates, localOrders, remoteOrders, onMove, onRetry }) {
  const data = response.programs?.[program.key];
  const lists = isFacilitator
    ? (data?.facilitatorLists || [])
    : response.viewer.isRosterParticipant && data?.ownList ? [data.ownList] : [];
  if (!lists.length) {
    return <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">No individual list is available to this viewer.</p>;
  }
  return <div className="space-y-4">
    {lists.map((list) => {
      const localOrder = localOrders[list.listKey];
      const editable = !readOnly && list.owner?.systemUserId === response.viewer.systemUserId
        && response.viewer.capabilities.saveOwnList
        && list.status === 'draft'
        && response.round.state === 'active';
      return <section key={list.listKey} aria-label={`${list.owner?.name || 'Your'} ${program.shortLabel} ranking`} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-gray-900">{list.owner?.name || 'Your ranking'}</h3>
            <p className="text-xs text-gray-600">{list.status === 'submitted' ? 'Submitted and locked' : 'Private draft'} · Updated {new Date(list.updatedAt).toLocaleString()}</p>
          </div>
          {editable && <Button type="button" size="sm" loading={submitting === list.listKey} disabled={submitting === list.listKey || saveStates[list.listKey] === 'saving' || saveStates[list.listKey] === 'unsaved' || saveStates[list.listKey] === 'conflict'} onClick={() => onSubmit(list, localOrder || list.order)}>Submit and lock list</Button>}
        </div>
        <ProposalOrder
          list={list}
          proposals={proposals}
          order={localOrder}
          editable={editable && !submitting}
          saveState={saveStates[list.listKey]}
          remoteOrder={remoteOrders[list.listKey]}
          onMove={(from, to) => onMove(list, moveProposal(localOrder || list.order, from, to), 'save')}
          onRetry={() => onRetry(list)}
        />
      </section>;
    })}
  </div>;
}

function ConfirmationBox({ confirmation, label, busy, onConfirm, onCancel }) {
  if (!confirmation) return null;
  return <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
    <h4 className="font-semibold text-amber-950">Confirm {label}</h4>
    <p className="mt-1 text-sm text-amber-950">{confirmation.message}</p>
    {confirmation.outstandingNames?.length > 0 && <p className="mt-2 text-sm text-amber-950">Still outstanding: {confirmation.outstandingNames.join(', ')}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="danger" size="sm" loading={busy} disabled={busy} onClick={onConfirm}>Confirm {label}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>Keep working</Button>
    </div>
  </div>;
}

function ProgramPanel({ response, program, isFacilitator, view, localOrders, remoteOrders, saveStates, actionBusy, hasUnresolvedSave, submitting, onMove, onSubmit, onGenerate, onPublish, pendingConfirmation, setPendingConfirmation, confirmations, onRetry }) {
  const combined = program.key === 'co';
  const programData = response.programs?.[program.key] || {};
  const proposalById = new Map((response.round?.snapshot.proposals || []).map((proposal) => [proposal.requestId, proposal]));
  const proposals = (programData.proposalIds || []).map((id) => proposalById.get(id)).filter(Boolean);
  const meeting = programData.meeting;
  const meetingStatus = programData.meetingStatus || meeting?.status || null;
  const generated = meetingStatus === 'composite-draft' || meetingStatus === 'published';
  const published = meetingStatus === 'published';
  const totalSubmissions = programData.progress || { required: 0, submitted: 0, outstandingNames: [] };
  const activeConfirmation = view === 'facilitate' && pendingConfirmation?.programKey === program.key ? pendingConfirmation : null;
  const currentConfirmations = confirmations || response.confirmations;
  const meetingCanEdit = Boolean(response.round.state === 'active' && response.viewer.capabilities.editMeetingOrder && (meetingStatus === 'composite-draft' || published));
  const listKey = meeting?.listKey;
  return <section aria-labelledby={`program-heading-${program.key}`} className="mt-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id={`program-heading-${program.key}`} className="text-xl font-semibold text-gray-900">{program.label}</h2>
        {!combined && programData.proposalIds?.length > 0 && <p className="mt-1 text-sm text-gray-600">{totalSubmissions.submitted} of {totalSubmissions.required} required PD submissions received.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {view === 'facilitate' && response.round.state === 'active' && response.viewer.capabilities.generate && (meetingStatus === 'collecting' || (combined && !meeting)) && <Button type="button" size="sm" disabled={actionBusy || hasUnresolvedSave || !currentConfirmations.generate?.[program.key]} onClick={() => setPendingConfirmation({ action: 'generate', programKey: program.key })}>{combined ? 'Create combined meeting list' : `Generate ${program.shortLabel} draft`}</Button>}
        {view === 'facilitate' && response.round.state === 'active' && response.viewer.capabilities.publish && meetingStatus === 'composite-draft' && <Button type="button" size="sm" disabled={actionBusy || hasUnresolvedSave || !currentConfirmations.publish?.[program.key]} onClick={() => setPendingConfirmation({ action: 'publish', programKey: program.key })}>Publish {program.shortLabel}</Button>}
      </div>
    </div>
      {activeConfirmation?.action === 'generate' && <ConfirmationBox confirmation={currentConfirmations.generate?.[program.key]} label={combined ? 'create the shared combined meeting list' : `generate the ${program.label} draft`} busy={actionBusy} onConfirm={() => onGenerate(program.key)} onCancel={() => setPendingConfirmation(null)} />}
      {activeConfirmation?.action === 'publish' && <ConfirmationBox confirmation={currentConfirmations.publish?.[program.key]} label={`publish the ${program.label} order`} busy={actionBusy} onConfirm={() => onPublish(program.key)} onCancel={() => setPendingConfirmation(null)} />}
    {programData.proposalIds?.length === 0 ? <p className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">No proposals in this program. No individual lists or composite are required.</p> : <>
      {view === 'meeting' && !published && <StatusBanner className="mt-3">{combined ? 'Waiting for the facilitator to create the combined meeting list.' : 'This program has not been published yet. Your own list is in My rankings.'}</StatusBanner>}
      {view === 'facilitate' && published && <StatusBanner className="mt-3">Published. Continue the discussion in Meeting list.</StatusBanner>}
      {view === 'facilitate' && !combined && programData.progress && <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-semibold ${published ? 'bg-green-100 text-green-900' : 'bg-gray-100 text-gray-700'}`}>{published ? 'Published meeting order' : meetingStatus === 'composite-draft' ? 'Review the draft, then publish' : totalSubmissions.required > 0 && totalSubmissions.submitted === totalSubmissions.required ? (isFacilitator ? 'All rankings submitted. Generate the draft to continue.' : 'All rankings submitted. Waiting for the facilitator to prepare the meeting list.') : 'Collecting submissions'}</span>
      </div>}
      {meeting && generated && ((view === 'facilitate' && isFacilitator && !published) || (view === 'meeting' && published && (isFacilitator || response.viewer.isRosterParticipant))) && <div className="mt-6 border-t border-gray-200 pt-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{published ? 'Shared meeting order' : 'Facilitator composite draft'}</h3>
            <p className="mt-1 text-sm text-gray-600">{combined ? 'Starting order compares PD average ranks while preserving each program’s order at creation. Edits here and in SE or MR are independent.' : 'The original PD rankings remain separate from this meeting order.'}</p>
          </div>
          {published && <p className="text-sm text-green-800">Changes save to the shared order. Refresh on other devices to see updates.</p>}
        </div>
        <ProposalOrder
          list={meeting}
          proposals={proposals}
          order={localOrders[listKey]}
          editable={meetingCanEdit && !actionBusy}
          saveState={saveStates[listKey]}
          composite={meeting.composite}
          remoteOrder={remoteOrders[listKey]}
          onMove={(from, to) => onMove(meeting, moveProposal(localOrders[listKey] || meeting.order, from, to), 'edit')}
          onRetry={() => onRetry(meeting)}
        />
      </div>}
      {view === 'facilitate' && isFacilitator && !combined && <details key={program.key} className="mt-5">
        <summary className="mb-3 cursor-pointer text-base font-semibold text-gray-900">Individual PD rankings</summary>
        <SubmissionLists
          response={response}
          program={program}
          proposals={proposals}
          isFacilitator
          readOnly
          onSubmit={onSubmit}
          submitting={submitting}
          saveStates={saveStates}
          localOrders={localOrders}
          remoteOrders={remoteOrders}
          onMove={onMove}
          onRetry={onRetry}
        />
      </details>}
      {view === 'mine' && response.viewer.isRosterParticipant && <div className="mt-5">
        <h3 className="mb-3 text-base font-semibold text-gray-900">Your private ranking</h3>
        {programData.ownList?.status === 'submitted' && <StatusBanner className="mb-3">{published ? 'Your ranking is submitted. The published order is in Meeting list.' : isFacilitator ? 'Your ranking is submitted. Continue in Facilitate when everyone has submitted.' : 'Submitted—waiting for the facilitator.'}</StatusBanner>}
        <SubmissionLists
          response={response}
          program={program}
          proposals={proposals}
          isFacilitator={false}
          onSubmit={onSubmit}
          submitting={submitting}
          saveStates={saveStates}
          localOrders={localOrders}
          remoteOrders={remoteOrders}
          onMove={onMove}
          onRetry={onRetry}
        />
      </div>}


    </>}
  </section>;
}

export default function ProposalRankingApp() {
  const options = useMemo(() => cycleOptions(), []);
  const [cycleCode, setCycleCode] = useState(() => resolveWorkingCycle(conventionalCycles()) || options[0]?.code || '');
  const [selectedProgram, setSelectedProgram] = useState('se');
  const [viewChoice, setViewChoice] = useState(null);
  const [response, setResponse] = useState(null);
  const responseRef = useRef(null);
  const [responseScopeKey, setResponseScopeKey] = useState(null);
  const [settledScopeKey, setSettledScopeKey] = useState(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState(null);
  const [localOrders, setLocalOrders] = useState({});
  const localOrdersRef = useRef({});
  const [remoteOrders, setRemoteOrders] = useState({});
  const remoteOrdersRef = useRef({});
  const [saveStates, setSaveStates] = useState({});
  const saveStatesRef = useRef({});
  const [submitting, setSubmitting] = useState(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [transferSelection, setTransferSelection] = useState('');
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [operationNotice, setOperationNotice] = useState(null);
  const [pendingOpen, setPendingOpen] = useState(null);
  const scopeRef = useRef(0);
  const scopeKeyRef = useRef(null);
  const loadRef = useRef(0);
  const queuesRef = useRef(new Map());
  const drainingRef = useRef(new Set());
  const lastOperationRef = useRef(null);
  const mountedRef = useRef(true);

  const applyResponse = useCallback((next, scope) => {
    if (!mountedRef.current || scope !== scopeRef.current || !next) return false;
    if (next.round?.erased) {
      // Erasure is terminal: a delayed response from this scope must never
      // restore its private contents, even after a new round has been opened.
      scopeRef.current += 1;
      loadRef.current += 1;
      lastOperationRef.current = null;
      setRequestBusy(false);
      setActionBusy(false);
      setSubmitting(null);
      setPendingConfirmation(null);
      setSettledScopeKey(scopeKeyRef.current);
      setDryRun(false);
      queuesRef.current.clear();
      localOrdersRef.current = {};
      saveStatesRef.current = {};
      remoteOrdersRef.current = {};
      setLocalOrders({});
      setSaveStates({});
      setRemoteOrders({});
    }
    if (!next.round?.erased && !next.programs?.co?.available) {
      setSelectedProgram((key) => key === 'co' ? 'se' : key);
    }
    responseRef.current = next;
    setResponse(next);
    setResponseScopeKey(scopeKeyRef.current);
    return true;
  }, []);

  // A mutation/readback supersedes any older refresh still in flight.
  const applyMutationResponse = useCallback((next, scope) => {
    if (!applyResponse(next, scope)) return false;
    loadRef.current += 1;
    setRequestBusy(false);
    setSettledScopeKey(scopeKeyRef.current);
    return true;
  }, [applyResponse]);

  const assignSaveState = useCallback((key, value, scope) => {
    if (!mountedRef.current || scope !== scopeRef.current) return;
    const next = { ...saveStatesRef.current, [key]: value };
    saveStatesRef.current = next;
    setSaveStates(next);
  }, []);

  const setLocalOrder = useCallback((key, order, scope) => {
    if (!mountedRef.current || scope !== scopeRef.current) return;
    const next = { ...localOrdersRef.current, [key]: order };
    localOrdersRef.current = next;
    setLocalOrders(next);
  }, []);

  const clearLocalOrder = useCallback((key, scope) => {
    if (!mountedRef.current || scope !== scopeRef.current) return;
    const next = { ...localOrdersRef.current };
    delete next[key];
    localOrdersRef.current = next;
    setLocalOrders(next);
  }, []);

  const setRemoteOrder = useCallback((key, order, scope) => {
    if (!mountedRef.current || scope !== scopeRef.current) return;
    const next = { ...remoteOrdersRef.current };
    if (order?.length) next[key] = order;
    else delete next[key];
    remoteOrdersRef.current = next;
    setRemoteOrders(next);
  }, []);

  const clearViewAfterDenial = useCallback((scope) => {
    if (!mountedRef.current || scope !== scopeRef.current) return;
    // Invalidate every same-scope request before clearing private data. A late
    // success from a load, save, or operation readback must not restore it.
    scopeRef.current += 1;
    loadRef.current += 1;
    responseRef.current = null;
    setResponse(null);
    setResponseScopeKey(null);
    localOrdersRef.current = {};
    setLocalOrders({});
    saveStatesRef.current = {};
    setSaveStates({});
    remoteOrdersRef.current = {};
    setRemoteOrders({});
    queuesRef.current.clear();
    lastOperationRef.current = null;
    setRequestBusy(false);
    setActionBusy(false);
    setSubmitting(null);
    setPendingConfirmation(null);
    setSettledScopeKey(scopeKeyRef.current);
  }, []);

  const loadCurrent = useCallback(async ({ keepDrafts = true, operationId = lastOperationRef.current?.operationId, cyclePreview = false } = {}) => {
    const scope = scopeRef.current;
    const scopeKey = scopeKeyRef.current;
    const loadId = ++loadRef.current;
    const current = responseRef.current;
    setRequestBusy(true);
    setError(null);
    try {
      let next;
      if (!cyclePreview && operationId && current?.roundId) {
        next = await sendProposalRankingAction({ action: 'read', roundId: current.roundId, operationId });
      } else {
        next = await loadProposalRanking({ cycleCode, roundId: cyclePreview ? undefined : current?.roundId || undefined });
      }
      if (!mountedRef.current || scope !== scopeRef.current || loadId !== loadRef.current) return null;
      applyResponse(next, scope);
      if (!keepDrafts) {
        localOrdersRef.current = {};
        setLocalOrders({});
        saveStatesRef.current = {};
        setSaveStates({});
        remoteOrdersRef.current = {};
        setRemoteOrders({});
      } else {
        // Keep an optimistic order only when the server has not already confirmed it.
        const refreshed = { ...localOrdersRef.current };
        const statuses = { ...saveStatesRef.current };
        const remote = { ...remoteOrdersRef.current };
        for (const [key, order] of Object.entries(refreshed)) {
          const serverOrder = findListOrder(next, key);
          if (serverOrder && sameOrder(serverOrder, order)) {
            delete refreshed[key];
            delete statuses[key];
            delete remote[key];
          } else if (serverOrder) {
            statuses[key] = 'unsaved';
            remote[key] = serverOrder;
          }
        }
        localOrdersRef.current = refreshed;
        setLocalOrders(refreshed);
        saveStatesRef.current = statuses;
        setSaveStates(statuses);
        remoteOrdersRef.current = remote;
        setRemoteOrders(remote);
      }
      if (next.operation?.status === 'confirmed') {
        setOperationNotice(`The previous save is confirmed (${next.operation.result}).`);
        lastOperationRef.current = null;
      } else if (next.operation?.status === 'superseded') {
        setOperationNotice('A newer change is now saved. Review the refreshed order before continuing.');
        lastOperationRef.current = null;
      } else if (next.operation?.status === 'uncertain') {
        setOperationNotice('The save outcome is still uncertain. Keep the order unsaved and retry the refresh.');
      }
      return next;
    } catch (err) {
      if (!mountedRef.current || scope !== scopeRef.current || loadId !== loadRef.current) return null;
      if (err.status === 403) clearViewAfterDenial(scope);
      setError(errorMessage(err));
      return null;
    } finally {
      if (mountedRef.current && scope === scopeRef.current && loadId === loadRef.current) {
        setRequestBusy(false);
        setSettledScopeKey(scopeKey);
      }
    }
  }, [applyResponse, clearViewAfterDenial, cycleCode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeRef.current += 1;
      loadRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const scope = ++scopeRef.current;
    const scopeKey = `${cycleCode}:${selectedProgram}`;
    scopeKeyRef.current = scopeKey;
    queuesRef.current.clear();
    lastOperationRef.current = null;
    const loadId = ++loadRef.current;
    let active = true;
    (async () => {
      try {
        const next = await loadProposalRanking({ cycleCode });
        if (!active || !mountedRef.current || scope !== scopeRef.current || loadId !== loadRef.current) return;
        applyResponse(next, scope);
      } catch (err) {
        if (!active || !mountedRef.current || scope !== scopeRef.current || loadId !== loadRef.current) return;
        setError(errorMessage(err));
      } finally {
        if (active && mountedRef.current && scope === scopeRef.current && loadId === loadRef.current) setSettledScopeKey(scopeKey);
      }
    })();
    return () => { active = false; };
  }, [cycleCode, selectedProgram, applyResponse]);

  const runAction = useCallback(async (action, { preserveError = false, operationId = action.operationId } = {}) => {
    const scope = scopeRef.current;
    setActionBusy(true);
    if (!preserveError) setError(null);
    try {
      const next = await sendProposalRankingAction(action);
      if (!mountedRef.current || scope !== scopeRef.current) return null;
      applyMutationResponse(next, scope);
      if (action.action === 'open') setPendingOpen(null);
      if (operationId) lastOperationRef.current = null;
      if (operationId) setOperationNotice(`Saved (${next.operation?.result || action.action}).`);
      setPendingConfirmation(null);
      setTransferConfirmed(false);
      setCancelConfirmed(false);
      return next;
    } catch (err) {
      if (!mountedRef.current || scope !== scopeRef.current) return null;
      if (err.status === 403) clearViewAfterDenial(scope);
      const current = responseError(err);
      if (err.status !== 403 && current) applyMutationResponse(current, scope);
      setError(errorMessage(err));
      const uncertain = err.code === 'uncertain_outcome' || !err.status || err.status >= 500;
      if (action.action === 'open') setPendingOpen(uncertain ? action : null);
      if (uncertain && action.roundId && operationId) {
        lastOperationRef.current = { roundId: action.roundId, operationId };
        setOperationNotice('Checking whether the save reached the server…');
        try {
          const reconciled = await sendProposalRankingAction({ action: 'read', roundId: action.roundId, operationId });
          if (!mountedRef.current || scope !== scopeRef.current) return null;
          applyMutationResponse(reconciled, scope);
          setOperationNotice(reconciled.operation?.status === 'confirmed'
            ? `Save confirmed (${reconciled.operation.result}).`
            : reconciled.operation?.status === 'superseded'
              ? 'A newer order is saved; review the current list before retrying.'
              : 'The outcome is still uncertain. Keep the order marked unsaved and refresh again.');
          if (reconciled.operation?.status === 'confirmed' || reconciled.operation?.status === 'superseded') lastOperationRef.current = null;
        } catch (readbackError) {
          if (readbackError.status === 403) clearViewAfterDenial(scope);
          else if (mountedRef.current && scope === scopeRef.current) setOperationNotice('Readback failed. The order remains visibly unsaved; refresh to reconcile before retrying.');
        }
      }
      return null;
    } finally {
      if (mountedRef.current && scope === scopeRef.current) setActionBusy(false);
    }
  }, [applyMutationResponse, clearViewAfterDenial]);

  const requestScopeKey = `${cycleCode}:${selectedProgram}`;
  const loading = requestBusy || settledScopeKey !== requestScopeKey;
  const responseForCurrentScope = responseScopeKey === requestScopeKey ? response : null;
  const round = responseForCurrentScope?.round;
  const isFacilitator = responseForCurrentScope?.viewer?.isFacilitator === true;
  const capabilities = responseForCurrentScope?.viewer?.capabilities || EMPTY_CAPABILITIES;
  const hasPendingSave = Object.values(saveStates).some((state) => state === 'saving');
  const hasUnresolvedSave = Boolean(pendingOpen) || Object.values(saveStates).some((state) => state === 'saving' || state === 'unsaved' || state === 'conflict');

  const invalidateVisibleScope = useCallback(() => {
    if (actionBusy || hasUnresolvedSave) return false;
    scopeRef.current += 1;
    loadRef.current += 1;
    queuesRef.current.clear();
    lastOperationRef.current = null;
    responseRef.current = null;
    setResponse(null);
    setResponseScopeKey(null);
    setError(null);
    setOperationNotice(null);
    setLocalOrders({});
    localOrdersRef.current = {};
    setRemoteOrders({});
    remoteOrdersRef.current = {};
    setSaveStates({});
    saveStatesRef.current = {};
    setRequestBusy(false);
    setPendingConfirmation(null);
    setTransferSelection('');
    setTransferConfirmed(false);
    setCancelConfirmed(false);
    return true;
  }, [actionBusy, hasUnresolvedSave]);

  const changeCycle = useCallback((nextCycle) => {
    if (nextCycle === cycleCode || !invalidateVisibleScope()) return;
    setCycleCode(nextCycle);
    setSelectedProgram('se');
  }, [cycleCode, invalidateVisibleScope]);

  const changeProgram = useCallback((nextProgram) => {
    if (nextProgram === selectedProgram || !invalidateVisibleScope()) return;
    setSelectedProgram(nextProgram);
  }, [invalidateVisibleScope, selectedProgram]);

  const queueOrder = useCallback((list, order, actionName) => {
    const current = responseRef.current;
    if (!current?.roundId || current.round?.state !== 'active') return;
    const scope = scopeRef.current;
    const action = actionName === 'edit' ? 'edit' : 'save';
    setLocalOrder(list.listKey, order, scope);
    setRemoteOrder(list.listKey, null, scope);
    assignSaveState(list.listKey, 'saving', scope);
    queuesRef.current.set(list.listKey, { scope, action, programKey: list.programKey, order });

    const drain = async () => {
      if (drainingRef.current.has(list.listKey)) return;
      drainingRef.current.add(list.listKey);
      try {
        while (queuesRef.current.has(list.listKey)) {
          const job = queuesRef.current.get(list.listKey);
          queuesRef.current.delete(list.listKey);
          if (!mountedRef.current || job.scope !== scopeRef.current) continue;
          const latest = responseRef.current;
          const activeList = findList(latest, list.listKey);
          if (!activeList || latest?.roundId !== current.roundId) {
            assignSaveState(list.listKey, 'conflict', job.scope);
            break;
          }
          const operationId = createOperationId();
          try {
            const next = await sendProposalRankingAction({
              action: job.action,
              roundId: latest.roundId,
              programKey: job.programKey,
              order: job.order,
              etag: activeList.etag,
              policyRevision: latest.round.policyRevision,
              operationId,
            });
            if (!mountedRef.current || job.scope !== scopeRef.current) continue;
            applyMutationResponse(next, job.scope);
            lastOperationRef.current = null;
            if (queuesRef.current.has(list.listKey)) continue;
            const currentOrder = findListOrder(next, list.listKey);
            if (!currentOrder || !sameOrder(currentOrder, job.order)) {
              if (currentOrder) setRemoteOrder(list.listKey, currentOrder, job.scope);
              assignSaveState(list.listKey, 'conflict', job.scope);
              setOperationNotice('Your save completed, but a newer order is now current. Compare the orders before retrying.');
              break;
            }
            clearLocalOrder(list.listKey, job.scope);
            setRemoteOrder(list.listKey, null, job.scope);
            assignSaveState(list.listKey, 'saved', job.scope);
            setOperationNotice(`Saved ${job.programKey === 'co' ? 'SE + MR' : job.programKey.toUpperCase()} order.`);
          } catch (err) {
            if (!mountedRef.current || job.scope !== scopeRef.current) continue;
            const currentResponse = responseError(err);
            if (err.status === 403) clearViewAfterDenial(job.scope);
            else if (currentResponse) {
              applyMutationResponse(currentResponse, job.scope);
              const serverOrder = findListOrder(currentResponse, list.listKey);
              if (serverOrder) setRemoteOrder(list.listKey, serverOrder, job.scope);
            }
            queuesRef.current.delete(list.listKey);
            assignSaveState(list.listKey, err.status === 409 ? 'conflict' : 'unsaved', job.scope);
            setError(errorMessage(err));
            const uncertain = err.code === 'uncertain_outcome' || !err.status || err.status >= 500;
            if (uncertain) {
              lastOperationRef.current = { roundId: latest.roundId, operationId };
              setOperationNotice('The order may have been saved. Reading back the operation before marking it complete…');
              try {
                const reconciled = await sendProposalRankingAction({ action: 'read', roundId: latest.roundId, operationId });
                if (!mountedRef.current || job.scope !== scopeRef.current) continue;
                applyMutationResponse(reconciled, job.scope);
                if (job.scope !== scopeRef.current) continue;
                const serverOrder = findListOrder(reconciled, list.listKey);
                const desired = localOrdersRef.current[list.listKey] || job.order;
                if (serverOrder && sameOrder(serverOrder, desired)) {
                  clearLocalOrder(list.listKey, job.scope);
                  setRemoteOrder(list.listKey, null, job.scope);
                  assignSaveState(list.listKey, 'saved', job.scope);
                  lastOperationRef.current = null;
                  setOperationNotice(`Save confirmed (${reconciled.operation?.result || 'order saved'}).`);
                } else {
                  assignSaveState(list.listKey, 'unsaved', job.scope);
                  if (reconciled.operation?.status === 'superseded') lastOperationRef.current = null;
                  setOperationNotice('The order is still unsaved or has been superseded. Refresh before retrying.');
                }
              } catch (readbackError) {
                if (readbackError.status === 403) clearViewAfterDenial(job.scope);
                else if (mountedRef.current && job.scope === scopeRef.current) setOperationNotice('Readback failed. The order remains visibly unsaved; refresh before retrying.');
              }
            }
            break;
          }
        }
      } finally {
        drainingRef.current.delete(list.listKey);
      }
    };
    void drain();
  }, [applyMutationResponse, assignSaveState, clearLocalOrder, clearViewAfterDenial, setLocalOrder, setRemoteOrder]);

  const submitList = useCallback(async (list, order) => {
    const current = responseRef.current;
    if (!current?.roundId || saveStatesRef.current[list.listKey] === 'saving') return;
    const scope = scopeRef.current;
    setSubmitting(list.listKey);
    try {
      await runAction({
        action: 'submit',
        roundId: current.roundId,
        programKey: list.programKey,
        order,
        etag: list.etag,
        policyRevision: current.round.policyRevision,
        operationId: createOperationId(),
      });
    } finally {
      if (mountedRef.current && scope === scopeRef.current) setSubmitting(null);
    }
  }, [runAction]);

  const retryUnsaved = (list) => {
    if (saveStatesRef.current[list.listKey] === 'saving') return;
    const order = localOrdersRef.current[list.listKey];
    if (order) queueOrder(list, order, list.owner ? 'save' : 'edit');
  };

  const openRound = () => {
    const preview = responseRef.current?.preview;
    if (!preview?.canOpen || pendingOpen || actionBusy) return;
    void runAction({ action: 'open', dryRun, cycleCode, previewFingerprint: preview.previewFingerprint, operationId: createOperationId() });
  };

  const generateProgram = (programKey) => {
    const current = responseRef.current;
    const token = current?.confirmations?.generate?.[programKey];
    const meeting = current?.programs?.[programKey]?.meeting;
    if (!current?.roundId || !token || (!meeting && programKey !== 'co')) return;
    setPendingConfirmation(null);
    if (programKey === 'co') {
      setViewChoice(null);
      void runAction({ action: 'combine', roundId: current.roundId, policyRevision: current.round.policyRevision, confirmationFingerprint: token.fingerprint, operationId: createOperationId() });
      return;
    }
    void runAction({ action: 'generate', roundId: current.roundId, programKey, etag: meeting.etag, policyRevision: current.round.policyRevision, confirmationFingerprint: token.fingerprint, operationId: createOperationId() });
  };

  const publishProgram = (programKey) => {
    const current = responseRef.current;
    const token = current?.confirmations?.publish?.[programKey];
    const meeting = current?.programs?.[programKey]?.meeting;
    if (!current?.roundId || !token || !meeting) return;
    setPendingConfirmation(null);
    void runAction({ action: 'publish', roundId: current.roundId, programKey, etag: meeting.etag, policyRevision: current.round.policyRevision, confirmationFingerprint: token.fingerprint, operationId: createOperationId() });
  };

  const confirmDryRunReset = () => {
    const current = responseRef.current;
    const token = current?.confirmations?.resetDryRun;
    if (!current?.roundId || !token || resetConfirmed !== token.fingerprint || hasUnresolvedSave || actionBusy) return;
    setResetConfirmed(false);
    void runAction({ action: 'resetDryRun', roundId: current.roundId, policyRevision: current.round.policyRevision, confirmationFingerprint: token.fingerprint, operationId: createOperationId() });
  };

  const confirmCancel = () => {
    const current = responseRef.current;
    const token = current?.confirmations?.cancel;
    if (!current?.roundId || !token || !cancelConfirmed || hasUnresolvedSave) return;
    void runAction({ action: 'cancel', roundId: current.roundId, policyRevision: current.round.policyRevision, confirmationFingerprint: token.fingerprint, operationId: createOperationId() });
  };

  const transferFacilitator = () => {
    const current = responseRef.current;
    if (!current?.roundId || !transferSelection || !transferConfirmed || hasUnresolvedSave) return;
    const successor = current.round.snapshot.roster.find((person) => person.systemUserId === transferSelection);
    if (!successor) return;
    void runAction({ action: 'transfer', roundId: current.roundId, successorSystemUserId: successor.systemUserId, policyRevision: current.round.policyRevision, operationId: createOperationId() });
  };

  const activeResponse = responseForCurrentScope;
  const currentProposalData = activeResponse?.mode === 'preview' ? activeResponse.preview : activeResponse?.mode === 'round' ? activeResponse.round?.snapshot : null;
  const currentProposalById = new Map((currentProposalData?.proposals || []).map((proposal) => [proposal.requestId, proposal]));
  const viewScope = `${activeResponse?.roundId}:${activeResponse?.viewer?.systemUserId}:${selectedProgram}`;
  const hasPublishedProgram = Object.values(activeResponse?.programs || {}).some((data) => (data.meetingStatus || data.meeting?.status) === 'published');
  const selectedPublished = (activeResponse?.programs?.[selectedProgram]?.meetingStatus || activeResponse?.programs?.[selectedProgram]?.meeting?.status) === 'published';
  const availableViews = [
    ...(selectedProgram !== 'co' && activeResponse?.viewer?.isRosterParticipant ? [{ key: 'mine', label: 'My rankings' }] : []),
    ...(isFacilitator ? [{ key: 'facilitate', label: 'Facilitate' }] : []),
    ...(hasPublishedProgram && (isFacilitator || activeResponse?.viewer?.isRosterParticipant) ? [{ key: 'meeting', label: 'Meeting list' }] : []),
  ];
  const defaultView = selectedPublished ? 'meeting' : selectedProgram === 'co' ? (isFacilitator ? 'facilitate' : 'meeting') : activeResponse?.viewer?.isRosterParticipant ? 'mine' : 'facilitate';
  const view = viewChoice?.scope === viewScope && availableViews.some((item) => item.key === viewChoice.key) ? viewChoice.key : defaultView;
  const preview = activeResponse?.preview;
  const unscoredCount = (preview?.proposals || []).filter((proposal) => !proposal.score?.ratedCount).length;

  return <div className="mx-auto max-w-7xl px-4 pb-10">
    <PageHeader title="Proposal Ranking" subtitle="Prepare private PD rankings and facilitate the funding-cycle discussion." icon="▤">
      <div className="mx-auto mt-5 flex max-w-lg flex-wrap items-end justify-center gap-3 text-left">
        <label className="min-w-48 flex-1 text-sm font-medium text-gray-700" htmlFor="proposal-ranking-cycle">Funding cycle
        <select id="proposal-ranking-cycle" value={cycleCode} onChange={(event) => { setDryRun(false); changeCycle(event.target.value); }} disabled={loading || actionBusy || hasUnresolvedSave} className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50">
            {options.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" size="sm" disabled={loading || actionBusy || hasPendingSave} onClick={() => loadCurrent({ keepDrafts: true })}>Refresh</Button>
      </div>
    </PageHeader>

    <div className="space-y-4">
      {error && <StatusBanner kind="error">{error}</StatusBanner>}
      {operationNotice && <StatusBanner>{operationNotice}</StatusBanner>}
      {pendingOpen && <StatusBanner kind="warning">Opening may have completed. Resolve this attempt before opening another round. <Button type="button" variant="outline" size="sm" disabled={actionBusy} onClick={() => runAction(pendingOpen)}>Resolve opening attempt</Button></StatusBanner>}
      {loading && <StatusBanner>Loading the {cycleCode} cycle…</StatusBanner>}
      {!loading && !activeResponse && !error && <StatusBanner>The cycle is not available yet.</StatusBanner>}

      {!loading && activeResponse?.mode === 'waiting' && <Card hover={false}>
        <h2 className="text-lg font-semibold text-gray-900">Round not open</h2>
        <p className="mt-2 text-sm text-gray-600">The facilitator has not opened a Proposal Ranking round for {activeResponse.cycleCode}.</p>
        <p className="mt-1 text-sm text-gray-600">Refresh this page after the round opens.</p>
      </Card>}

      {!loading && activeResponse?.mode === 'preview' && <>
        <Card hover={false}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{activeResponse.cycleCode} proposal pool</h2>
              <p className="mt-1 text-sm text-gray-600">Opening saves the current proposals and review scores for this round.</p>
            </div>
            <p className="text-sm font-medium text-gray-700">{preview?.proposals?.length || 0} proposals · {preview?.roster?.length || 0} PDs</p>
          </div>
          {(preview?.outstandingReviewCount > 0 || unscoredCount > 0) && <p className="mt-3 text-sm text-amber-900">{preview?.outstandingReviewCount || 0} outstanding external reviews · {unscoredCount} unscored proposals</p>}
          <p className="mt-2 text-sm text-gray-700">Participating PDs: {(preview?.roster || []).map((person) => person.name || 'Unnamed PD').join(', ') || 'None assigned'}</p>
          {preview?.warnings?.length > 0 && <ul className="mt-4 list-disc space-y-1 rounded-lg bg-amber-50 p-4 pl-8 text-sm text-amber-950">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {preview?.unexpectedStatuses?.length > 0 && <StatusBanner kind="warning" className="mt-3">Unexpected proposal statuses need review: {preview.unexpectedStatuses.join(', ')}.</StatusBanner>}
          {preview?.roster?.some((person) => !person.hasAppAccess) && <StatusBanner kind="error" className="mt-3">Every captured PD needs Proposal Ranking app access before this round can open.</StatusBanner>}
          {capabilities.open && <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} disabled={actionBusy || Boolean(pendingOpen)} className="mt-0.5 rounded border-gray-300" />
            Open as a dry run. The facilitator can permanently erase its rankings, even after publication.
          </label>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {capabilities.open && <Button type="button" disabled={actionBusy || Boolean(pendingOpen) || !preview?.canOpen} loading={actionBusy} onClick={openRound}>{dryRun ? 'Open dry run' : 'Open round'}</Button>}
          </div>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          {PROGRAMS.filter((program) => program.key !== 'co').map((program) => {
            const ids = activeResponse.preview?.seedOrders?.[program.key] || [];
            const programCards = ids.map((id) => currentProposalById.get(id)).filter(Boolean).map((proposal) => ({
              ...proposal,
              leadName: preview.roster?.find((person) => person.systemUserId === proposal.leadSystemUserId)?.name || 'Unassigned',
            }));
            return <Card key={program.key} hover={false} padding="p-4">
              <h3 className="mb-3 text-base font-semibold text-gray-900">{program.label} starting order</h3>
              <ProposalOrder list={{ order: ids }} proposals={programCards} editable={false} />
            </Card>;
          })}
        </div>
      </>}

      {!loading && activeResponse?.mode === 'round' && round && <>
        {round.dryRun && !round.erased && <StatusBanner kind="warning">Dry run — practice rankings only. The facilitator can permanently erase this run after testing.</StatusBanner>}
        {round.state === 'canceled' && <StatusBanner kind="warning">{round.erased ? 'Dry-run rankings permanently erased. You can open a fresh round.' : 'This round was canceled and is read-only.'} <Button type="button" variant="outline" size="sm" onClick={() => loadCurrent({ keepDrafts: false, cyclePreview: true })}>View current cycle preview</Button></StatusBanner>}
        {!round.erased && <>
        {round.state === 'active' && round.snapshot.roster.some((person) => person.excluded) && <StatusBanner kind="warning">Every participant is required. This older round contains an excusal and cannot generate or publish another composite.</StatusBanner>}
        <Card hover={false} padding="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{activeResponse.cycleCode} ranking round</h2>
              <p className="mt-1 text-sm text-gray-600">Facilitator: {round.facilitator.name} · {round.snapshot.proposals.length} frozen proposals · {round.snapshot.roster.length} PDs</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {PROGRAMS.filter((program) => program.key !== 'co' || activeResponse.programs?.co?.available).map((program) => <Button key={program.key} type="button" variant={selectedProgram === program.key ? 'primary' : 'outline'} size="sm" aria-pressed={selectedProgram === program.key} disabled={loading || actionBusy || hasUnresolvedSave} onClick={() => changeProgram(program.key)}>{program.shortLabel}</Button>)}
            </div>
          </div>
        </Card>
        <nav aria-label="Ranking views" className="flex flex-wrap gap-2">
          {availableViews.map((item) => <Button key={item.key} type="button" variant={view === item.key ? 'primary' : 'outline'} aria-pressed={view === item.key} disabled={loading || actionBusy || hasUnresolvedSave} onClick={() => { setViewChoice({ scope: viewScope, key: item.key }); setPendingConfirmation(null); }}>{item.label}</Button>)}
        </nav>
        <div className={view === 'facilitate' ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]' : 'space-y-4'}>
          <Card hover={false}>
            <ProgramPanel
              response={activeResponse}
              program={PROGRAMS.find((program) => program.key === selectedProgram)}
              isFacilitator={isFacilitator}
              view={view}
              localOrders={localOrders}
              remoteOrders={remoteOrders}
              saveStates={saveStates}
              actionBusy={actionBusy}
              hasUnresolvedSave={hasUnresolvedSave}
              submitting={submitting}
              onMove={queueOrder}
              onSubmit={submitList}
              onGenerate={generateProgram}
              onPublish={publishProgram}
              pendingConfirmation={pendingConfirmation}
              setPendingConfirmation={setPendingConfirmation}
              onRetry={retryUnsaved}
            />
          </Card>
          {view === 'facilitate' && <aside className="space-y-4">
            <Card hover={false} padding="p-4">
              <h2 className="font-semibold text-gray-900">Round progress</h2>
              <ul className="mt-3 space-y-3">
                {PROGRAMS.filter((program) => program.key !== 'co').map((program) => {
                  const data = activeResponse.programs?.[program.key];
                  return <li key={program.key} className="rounded-lg bg-gray-50 p-3 text-sm">
                    <p className="font-semibold text-gray-900">{program.shortLabel}</p>
                    {data?.proposalIds?.length === 0 ? <p className="mt-1 text-gray-600">No proposals</p> : <>
                      <p className="mt-1 text-gray-700">{data?.progress?.submitted || 0} / {data?.progress?.required || 0} submissions</p>
                      {data?.progress?.outstandingNames?.length > 0 && <p className="mt-1 text-xs text-gray-600">Waiting for {data.progress.outstandingNames.join(', ')}</p>}
                      <p className="mt-1 text-xs text-gray-600">{(data?.meetingStatus || data?.meeting?.status) === 'published' ? 'Published' : (data?.meetingStatus || data?.meeting?.status) === 'composite-draft' ? 'Draft ready' : data?.progress?.required > 0 && data.progress.submitted === data.progress.required ? 'Ready to generate' : 'Waiting for submissions'}</p>
                    </>}
                  </li>;
                })}
              </ul>
            </Card>
            <Card hover={false} padding="p-4">
              <h2 className="font-semibold text-gray-900">Captured PD roster</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {round.snapshot.roster.map((person) => <li key={person.systemUserId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{person.name}{person.systemUserId === round.facilitator.systemUserId ? ' · facilitator' : ''}</span>
                  {person.excluded && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700">Excused from voting</span>}
                </li>)}
              </ul>
            </Card>
          </aside>}
        </div>
        {(view === 'facilitate' || !isFacilitator) && (capabilities.transferFacilitator || capabilities.cancelRound || capabilities.resetDryRun) && <Card hover={false}>
          <details><summary className="cursor-pointer font-semibold text-gray-900">Round administration</summary>
          {capabilities.transferFacilitator && <div className="mt-3 space-y-3">
            <label className="block text-sm font-medium text-gray-700">Transfer facilitation to
              <select value={transferSelection} onChange={(event) => { setTransferSelection(event.target.value); setTransferConfirmed(false); }} disabled={actionBusy || hasUnresolvedSave} className="mt-1 h-10 w-full max-w-md rounded-lg border border-gray-300 bg-white px-3">
                <option value="">Choose a captured PD</option>
                {round.snapshot.roster.filter((person) => person.systemUserId !== round.facilitator.systemUserId).map((person) => <option key={person.systemUserId} value={person.systemUserId}>{person.name}{person.excluded ? ' · excused voter' : ''}</option>)}
              </select>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={transferConfirmed} onChange={(event) => setTransferConfirmed(event.target.checked)} disabled={actionBusy || hasUnresolvedSave || !transferSelection} className="mt-0.5 rounded border-gray-300" />
              I understand the new facilitator gains facilitator visibility and my later access follows my captured roster status.
            </label>
            <Button type="button" size="sm" disabled={actionBusy || hasUnresolvedSave || !transferSelection || !transferConfirmed} onClick={transferFacilitator}>Transfer facilitation</Button>
          </div>}
          {capabilities.resetDryRun && activeResponse.confirmations?.resetDryRun && <div className="mt-5 border-t border-gray-200 pt-4">
            <h3 className="font-medium text-gray-900">Erase this dry run</h3>
            <p className="mt-2 text-sm text-amber-900">{activeResponse.confirmations.resetDryRun.message}</p>
            <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={resetConfirmed === activeResponse.confirmations.resetDryRun.fingerprint} onChange={(event) => setResetConfirmed(event.target.checked ? activeResponse.confirmations.resetDryRun.fingerprint : false)} disabled={actionBusy || hasUnresolvedSave} className="mt-0.5 rounded border-gray-300" />
              I understand all rankings in this dry run will be permanently erased and cannot be restored in this app.
            </label>
            <Button type="button" variant="danger" size="sm" disabled={actionBusy || hasUnresolvedSave || resetConfirmed !== activeResponse.confirmations.resetDryRun.fingerprint} onClick={confirmDryRunReset} className="mt-3">Permanently erase dry run</Button>
          </div>}
          {capabilities.cancelRound && <div className="mt-5 border-t border-gray-200 pt-4">
            <h3 className="font-medium text-gray-900">Cancel this round</h3>
            <p className="mt-1 text-sm text-gray-600">Cancellation is available only before either program is published. The round remains read-only and a replacement uses fresh snapshots.</p>
            {activeResponse.confirmations?.cancel ? <>
              <p className="mt-2 text-sm text-amber-900">{activeResponse.confirmations.cancel.message}</p>
              <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={cancelConfirmed} onChange={(event) => setCancelConfirmed(event.target.checked)} disabled={actionBusy || hasUnresolvedSave} className="mt-0.5 rounded border-gray-300" />
                I understand this round will become read-only.
              </label>
              <Button type="button" variant="danger" size="sm" disabled={actionBusy || hasUnresolvedSave || !cancelConfirmed} onClick={confirmCancel} className="mt-3">Cancel round</Button>
            </> : <p className="mt-2 text-sm text-gray-600">Cancellation is unavailable after a program is published.</p>}
          </div>}
          </details>
        </Card>}
        {Object.entries(saveStates).some(([, state]) => state === 'unsaved' || state === 'conflict') && <div className="flex flex-wrap items-center gap-3">
          <StatusBanner kind="warning">An order has unconfirmed changes. Refresh the round, compare the current list, then retry the displayed order before submitting or continuing.</StatusBanner>
          <Button type="button" variant="outline" size="sm" disabled={loading || actionBusy} onClick={() => loadCurrent({ keepDrafts: true })}>Refresh current state</Button>
        </div>}
        </>}
      </>}
    </div>
  </div>;
}

function findList(response, listKey) {
  if (!response?.programs) return null;
  for (const program of Object.values(response.programs)) {
    if (program?.ownList?.listKey === listKey) return program.ownList;
    const facilitatorList = program?.facilitatorLists?.find((list) => list.listKey === listKey);
    if (facilitatorList) return facilitatorList;
    if (program?.meeting?.listKey === listKey) return program.meeting;
  }
  return null;
}

function findListOrder(response, listKey) {
  return findList(response, listKey)?.order || null;
}

function sameOrder(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => item === right[index]);
}
