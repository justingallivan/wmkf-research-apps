/** @jest-environment node */

import { PRE_RP_BRIEF_CONTRACT } from '../../shared/config/requestDocument';

const { classifyRows } = require('../../scripts/probe-request-document-explicit-actor-census');

const SINCE = new Date('2026-09-01T00:00:00.000Z');
const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

function row(producer = PRE_RP_BRIEF_CONTRACT.producer) {
  return {
    wmkf_requestdocumentid: DOCUMENT_ID,
    wmkf_producer: producer,
    createdon: '2026-09-02T00:00:00.000Z',
    _wmkf_initiatedby_value: null,
    wmkf_initiatedat: null,
  };
}

function event(stage, producer) {
  return {
    stage,
    entity_refs: { requestDocumentId: DOCUMENT_ID },
    metadata: { operation: stage, producer },
  };
}

function originStatus(document, actorEvent) {
  const results = classifyRows([document], [actorEvent], SINCE);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ documentId: DOCUMENT_ID, kind: 'origin' });
  return results[0].status;
}

test('allows a Pre-RP brief fallback only when row and event name its producer', () => {
  expect(PRE_RP_BRIEF_CONTRACT.producer).toBe('request-workbench-pre-rp-brief');
  expect(originStatus(
    row(),
    event('pre-rp-brief-generation', PRE_RP_BRIEF_CONTRACT.producer),
  )).toBe('event-backed-unattributed');
});

test.each([
  ['row producer', row('another-producer'), PRE_RP_BRIEF_CONTRACT.producer],
  ['event producer', row(), 'another-producer'],
])('keeps a Pre-RP brief fallback with mismatched %s a violation', (_case, document, producer) => {
  expect(originStatus(document, event('pre-rp-brief-generation', producer))).toBe('violation');
});

test('keeps the existing initial-assessment stage-only allowance', () => {
  expect(originStatus(row('initial-assessment'), event('initial-assessment-generation', null)))
    .toBe('event-backed-unattributed');
});

test('keeps an unlisted stage a violation', () => {
  expect(originStatus(row(), event('unlisted-generation', PRE_RP_BRIEF_CONTRACT.producer)))
    .toBe('violation');
});

test('requires the event operation to match the Pre-RP stage', () => {
  const actorEvent = event('pre-rp-brief-generation', PRE_RP_BRIEF_CONTRACT.producer);
  actorEvent.metadata.operation = 'another-operation';
  expect(originStatus(row(), actorEvent)).toBe('violation');
});
