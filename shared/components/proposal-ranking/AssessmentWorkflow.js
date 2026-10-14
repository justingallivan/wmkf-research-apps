import { useCallback, useEffect, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {
  GripVertical,
} from 'lucide-react';
import { Button } from '../Layout';
import {
  createOperationId,
  loadProposalRanking,
  sendProposalRankingAction,
} from './client';
import { formatMoney } from './model';
import {
  assessmentItems,
  moveAssessmentItem,
  FIRST_BOUNDARY,
  SECOND_BOUNDARY,
} from './assessment-model';
import {
  gradeAt,
  calculateSectionTotals,
} from '../../../lib/services/proposal-ranking/assessments';

function RankingDialog({ label, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const prior = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      prior?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="w-full max-w-lg rounded-xl p-6 backdrop:bg-black/30"
    >
      {children}
    </dialog>
  );
}
const gradeClasses = {
  A: 'bg-[#d5edda] text-[#205632]',
  B: 'bg-[#ffeb9c] text-[#654c00]',
  C: 'bg-[#f8d6d4] text-[#8a2825]',
};
const tileClass = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded font-semibold text-[15px] leading-none';
const buttonClass =
  'min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
function Grade({ value, confidence }) {
  return <span className={`${tileClass} border-2 ${confidence === 'not-sure' ? 'border-dashed border-current' : confidence === 'confident' ? 'border-solid border-current' : 'border-transparent'} ${gradeClasses[value] || 'bg-gray-100 text-gray-700'}`}>
    {value || '—'}
  </span>;
}
function PeerScores({ score }) {
  const ratings = [
    ['Excellent', 'E', gradeClasses.A],
    ['Very Good', 'VG', 'bg-[#e4edb2] text-[#475716]'],
    ['Good', 'G', gradeClasses.B],
    ['Fair', 'F', 'bg-[#f9d6aa] text-[#75410f]'],
    ['Poor', 'P', gradeClasses.C],
  ];
  const tiles = ratings.flatMap(([label, short, color]) =>
    Array.from({ length: score?.distribution?.[label] || 0 }, (_, i) => (
      <span key={`${label}-${i}`} title={label} aria-label={label}
        className={`${tileClass} border border-current ${color}`}>{short}</span>
    )),
  );
  return <div>
    <p className="mb-2 text-xs font-medium text-gray-700">Peer reviews</p>
    <div className="flex flex-wrap gap-1">{tiles.length ? tiles : <span className="text-sm text-gray-600">Not available</span>}</div>
  </div>;
}

export function AssessmentList({
  assessment,
  proposals,
  roster,
  collective,
  editable,
  onChange,
  sentiment,
  onSentimentRefresh,
  highlightedId,
  showMissingConfidence = false,
}) {
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [moving, setMoving] = useState(null);
  const [destination, setDestination] = useState('1');
  const [positionError, setPositionError] = useState('');
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const byId = new Map(proposals.map((p) => [p.requestId, p]));
  const items = assessmentItems(assessment);
  // Private program lists contain only part of the full proposal pool.
  const sectionTotals = collective
    ? calculateSectionTotals(assessment.order, assessment.boundaries, proposals)
    : null;
  const move = (from, to) => {
    const next = moveAssessmentItem(assessment, from, to);
    if (next !== assessment) {
      onChange(next);
      setNotice('Position and section updated. Saving changes.');
    } else setNotice('The dividers cannot cross.');
  };
  const minimumPosition = moving === FIRST_BOUNDARY ? 0
    : moving === SECOND_BOUNDARY ? assessment.boundaries[0] : 1;
  const maximumPosition = moving === FIRST_BOUNDARY
    ? assessment.boundaries[1] : assessment.order.length;
  const setPosition = (event) => {
    event.preventDefault();
    if (!editable) return;
    const value = Number(destination);
    if (!destination.trim() || !Number.isInteger(value) ||
        value < minimumPosition || value > maximumPosition) {
      setPositionError(`Enter a whole number from ${minimumPosition} to ${maximumPosition}.${moving === FIRST_BOUNDARY || moving === SECOND_BOUNDARY ? ' The section dividers cannot cross.' : ''}`);
      return;
    }
    if (moving === FIRST_BOUNDARY || moving === SECOND_BOUNDARY) {
      const bar = moving === FIRST_BOUNDARY ? 0 : 1;
      const boundaries = [...assessment.boundaries];
      boundaries[bar] = value;
      onChange({ ...assessment, boundaries });
    } else {
      const position = value - 1;
      const target = assessment.order[position];
      if (!target) return;
      move(items.indexOf(moving), items.indexOf(target));
    }
    setMoving(null);
  };
  return (
    <>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
      <DragDropContext
        onDragEnd={({ source, destination: target }) => {
          if (target) move(source.index, target.index);
        }}
      >
        <Droppable droppableId="ranking-assessments">
          {(drop) => (
            <ol
              ref={drop.innerRef}
              {...drop.droppableProps}
              className="space-y-3"
            >
              {items.map((id, index) => {
                const isBar = id === FIRST_BOUNDARY || id === SECOND_BOUNDARY;
                const position = assessment.order.indexOf(id);
                const proposal = byId.get(id);
                const individuals = [...(collective?.individuals || [])].sort((a, b) => {
                  const leadA = a.systemUserId === proposal?.leadSystemUserId;
                  const leadB = b.systemUserId === proposal?.leadSystemUserId;
                  return Number(leadB) - Number(leadA) || (a.name || '').localeCompare(b.name || '');
                });
                return (
                  <Draggable
                    key={id}
                    draggableId={id}
                    index={index}
                    isDragDisabled={!editable}
                  >
                    {(drag, dragState) => (
                      <li
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        style={{
                          ...drag.draggableProps.style,
                          ...(reduced ? { transition: 'none' } : {}),
                        }}
                        className={
                          isBar
                            ? 'py-2'
                            : `rounded-xl border bg-white ${highlightedId === id ? 'border-blue-700' : 'border-gray-200'} ${dragState.isDragging ? 'shadow-lg' : ''}`
                        }
                      >
                        {isBar ? (
                          <div className={`flex flex-wrap items-center gap-3 py-3 text-sm font-semibold ${collective && id === FIRST_BOUNDARY ? 'rounded-lg border border-green-300 bg-green-50 px-3 text-green-900' : 'border-y border-gray-200'}`}>
                            {editable && (
                              <span
                                {...drag.dragHandleProps}
                                aria-label="Move section divider"
                                className="inline-flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                              >
                                <GripVertical size={18} />
                              </span>
                            )}
                            <span>
                              {collective
                                ? id === FIRST_BOUNDARY
                                  ? 'Recommended'
                                  : 'End of Alternates'
                                : id === FIRST_BOUNDARY
                                  ? 'End of A · Fund'
                                  : 'End of B · Maybe fund'}
                            </span>
                            <span className={collective && id === FIRST_BOUNDARY ? 'sr-only' : 'ml-auto text-gray-600'}>
                              After position{' '}
                              {
                                assessment.boundaries[
                                  id === FIRST_BOUNDARY ? 0 : 1
                                ]
                              }
                            </span>
                            {collective && id === FIRST_BOUNDARY && (
                              <>
                                <span className="text-2xl tabular-nums">{formatMoney(sectionTotals[0].amountMinorUnits, proposals[0]?.currency, { incomplete: !sectionTotals[0].complete })}</span>
                                <span>{sectionTotals[0].count} {sectionTotals[0].count === 1 ? 'proposal' : 'proposals'}</span>
                                <span className="ml-auto">East {sectionTotals[0].geography.East} · West {sectionTotals[0].geography.West}{sectionTotals[0].geography.Unknown > 0 && ` · Unknown ${sectionTotals[0].geography.Unknown}`}</span>
                              </>
                            )}
                            {editable && (
                              <button
                                className={buttonClass}
                                onClick={() => {
                                  setMoving(id);
                                  setPositionError('');
                                  setDestination(
                                    String(
                                      assessment.boundaries[
                                        id === FIRST_BOUNDARY ? 0 : 1
                                      ],
                                    ),
                                  );
                                }}
                              >
                                Set boundary…
                              </button>
                            )}
                          </div>
                        ) : (
                          <div
                            id={`proposal-${id}`}
                            tabIndex={-1}
                            aria-label={`${proposal.organization}, proposal ${proposal.requestNumber}`}
                            className={`flex scroll-mt-56 items-start gap-2 rounded-xl p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 sm:gap-4 ${showMissingConfidence && !assessment.confidence?.[id] ? 'ring-2 ring-inset ring-red-600' : ''}`}
                          >
                            <div className="flex shrink-0 self-center">
                              {editable && (
                                <span
                                  {...drag.dragHandleProps}
                                  aria-label={`Move ${proposal.organization}, position ${position + 1}`}
                                  className="inline-flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded text-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                                >
                                  <GripVertical size={20} />
                                </span>
                              )}

                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
                              {editable ? (
                                <button
                                  type="button"
                                  aria-label={`Move ${proposal.organization} to position; current position ${position + 1}`}
                                  title="Move to position"
                                  className="inline-block min-h-11 min-w-6 -my-2 py-2 text-center rounded text-xl font-bold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                                  onClick={() => {
                                    setMoving(id);
                                    setPositionError('');
                                    setDestination(String(position + 1));
                                  }}
                                >{position + 1}</button>
                              ) : <span className="min-w-6 text-xl font-bold tabular-nums">{position + 1}</span>}
                                <div className="min-w-0 flex-1">
                                  <h3 className="text-lg font-semibold text-gray-900">{proposal.organization || 'Institution unavailable'}</h3>
                                  <a href={`/workbench/${encodeURIComponent(proposal.requestId)}`} className="break-words text-base text-blue-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2">{proposal.title || 'Untitled proposal'}</a>
                                </div>
                                <p className="col-start-2 text-right tabular-nums sm:col-start-3"><span className="mr-2 text-xs text-gray-600">Requested</span><strong>{proposal.amountMinorUnits == null ? 'Unavailable' : formatMoney(proposal.amountMinorUnits, proposal.currency)}</strong></p>
                              </div>
                              <div className="ml-11 mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(8rem,.55fr)_auto]">
                                {collective ? <div className="col-span-2 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] items-end gap-x-2 gap-y-3 lg:col-span-1">
                                  {individuals.map((pd) => {
                                    const lead = pd.systemUserId === proposal.leadSystemUserId;
                                    const grade = gradeAt(pd.order.indexOf(id), pd.boundaries);
                                    const firstName = pd.name?.trim().split(/\s+/)[0] || 'Unknown PD';
                                    const duplicateFirstName = individuals.some((other) => other.systemUserId !== pd.systemUserId && other.name?.trim().split(/\s+/)[0] === firstName);
                                    return <div key={pd.systemUserId} className="flex min-w-0 flex-col items-center text-center" aria-label={`${pd.name}${lead ? ', lead PD' : ''}: grade ${grade}, ${pd.confidence[id] === 'confident' ? 'confident' : pd.confidence[id] === 'not-sure' ? 'not sure' : 'confidence unavailable'}`}>
                                      <p title={`${pd.name}${lead ? ' · Lead PD' : ''}`} className={`mb-2 max-w-full break-words text-xs font-medium text-gray-700 ${lead ? 'font-bold text-gray-900 underline decoration-[3px] decoration-gray-900 underline-offset-4' : ''}`}>{duplicateFirstName ? pd.name : firstName}</p>
                                      <Grade value={grade} confidence={pd.confidence[id]} />
                                    </div>;
                                  })}
                                </div> : (
                                  <fieldset
                                    disabled={!editable}
                                    className={`col-span-2 flex flex-wrap items-center gap-4 lg:col-span-1 ${!assessment.confidence[id] ? 'rounded-md border border-amber-400 bg-amber-50 px-3 pb-2' : ''}`}
                                  >
                                    <legend className="mb-1 text-sm text-gray-600">
                                      Confidence in my assessment
                                      {!assessment.confidence[id] && <span className="ml-2 font-semibold text-amber-900">Choose one</span>}
                                    </legend>
                                    <Grade
                                      confidence={assessment.confidence[id]}
                                      value={gradeAt(
                                        position,
                                        assessment.boundaries,
                                      )}
                                    />
                                    {[
                                      ['confident', 'Confident'],
                                      ['not-sure', 'Not sure'],
                                    ].map(([value, label]) => (
                                      <label
                                        key={value}
                                        className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
                                      >
                                        <input
                                          type="radio"
                                          name={`confidence-${id}`}
                                          checked={
                                            assessment.confidence[id] === value
                                          }
                                          onChange={() =>
                                            onChange({
                                              ...assessment,
                                              confidence: {
                                                ...assessment.confidence,
                                                [id]: value,
                                              },
                                            })
                                          }
                                        />
                                        {label}
                                      </label>
                                    ))}
                                  </fieldset>
                                )}
                                <PeerScores score={proposal.score} />
                                <div className="flex justify-end gap-1.5">
                                  <span title={proposal.programKey?.toUpperCase() || 'Program unavailable'} className={`${tileClass} border border-gray-300 bg-gray-100 text-gray-700`}>{proposal.programKey?.toUpperCase() || '—'}</span>
                                  <span title={proposal.institutionGeography || 'Geography unavailable'} className={`${tileClass} border border-gray-300 bg-gray-100 text-gray-700`}>{['East', 'West'].includes(proposal.institutionGeography) ? proposal.institutionGeography[0] : '—'}</span>
                                </div>
                              </div>
                              <div className="ml-11 mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2 border-t border-gray-100 pt-2 text-xs text-gray-600">
                                {collective && <>
                                  <details>
                                    <summary className="cursor-pointer py-2 focus-visible:outline focus-visible:outline-2">Initial ranks</summary>
                                    <ul>{individuals.map((pd) => <li key={pd.systemUserId}>{pd.name}: #{pd.order.indexOf(id) + 1}</li>)}</ul>
                                    <p>Starting mean rank {collective.baseline.scores[id]?.averageRank?.toFixed(2) || 'Unavailable'}</p>
                                  </details>
                                  <details>
                                    <summary className="cursor-pointer py-2 focus-visible:outline focus-visible:outline-2">
                                      {['available', 'provisional'].includes(proposal.researchFunding?.status)
                                        ? `${proposal.researchFunding.status === 'provisional' ? 'Provisional: ' : ''}${proposal.researchFunding.qualifyingGrantCount} prior Research ${proposal.researchFunding.qualifyingGrantCount === 1 ? 'award' : 'awards'}${proposal.researchFunding.latestAwardYear ? ` · latest ${proposal.researchFunding.latestAwardYear}` : ''}`
                                        : 'Research history unavailable'}
                                    </summary>
                                    <div className="max-w-sm space-y-1 pb-2">
                                      {proposal.researchFunding?.sample && <p>Fictional award history for this rehearsal.</p>}
                                      <p>Total Research funding: <strong>{['available', 'provisional'].includes(proposal.researchFunding?.status) && Number.isSafeInteger(proposal.researchFunding.totalAmountMinorUnits) && proposal.researchFunding.totalAmountMinorUnits >= 0
                                        ? formatMoney(proposal.researchFunding.totalAmountMinorUnits, { code: 'USD', precision: 2 })
                                        : 'Not available'}</strong></p>
                                      <p>Most recent award: {proposal.researchFunding?.latestAwardYear || (proposal.researchFunding?.qualifyingGrantCount === 0 ? 'None recorded' : 'Not available')}</p>
                                      <p>Qualifying regular Research awards to this institution across recorded history. Excludes directed, capital, endowment, teaching, Special, and Young Scholars awards.</p>
                                      {proposal.researchFunding?.status === 'provisional' && <p>Provisional: some historical award classifications still need review.</p>}
                                      <p>Context only; does not affect ranking.</p>
                                    </div>
                                  </details>
                                    <div className="min-w-0 basis-full text-xs text-gray-600 sm:flex-1 sm:basis-64">
                                      <p>
                                        {sentiment?.sentiments?.[id]?.sample ? 'Sample discussion' : 'Earlier discussion'}:{' '}
                                        {sentiment?.status === 'access-denied'
                                          ? 'Meeting Tracker access required'
                                          : sentiment?.status ===
                                              'temporarily-unavailable'
                                            ? 'Temporarily unavailable'
                                            : sentiment?.sentiments?.[id]
                                                  ?.status === 'current'
                                              ? `${sentiment.sentiments[id].sentiment.reception} · ${sentiment.sentiments[id].sentiment.enthusiasm} enthusiasm`
                                              : sentiment?.status === 'loading'
                                                ? 'Checking current analysis…'
                                                : 'Not available'}
                                      </p>
                                      {sentiment?.sentiments?.[id]?.status ===
                                        'current' && (
                                        <>
                                          <button
                                            className="min-h-11 cursor-pointer py-2 underline"
                                            aria-expanded={expanded === id}
                                            onClick={() => {
                                              setExpanded(
                                                expanded === id ? null : id,
                                              );
                                              if (expanded !== id)
                                                onSentimentRefresh?.();
                                            }}
                                          >
                                            Discussion evidence
                                          </button>
                                          {expanded === id && (
                                            <div>
                                              <p>
                                                {
                                                  sentiment.sentiments[id]
                                                    .sentiment.headline
                                                }
                                              </p>
                                              {[
                                                'supportPoints',
                                                'concernPoints',
                                              ].map((kind) => (
                                                <div key={kind}>
                                                  <p className="mt-2 font-medium">
                                                    {kind === 'supportPoints'
                                                      ? 'Support'
                                                      : 'Concerns'}
                                                  </p>
                                                  {sentiment.sentiments[
                                                    id
                                                  ].sentiment[kind].map(
                                                    (quote, i) => (
                                                      <blockquote
                                                        key={i}
                                                        className="my-2 border-l border-gray-300 pl-3"
                                                      >
                                                        {quote.quote}
                                                        <footer className="text-xs">
                                                          {quote.speaker} ·{' '}
                                                          {quote.time}
                                                        </footer>
                                                      </blockquote>
                                                    ),
                                                  )}
                                                </div>
                                              ))}
                                              {[
                                                'disagreements',
                                                'uncertainties',
                                              ].map((kind) => (
                                                <div key={kind}>
                                                  {sentiment.sentiments[
                                                    id
                                                  ].sentiment[kind].map(
                                                    (item, i) => (
                                                      <div
                                                        key={i}
                                                        className="mt-2"
                                                      >
                                                        <p className="font-medium">
                                                          {item.topic}
                                                        </p>
                                                        {(
                                                          item.sides ||
                                                          item.evidence
                                                        ).map((quote, j) => (
                                                          <blockquote
                                                            key={j}
                                                            className="border-l border-gray-300 pl-3"
                                                          >
                                                            {quote.quote}
                                                            <footer className="text-xs">
                                                              {quote.speaker} ·{' '}
                                                              {quote.time}
                                                            </footer>
                                                          </blockquote>
                                                        ))}
                                                      </div>
                                                    ),
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>

                                  <span className={`ml-auto shrink-0 rounded px-2 py-1 font-semibold ${position < assessment.boundaries[0] ? gradeClasses.A : position < assessment.boundaries[1] ? gradeClasses.B : 'bg-gray-100 text-gray-700'}`}>
                                    {position < assessment.boundaries[0] ? 'Recommend funding' : position < assessment.boundaries[1] ? 'Alternate' : 'Not recommended'}
                                  </span>
                                </>}

                              </div>
                            </div>
                          </div>
                        )}
                      </li>
                    )}
                  </Draggable>
                );
              })}
              {drop.placeholder}
            </ol>
          )}
        </Droppable>
      </DragDropContext>
      {moving && (
        <RankingDialog label="Change position" onClose={() => setMoving(null)}>
          <form noValidate onSubmit={setPosition}>
          <label className="block">
            {moving === FIRST_BOUNDARY || moving === SECOND_BOUNDARY
              ? 'Set boundary after position'
              : 'Move to position'}
            <input
              autoFocus
              type="number"
              min={minimumPosition}
              max={maximumPosition}
              step={1}
              aria-invalid={Boolean(positionError)}
              aria-describedby="ranking-position-help ranking-position-error"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setPositionError('');
              }}
              className="mt-2 w-full rounded border p-2"
            />
          </label>
          <p id="ranking-position-help" className="mt-2 text-sm text-gray-600">
            Enter a whole number from {minimumPosition} to {maximumPosition}.
            {(moving === FIRST_BOUNDARY || moving === SECOND_BOUNDARY) && ' Dividers cannot cross; empty sections are allowed.'}
          </p>
          <p id="ranking-position-error" role="alert" className="mt-2 text-sm text-red-700">{positionError}</p>
          <div className="mt-4 flex gap-3">
            <Button type="submit" disabled={!editable}>Move</Button>
            <Button type="button" variant="outline" onClick={() => setMoving(null)}>
              Cancel
            </Button>
          </div>
          </form>
        </RankingDialog>
      )}
    </>
  );
}

export default function AssessmentWorkflow({
  initial,
  cycleOptions,
  onCycleChange,
}) {
  const [view, setView] = useState(initial);
  const [section, setSection] = useState(
    initial.workflow.stage === 'revealed' ? 'group' : 'prepare',
  );
  const [program, setProgram] = useState('mr');
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Saving changes…');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [draft, setDraft] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [history, setHistory] = useState(null);
  const [sentiment, setSentiment] = useState(null);
  const sentimentGeneration = useRef(0);
  const [find, setFind] = useState('');
  const [findResult, setFindResult] = useState(null);
  const [validationScope, setValidationScope] = useState(null);
  const [refreshed, setRefreshed] = useState(new Date());
  const generation = useRef(0);
  const busyRef = useRef(false);
  const pendingRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
      sentimentGeneration.current += 1;
    };
  }, []);
  const valid = (id) => alive.current && id === generation.current;
  const accept = (next) => {
    sentimentGeneration.current += 1;
    setSentiment(null);
    setView(next);
    if (!next.own?.co)
      setProgram((selected) => (selected === 'co' ? 'mr' : selected));
    setDraft(null);
    setPending(null);
    pendingRef.current = null;
    setError('');
    setRefreshed(new Date());
    if (next.workflow.stage === 'revealed') setSection('group');
    else if (view.workflow.stage === 'revealed') setSection('prepare');
  };
  const refresh = async () => {
    if (busyRef.current || pendingRef.current) return;
    const id = ++generation.current;
    busyRef.current = true;
    setBusyMessage('Refreshing saved work…');
    setBusy(true);
    try {
      const next = await loadProposalRanking({ roundId: view.roundId });
      if (valid(id)) accept(next);
    } catch (err) {
      if (valid(id)) {
        setError(err.message);
        if ([401, 403].includes(err.status)) setView(null);
      }
    } finally {
      if (valid(id)) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  };
  const execute = async (action, extra = {}, reuse = null) => {
    if (busyRef.current || (!reuse && pendingRef.current)) return;
    const body = reuse || {
      action,
      roundId: view.roundId,
      operationId: createOperationId(),
      roundEtag: view.round.etag,
      policyRevision: view.round.policyRevision,
      preparationVersion: view.workflow.preparationVersion,
      revealId: view.workflow.revealId,
      ...extra,
    };
    const id = ++generation.current;
    sentimentGeneration.current += 1;
    setSentiment(null);
    busyRef.current = true;
    setBusyMessage(reuse ? 'Checking and retrying your change…' : 'Saving changes…');
    setBusy(true);
    setError('');
    try {
      const next = await sendProposalRankingAction(body);
      if (valid(id)) {
        accept(next);
        if (action === 'buildCombined') setProgram('co');
        setConfirmation(null);
      }
    } catch (err) {
      if (valid(id)) {
        setError(err.message);
        if ([401, 403].includes(err.status)) {
          setView(null);
          setDraft(null);
          setPending(null);
          pendingRef.current = null;
        } else {
          setPending(body);
          pendingRef.current = body;
        }
      }
    } finally {
      if (valid(id)) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  };
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        !busyRef.current &&
        !pendingRef.current
      )
        void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
  const supplementBody = useCallback(
    (action) => ({
      action,
      roundId: view.roundId,
      roundEtag: view.round.etag,
      preparationVersion: view.workflow.preparationVersion,
      revealId: view.workflow.revealId,
      listVersion: view.collective.version,
    }),
    [view],
  );
  const refreshSentiment = useCallback(async () => {
    const id = ++sentimentGeneration.current;
    setSentiment({ status: 'loading', sentiments: {} });
    if (
      !view ||
      section !== 'group' ||
      view.workflow.stage !== 'revealed' ||
      !view.collective ||
      view.round.state !== 'active'
    )
      return;
    try {
      const result = await sendProposalRankingAction(
        supplementBody('sentiment'),
      );
      if (alive.current && id === sentimentGeneration.current)
        setSentiment(result);
    } catch (err) {
      if (alive.current && id === sentimentGeneration.current) {
        setSentiment({ status: 'temporarily-unavailable', sentiments: {} });
        if ([401, 403].includes(err.status)) setView(null);
      }
    }
  }, [view, section, supplementBody]);
  useEffect(() => {
    const timer = setTimeout(() => void refreshSentiment(), 0);
    return () => {
      clearTimeout(timer);
      sentimentGeneration.current += 1;
    };
  }, [refreshSentiment]);
  const exportWorkbook = async () => {
    if (busyRef.current || pendingRef.current) return;
    const id = ++generation.current;
    busyRef.current = true;
    setBusyMessage('Preparing workbook…');
    setBusy(true);
    try {
      const result = await sendProposalRankingAction(
        supplementBody('exportWorkbook'),
      );
      if (valid(id)) {
        const bytes = Uint8Array.from(atob(result.base64), (c) =>
          c.charCodeAt(0),
        );
        const url = URL.createObjectURL(
          new Blob([bytes], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (valid(id)) {
        setError(err.message);
        if ([401, 403].includes(err.status)) setView(null);
      }
    } finally {
      if (valid(id)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  if (!view)
    return (
      <p role="alert" className="p-8">
        Access to this round is no longer available. Reload after your access is
        restored.
      </p>
    );
  const collective = section === 'group' ? view.collective : null;
  const saved = collective || view.own?.[program];
  const assessment = draft || saved;
  const active = view.round.state === 'active';
  const outdated =
    program === 'co' &&
    view.own?.co &&
    (view.own.co.sourceVersions.se !== view.own.se.version ||
      view.own.co.sourceVersions.mr !== view.own.mr.version);
  const editable =
    active &&
    !busy &&
    !pending &&
    (collective
      ? view.workflow.stage === 'revealed'
      : view.workflow.stage === 'private' && !view.own?.ready && !outdated);
  const proposals = view.round.snapshot.proposals;
  const roster = view.round.snapshot.roster;
  const confirm = (action, extra = {}) => {
    const key =
      action === 'resetProgram' ? `${action}:${extra.programKey}` : action;
    const item = view.confirmations[key];
    if (item)
      setConfirmation({
        action,
        extra: { ...extra, confirmationFingerprint: item.fingerprint },
        message: item.message,
      });
  };
  const change = (next) => {
    setDraft(next);
    void execute(
      collective ? 'editCollective' : 'saveAssessment',
      collective
        ? {
            order: next.order,
            boundaries: next.boundaries,
            listVersion: saved.version,
          }
        : {
            programKey: program,
            listVersion: saved.version,
            assessment: {
              order: next.order,
              boundaries: next.boundaries,
              confidence: next.confidence,
            },
          },
    );
  };
  const allConfident = ['se', 'mr'].every(
    (key) =>
      view.own?.[key] &&
      view.own[key].order.every((id) => view.own[key].confidence[id]),
  );
  const programProgress = ['mr', 'se'].map((key) => ({
    key,
    name: key === 'mr' ? 'Medical Research' : 'Science & Engineering',
    answered: view.own?.[key]?.order.filter((id) => view.own[key].confidence[id]).length || 0,
    total: view.own?.[key]?.order.length || 0,
  }));
  const currentProgram = programProgress.find((p) => p.key === program);
  const nextProgram = programProgress.find((p) => p.key !== program && p.answered < p.total);
  const currentProgramComplete = currentProgram && currentProgram.answered === currentProgram.total;
  const saveStatus = busy ? busyMessage : pending
    ? 'Changes are not confirmed' : 'All changes saved';
  const combinedComplete = view.own?.co?.order.every((id) => view.own.co.confidence[id]);
  const unanswered = collective ? [] : assessment?.order.filter((id) => !assessment.confidence?.[id]) || [];
  const findScope = `${view.roundId}:${section}:${program}`;
  const showMissingConfidence = validationScope === findScope && unanswered.length > 0;
  const currentFindResult = findResult?.scope === findScope ? findResult : null;
  function jumpToUnanswered() {
    const previousPosition = assessment.order.indexOf(currentFindResult?.id);
    const id = unanswered.find((candidate) => assessment.order.indexOf(candidate) > previousPosition) || unanswered[0];
    if (!id) return;
    const proposal = proposals.find((p) => p.requestId === id);
    setFindResult({ scope: findScope, id, message: `Confidence needed: ${proposal?.organization}. Choose Confident or Not sure.` });
    const card = document.getElementById(`proposal-${id}`);
    card?.scrollIntoView({ behavior: 'auto', block: 'center' });
    card?.querySelector('input[type="radio"]')?.focus({ preventScroll: true });
  }
  const preparationAction = unanswered.length > 0 ? (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={busy || Boolean(pending)} onClick={jumpToUnanswered}>Go to next unanswered</Button>
      <Button disabled={busy || Boolean(pending)} onClick={() => { setValidationScope(findScope); jumpToUnanswered(); }}>Continue</Button>
    </div>
  ) : !allConfident ? (
    nextProgram && (currentProgramComplete || program === 'co') ? (
      <Button disabled={busy || Boolean(pending)} onClick={() => { setProgram(nextProgram.key); setDraft(null); }}>
        Continue to {nextProgram.name} →
      </Button>
    ) : null
  ) : !view.own?.co ? (
    <Button disabled={!allConfident || busy || Boolean(pending) || !active} onClick={() => confirm('buildCombined')}>
      Create combined list
    </Button>
  ) : program !== 'co' ? (
    <Button disabled={busy || Boolean(pending)} onClick={() => setProgram('co')}>Review combined list</Button>
  ) : outdated ? (
    <Button disabled={!allConfident || busy || Boolean(pending) || !active} onClick={() => confirm('buildCombined')}>Rebuild combined list</Button>
  ) : !view.own.co.confirmed ? (
    <Button disabled={!combinedComplete || busy || Boolean(pending) || !active} onClick={() => execute('confirmCombined')}>Confirm combined order</Button>
  ) : (
    <Button disabled={busy || Boolean(pending) || !active} onClick={() => execute('ready')}>Ready</Button>
  );
  const findProposal = (event) => {
    event.preventDefault();
    const query = find.trim().toLowerCase();
    const matches = query ? assessment.order.map((id) => proposals.find((p) => p.requestId === id))
      .filter((p) => p && `${p.requestNumber} ${p.organization} ${p.title}`.toLowerCase().includes(query)) : [];
    if (!matches.length) {
      setFindResult({ scope: findScope, message: query ? 'No matching proposal in this list. Try another name, title or proposal number.' : 'Enter a name, title or proposal number.', id: null });
      return;
    }
    const index = currentFindResult?.query === query ? (matches.findIndex((p) => p.requestId === currentFindResult.id) + 1) % matches.length : 0;
    const match = matches[index];
    setFindResult({ scope: findScope, query, id: match.requestId, message: `Match ${index + 1} of ${matches.length}: ${match.organization}, ${match.title || match.requestNumber}.${matches.length > 1 ? ' Select Find again for the next match.' : ''}` });
    const card = document.getElementById(`proposal-${match.requestId}`);
    card?.scrollIntoView({ behavior: 'auto', block: 'center' });
    card?.focus({ preventScroll: true });
  };

  const loadHistory = async (before) => {
    const id = ++generation.current;
    busyRef.current = true;
    setBusyMessage('Loading history…');
    setBusy(true);
    try {
      const next = await sendProposalRankingAction({
        action: 'history',
        roundId: view.roundId,
        ...(before != null ? { before } : {}),
      });
      if (valid(id)) {
        setHistory(next);
        setSection('history');
      }
    } catch (err) {
      if (valid(id)) {
        setError(err.message);
        if ([401, 403].includes(err.status)) setView(null);
      }
    } finally {
      if (valid(id)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 text-gray-900">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Proposal Ranking</h1>
          <p className="mt-1 text-sm text-gray-600">
            {view.cycleCode} ·{' '}
            {view.workflow.stage === 'revealed'
              ? 'Group discussion'
              : 'Private preparation'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="ranking-cycle-v2">
            Funding cycle
          </label>
          <select
            id="ranking-cycle-v2"
            className="rounded-md border p-2 text-sm"
            disabled={busy || Boolean(pending)}
            value={view.cycleCode}
            onChange={(e) => onCycleChange(e.target.value)}
          >
            {cycleOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
          {!(section === 'group' && collective) && <Button
            variant="outline"
            disabled={busy || Boolean(pending)}
            onClick={refresh}
          >
            Refresh
          </Button>}
          {!(section === 'group' && collective) && <span className="text-xs text-gray-600">
            Last refreshed{' '}
            {refreshed.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>}
        </div>
      </header>
      <nav
        aria-label="Ranking workspace"
        className="my-4 flex flex-wrap gap-2 border-b pb-2"
      >
        {[
          ['prepare', 'My preparation'],
          ['group', 'Group discussion'],
          ...(view.viewer.isFacilitator ? [['facilitate', 'Facilitate']] : []),
        ].map(([key, label]) => (
          <button
            key={key}
            disabled={busy || Boolean(pending)}
            aria-current={section === key ? 'page' : undefined}
            className={`${buttonClass} ${section === key ? 'bg-gray-900 text-white hover:bg-gray-800' : ''}`}
            onClick={() => {
              setSection(key);
              setDraft(null);
            }}
          >
            {label}
          </button>
        ))}
        <button
          disabled={busy || Boolean(pending)}
          aria-current={section === 'history' ? 'page' : undefined}
          className={buttonClass}
          onClick={() => loadHistory()}
        >
          History
        </button>
      </nav>
      {!(section === 'group' && collective) && <p role="status" className="mb-3 text-sm text-gray-600">{saveStatus}</p>}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <p>{error}</p>
          {pending && <p className="mt-2 text-sm">Your local change is kept here, but its save is not confirmed. Retry to check the result and safely finish the same change, or load the saved version below.</p>}
          {pending && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => execute(pending.action, {}, pending)}
              >
                Check and retry change
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  pendingRef.current = null;
                  setPending(null);
                  setDraft(null);
                  void refresh();
                }}
              >
                Discard local changes and load saved work
              </Button>
            </div>
          )}
        </div>
      )}
      {!active && (
        <p className="mb-4 rounded border p-3">
          Read-only historical run.{' '}
          {view.workflow.supersededBy && (
            <button
              className={buttonClass}
              onClick={async () => {
                const id = ++generation.current;
                try {
                  const next = await loadProposalRanking({
                    roundId: view.workflow.supersededBy,
                  });
                  if (valid(id)) accept(next);
                } catch (err) {
                  if (valid(id)) {
                    setError(err.message);
                    if ([401, 403].includes(err.status)) setView(null);
                  }
                }
              }}
            >
              Open replacement run
            </button>
          )}
        </p>
      )}
      {section === 'facilitate' && (
        <>
          <h2 className="text-xl font-semibold">Readiness</h2>
          <ul className="my-4 space-y-2">
            {view.progress.map((p) => (
              <li key={p.systemUserId}>
                {p.name} — {p.ready ? 'Ready' : 'Preparing'}
              </li>
            ))}
          </ul>
          {view.workflow.stage === 'private' && (
            <Button
              disabled={
                busy ||
                Boolean(pending) ||
                !active ||
                !view.progress.every((p) => p.ready)
              }
              onClick={() => confirm('reveal')}
            >
              Reveal group starting order
            </Button>
          )}
          <details className="mt-5">
            <summary className="cursor-pointer font-medium">
              Inspect private preparation
            </summary>
            <p className="my-3 text-sm text-amber-800">
              Private preparation — visible to you and each PD. Do not share
              this view before reveal.
            </p>
            {Object.entries(view.facilitatorLists || {}).map(([id, person]) => (
              <details key={id} className="py-2">
                <summary>
                  {roster.find((p) => p.systemUserId === id)?.name}
                </summary>
                {['mr', 'se', 'co'].map(
                  (key) =>
                    person[key] && (
                      <div key={key} className="mt-3">
                        <h3 className="font-semibold">{key.toUpperCase()}</h3>
                        <ol>
                          {person[key].order.map((requestId, i) => (
                            <li key={requestId} className="py-1">
                              {i + 1}.{' '}
                              {
                                proposals.find((p) => p.requestId === requestId)
                                  ?.organization
                              }{' '}
                              · {gradeAt(i, person[key].boundaries)} ·{' '}
                              {person[key].confidence[requestId] ||
                                'Confidence unanswered'}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ),
                )}
              </details>
            ))}
          </details>
        </>
      )}
      {section === 'history' && (
        <>
          <h2 className="text-xl font-semibold">Read-only history</h2>
          {history?.entries.map((entry, i) => (
            <details
              key={`${entry.at}-${i}`}
              className="my-3 rounded-lg border p-4"
            >
              <summary>
                {entry.kind === 'reveal'
                  ? 'Individual assessments revealed'
                  : 'Saved group revision'}{' '}
                · {new Date(entry.at).toLocaleString()}
              </summary>
              <AssessmentList
                assessment={entry.collective || entry.baseline}
                collective={
                  entry.collective || {
                    ...entry.baseline,
                    baseline: entry.baseline,
                    individuals: entry.individuals,
                  }
                }
                proposals={proposals}
                roster={roster}
                editable={false}
              />
            </details>
          ))}
          {history?.before && (
            <Button onClick={() => loadHistory(history.before)}>
              Earlier history
            </Button>
          )}
          {history?.entries.length === 0 && (
            <p className="mt-3">No revealed history in this run yet.</p>
          )}
          {history?.previousRoundId && (
            <button
              className={buttonClass}
              onClick={async () => {
                const id = ++generation.current;
                try {
                  const next = await loadProposalRanking({
                    roundId: history.previousRoundId,
                  });
                  if (valid(id)) {
                    accept(next);
                    setHistory(null);
                    setSection('group');
                  }
                } catch (err) {
                  if (valid(id)) {
                    setError(err.message);
                    if ([401, 403].includes(err.status)) setView(null);
                  }
                }
              }}
            >
              Open previous run
            </button>
          )}
        </>
      )}
      {section === 'prepare' &&
        (!view.own ? (
          <p>
            You are facilitating this round and do not have an individual
            assessment.
          </p>
        ) : view.workflow.stage === 'revealed' ? (
          <p>
            Your individual assessment is preserved in the group view. The
            facilitator can reopen preparation for everyone.
          </p>
        ) : (
          <>
            <h2 className="text-xl font-semibold">My preparation</h2>
            {view.own.ready ? (
              <div className="my-5">
                <p className="font-medium">Ready for group discussion</p>
                <Button
                  variant="outline"
                  disabled={busy || Boolean(pending) || !active}
                  onClick={() => execute('reopenOwn')}
                >
                  Reopen preparation
                </Button>
              </div>
            ) : (
              <>
                <div className="my-4 flex flex-wrap items-center gap-4">
                  <div className="grid min-w-0 flex-1 basis-full auto-cols-fr grid-flow-col gap-1 sm:max-w-2xl sm:basis-96" aria-label="Assessment lists">
                  {[...programProgress.map((p) => [p.key, p.name]), ...(view.own.co ? [['co', 'Combined list']] : [])].map(([key, label]) => (
                    <button
                      className={`min-h-16 min-w-0 rounded-lg px-3 py-2 text-center text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 ${program === key ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}
                      key={key}
                      aria-label={label}
                      aria-pressed={program === key}
                      aria-describedby={key !== 'co' ? `preparation-count-${key}` : undefined}
                      disabled={busy || Boolean(pending) || (key === 'co' && !view.own.co)}
                      onClick={() => { setProgram(key); setDraft(null); }}
                    >
                      {label}
                      {key === 'co' && <span className="mt-1 block text-xs font-normal text-gray-600">{view.own.co.confirmed ? 'Confirmed' : 'Review order'}</span>}
                      {key !== 'co' && <span id={`preparation-count-${key}`} className="mt-1 block text-xs font-normal text-gray-600">{programProgress.find((p) => p.key === key).answered === programProgress.find((p) => p.key === key).total ? 'Complete' : programProgress.find((p) => p.key === key).answered === 0 ? 'Not started' : 'In progress'}</span>}
                    </button>
                  ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                  <details className="relative">
                    <summary className={`${buttonClass} cursor-pointer`}>List options</summary>
                    <div className="absolute right-0 top-full z-30 mt-1 min-w-56 rounded-lg border bg-white p-2 shadow-sm">
                      {program !== 'co' ? <button disabled={!editable} className={buttonClass} onClick={() => confirm('resetProgram', { programKey: program })}>Reset {program.toUpperCase()} preparation</button>
                        : <button disabled={!allConfident || busy || Boolean(pending) || !active} className={buttonClass} onClick={() => confirm('buildCombined')}>Rebuild combined list</button>}
                    </div>
                  </details>
                  {preparationAction}
                  </div>
                </div>
                {(unanswered.length > 0 || program === 'co') && <div className="my-3">
                  {unanswered.length > 0 && <p className="mb-1 text-sm font-medium text-amber-900" aria-live="polite">{unanswered.length} {unanswered.length === 1 ? 'proposal needs' : 'proposals need'} a confidence choice</p>}
                  <p className="max-w-2xl text-sm text-gray-600">
                    {program === 'co'
                      ? outdated ? 'Rebuild from your latest program assessments before continuing.'
                        : !combinedComplete ? 'Answer confidence for every proposal, then confirm the combined order.'
                          : view.own.co.confirmed ? 'Your combined order is confirmed. Mark Ready when you are finished.'
                            : 'Review the merged order and dividers, then confirm your combined order.'
                      : !allConfident ? currentProgramComplete
                        ? `${currentProgram.name} is complete. Continue to ${nextProgram.name}. You can return to adjust either list.`
                        : 'Choose Confident or Not sure on the highlighted cards.'
                        : view.own.co ? 'Both programs are complete. Continue to your combined list.'
                          : 'Both programs are complete. Create your combined list to review MR and SE together.'}
                  </p>
                </div>}
              </>
            )}
            {outdated && (
              <p className="my-3 text-amber-800">
                Your combined list was built before your latest program changes.
                Rebuild it to continue; combined-only changes will be replaced.
              </p>
            )}
          </>
        ))}
      {section === 'group' && !collective && (
        <>
          <h2 className="text-xl font-semibold">
            Waiting for the group reveal
          </h2>
          <p className="mt-3">
            {view.progress.filter((p) => p.ready).length} of{' '}
            {view.progress.length} Program Directors ready.
          </p>
        </>
      )}
      {section === 'group' && collective && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Group discussion</h2>
            <Button variant="outline" disabled={busy || Boolean(pending) || !active} onClick={exportWorkbook}>Export workbook</Button>
          </div>
          <section aria-label="Current group recommendation" className="sticky top-0 z-20 mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-gray-200 bg-gray-50 px-2 py-3">
            <p className="font-semibold">Collective order</p>
            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-600">
                <p role="status">{saveStatus}</p>
                <p className="text-xs">Last refreshed {refreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <Button variant="outline" disabled={busy || Boolean(pending)} onClick={refresh}>Refresh</Button>
            </div>
          </section>
        </>
      )}
      {((section === 'prepare' &&
        assessment &&
        view.own &&
        !view.own.ready &&
        view.workflow.stage === 'private') ||
        (section === 'group' && collective)) && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <Grade value="A" /> Fund
            </span>
            <span className="flex items-center gap-2">
              <Grade value="B" /> Maybe
            </span>
            <span className="flex items-center gap-2">
              <Grade value="C" /> Don’t fund
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="h-6 w-6 rounded border-2 border-solid border-gray-600" /> Confident
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="h-6 w-6 rounded border-2 border-dashed border-gray-600" /> Not sure
            </span>
          </div>
          <p className="mb-3 text-xs text-gray-600">
            Peer grades: E Excellent · VG Very good · G Good · F Fair · P Poor.
            MR/SE program · E/W geography.
          </p>
          <form className="mb-2 flex gap-2" onSubmit={findProposal}>
            <label className="sr-only" htmlFor="ranking-find">
              Find proposal
            </label>
            <input
              id="ranking-find"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find proposal"
              aria-describedby="ranking-find-result"
              className="w-full max-w-sm rounded-md border p-2 text-sm"
            />
            <button className={buttonClass}>Find</button>
          </form>
          <p id="ranking-find-result" aria-live="polite" className="mb-3 text-sm text-gray-600">{currentFindResult?.message}</p>
          {section === 'prepare' && showMissingConfidence && (
            <div role="alert" className="mb-4 rounded-lg border border-red-600 bg-red-50 p-4 text-red-900">
              <p className="font-semibold">Before continuing, choose Confident or Not sure for these proposals:</p>
              <ul className="mt-2 list-disc pl-5">{unanswered.map((id) => <li key={id}>{proposals.find((p) => p.requestId === id)?.organization}</li>)}</ul>
              <p className="mt-2">Their cards are outlined in red. Use Go to next unanswered to reach each one.</p>
            </div>
          )}
          <AssessmentList
            assessment={assessment}
            proposals={proposals}
            roster={roster}
            collective={collective}
            editable={editable}
            onChange={change}
            sentiment={sentiment}
            onSentimentRefresh={refreshSentiment}
            highlightedId={currentFindResult?.id}
            showMissingConfidence={showMissingConfidence}
          />
          {section === 'prepare' && assessment.order.length > 5 && <div className="mt-5 flex justify-end">{preparationAction}</div>}
        </>
      )}
      {view.viewer.isFacilitator && active && (
        <details className="mt-8 border-t pt-4">
          <summary className="cursor-pointer font-medium">
            Round controls
          </summary>
          <div className="mt-3 flex flex-wrap gap-3">
            {view.workflow.stage === 'revealed' && (
              <>
                <Button
                  variant="outline"
                  disabled={busy || Boolean(pending)}
                  onClick={() => confirm('resetCollective')}
                >
                  Reset collective recommendation
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || Boolean(pending)}
                  onClick={() => confirm('reopenPreparation')}
                >
                  Reopen preparation for everyone
                </Button>
              </>
            )}
            <Button
              variant="outline"
              disabled={busy || Boolean(pending)}
              onClick={() => confirm('restartWalkthrough')}
            >
              Restart walkthrough
            </Button>
          </div>
        </details>
      )}
      {confirmation && (
        <RankingDialog
          label="Confirm ranking change"
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <h2 className="text-lg font-semibold">Confirm change</h2>
          <p className="my-4">{confirmation.message}</p>
          {error && (
            <p role="alert" className="my-3 text-amber-800">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <Button
              disabled={busy}
              onClick={() =>
                pending
                  ? execute(pending.action, {}, pending)
                  : execute(confirmation.action, confirmation.extra)
              }
            >
              {pending
                ? 'Check and retry change'
                : {
                    resetProgram: 'Reset program preparation',
                    buildCombined: 'Build combined list',
                    reveal: 'Reveal group starting order',
                    reopenPreparation: 'Reopen preparation',
                    resetCollective: 'Reset collective recommendation',
                    restartWalkthrough: 'Restart walkthrough',
                    reopenOwn: 'Reopen my preparation',
                  }[confirmation.action] || 'Confirm change'}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
          </div>
        </RankingDialog>
      )}
    </div>
  );
}
