import {
  DELIBERATION_STAGE_KEYS,
  DELIBERATION_STAGE_TEXT_KEYS,
  DELIBERATION_STAGE_DEFAULT_LABELS,
  DELIBERATION_DRAFT_SUBSTATE_TEXT,
  visitExpected,
  deriveDeliberationStage,
  draftStopText,
} from '../../shared/utils/deliberation-stage';
import { EDITABLE_TEXT_DEFAULTS_BY_KEY } from '../../shared/config/editableTextDefaults';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument';

const NOW = new Date('2026-09-09T12:00:00Z');
const PAST = '2026-09-01T00:00:00Z';
const FUTURE = '2026-09-20T00:00:00Z';

function artifact(lifecycleState, operationStatus = REQUEST_DOCUMENT_OPERATION_STATUS.READY, file = { webUrl: 'https://sp/x.docx' }) {
  return lifecycleState === null ? null : { lifecycleState, operationStatus, file };
}

// D26 assumption; J27 register row when it changes.
it('visitExpected() is true (D26 assumption; J27 register row when it changes)', () => {
  expect(visitExpected()).toBe(true);
});

it('every derivable stage key has a text key and a default label', () => {
  for (const key of DELIBERATION_STAGE_KEYS) {
    expect(DELIBERATION_STAGE_TEXT_KEYS[key]).toBeTruthy();
    expect(DELIBERATION_STAGE_DEFAULT_LABELS[key]).toBeTruthy();
  }
});

describe('deriveDeliberationStage: lifecycle x visit x everSent', () => {
  const cases = [
    // [label, lifecycle, visitIso, everSent, expectedStage, expectedSubstate, expectedVisitStatus]
    ['no artifact -> draft/none', null, null, false, 'draft', 'none', 'not-scheduled'],
    ['DRAFT, no visit -> draft/ready', REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, null, false, 'draft', 'ready', 'not-scheduled'],
    ['DRAFT, future visit -> still draft (visit ignored pre-share)', REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, FUTURE, false, 'draft', 'ready', 'scheduled'],
    ['DRAFT, past visit -> still draft (lifecycle gates the stage)', REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, PAST, false, 'draft', 'ready', 'visited'],
    ['REVIEW, no visit, not sent -> shared/not-sent', REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, null, false, 'shared', 'not-sent', 'not-scheduled'],
    ['REVIEW, no visit, sent -> shared/sent', REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, null, true, 'shared', 'sent', 'not-scheduled'],
    ['REVIEW, future visit, not sent -> shared/not-sent (not visited yet)', REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, FUTURE, false, 'shared', 'not-sent', 'scheduled'],
    ['REVIEW, future visit, sent -> shared/sent', REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, FUTURE, true, 'shared', 'sent', 'scheduled'],
    ['REVIEW, past visit -> visit/awaiting-observations regardless of everSent', REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, PAST, false, 'visit', 'awaiting-observations', 'visited'],
    ['REVIEW, past visit, sent -> visit/awaiting-observations', REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, PAST, true, 'visit', 'awaiting-observations', 'visited'],
    ['FINAL, no visit -> final/moved', REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL, null, false, 'final', 'moved', 'not-scheduled'],
    ['FINAL, past visit -> final/moved (visit line is independent)', REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL, PAST, true, 'final', 'moved', 'visited'],
    ['BOARD_READY -> beyond/unknown-lifecycle, not silently "draft"', REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY, null, false, 'beyond', 'unknown-lifecycle', 'not-scheduled'],
    ['SUPERSEDED -> beyond/unknown-lifecycle', REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED, PAST, false, 'beyond', 'unknown-lifecycle', 'visited'],
    ['unknown numeric lifecycle -> beyond/unknown-lifecycle (fails closed, not "draft")', 999999999, null, false, 'beyond', 'unknown-lifecycle', 'not-scheduled'],
  ];

  it.each(cases)('%s', (_label, lifecycle, visitIso, everSent, expectedStage, expectedSubstate, expectedVisitStatus) => {
    const result = deriveDeliberationStage({
      currentArtifact: artifact(lifecycle),
      siteVisitStartIso: visitIso,
      everSent,
      now: NOW,
    });
    expect(result.stage).toBe(expectedStage);
    expect(result.substate).toBe(expectedSubstate);
    expect(result.visit.status).toBe(expectedVisitStatus);
    expect(result.visit.startIso).toBe(visitIso || null);
  });
});

describe('draft substates', () => {
  it('generating', () => {
    const result = deriveDeliberationStage({
      currentArtifact: artifact(REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING, null),
      now: NOW,
    });
    expect(result).toMatchObject({ stage: 'draft', substate: 'generating' });
  });

  it('failed', () => {
    const result = deriveDeliberationStage({
      currentArtifact: artifact(REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, REQUEST_DOCUMENT_OPERATION_STATUS.FAILED, null),
      now: NOW,
    });
    expect(result).toMatchObject({ stage: 'draft', substate: 'failed' });
  });

  it('ready file missing on a READY row falls back to none', () => {
    const result = deriveDeliberationStage({
      currentArtifact: artifact(REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, REQUEST_DOCUMENT_OPERATION_STATUS.READY, null),
      now: NOW,
    });
    expect(result).toMatchObject({ stage: 'draft', substate: 'none' });
  });
});

it('D7 "in the past" is strict: a visit scheduled for exactly now is scheduled, not visited', () => {
  const result = deriveDeliberationStage({
    currentArtifact: artifact(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW),
    siteVisitStartIso: NOW.toISOString(),
    now: NOW,
  });
  expect(result.visit.status).toBe('scheduled');
  expect(result.stage).toBe('shared');

  const oneMsLater = new Date(NOW.getTime() + 1);
  const pastByOneMs = deriveDeliberationStage({
    currentArtifact: artifact(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW),
    siteVisitStartIso: NOW.toISOString(),
    now: oneMsLater,
  });
  expect(pastByOneMs.visit.status).toBe('visited');
  expect(pastByOneMs.stage).toBe('visit');
});

it('malformed siteVisitStartIso is treated as not-scheduled', () => {
  const result = deriveDeliberationStage({
    currentArtifact: artifact(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW),
    siteVisitStartIso: 'not-a-date',
    now: NOW,
  });
  expect(result.visit).toEqual({ status: 'not-scheduled', startIso: null });
});

it('every DELIBERATION_STAGE_KEYS entry has an editable-text default entry (D6 parity)', () => {
  for (const key of DELIBERATION_STAGE_KEYS) {
    const textKey = DELIBERATION_STAGE_TEXT_KEYS[key];
    expect(EDITABLE_TEXT_DEFAULTS_BY_KEY[textKey]).toBeTruthy();
  }
});

it('the label maps carry no extra keys beyond DELIBERATION_STAGE_KEYS', () => {
  expect(Object.keys(DELIBERATION_STAGE_TEXT_KEYS).sort()).toEqual([...DELIBERATION_STAGE_KEYS].sort());
  expect(Object.keys(DELIBERATION_STAGE_DEFAULT_LABELS).sort()).toEqual([...DELIBERATION_STAGE_KEYS].sort());
});

describe('draftStopText (S503: the first stop must not claim a draft that does not exist)', () => {
  const labels = { draft: 'Custom ready label' };

  it.each([
    ['none', 'No draft yet'],
    ['generating', 'Generating draft'],
    ['failed', 'Draft failed'],
  ])('draft/%s reads the code-owned substate text, ignoring the admin label', (substate, expected) => {
    expect(DELIBERATION_DRAFT_SUBSTATE_TEXT[substate]).toBe(expected);
    expect(draftStopText({ stage: 'draft', substate, labels })).toBe(expected);
  });

  it('draft/ready reads the admin-editable label (default when unset)', () => {
    expect(draftStopText({ stage: 'draft', substate: 'ready', labels })).toBe('Custom ready label');
    expect(draftStopText({ stage: 'draft', substate: 'ready' })).toBe('AI draft ready');
  });

  it('once the stage has moved on, the completed first stop keeps the label', () => {
    expect(draftStopText({ stage: 'shared', substate: 'not-sent', labels })).toBe('Custom ready label');
    expect(draftStopText({ stage: 'final', substate: 'moved' })).toBe('AI draft ready');
  });
});
