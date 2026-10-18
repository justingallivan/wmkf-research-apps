/**
 * Owner-confirmed repairs for two immutable D26 source revisions. Applied only to correction
 * drafts, never reads of published materials. No I/O, inference, or client-supplied repair plan.
 * Publication persists the repaired content through the existing version/fingerprint fences.
 */
import crypto from 'node:crypto';
import { ServiceHttpError } from '../service-http-error.js';

const REPAIRS = [
  {
    requestId: '8a0efbb3-8d45-f111-88b4-000d3a306da2',
    revisionId: 'a1b794c3-a2d4-49f3-bb4a-8d8e5b1b926a',
    sha256: '38f73b7f3777cffed58f0943a8a9a0a4e7d22ad1a200f915e7bbe019e920d07e',
    endMs: 3456916,
    turns: [{ index: 80, from: 'A', to: 'H' }, { index: 82, from: 'G', to: 'F' }],
    excluded: ['A', 'C', 'E'],
  },
  {
    requestId: 'caf12b83-9a45-f111-88b4-6045bd0261cd',
    revisionId: 'cec7927b-b936-4d80-86b3-5f731d7800b4',
    sha256: '0cda1a44b00224f26683d4a1e4f2dbccfd55d2b4ba169132f5e3ebe82b45f777',
    endMs: 3585045,
    // Only the first seven words are confirmed Justin; the rest of this mixed turn is unknown.
    turns: [{ index: 145, from: 'C', to: 'G', firstWords: 7 }],
    excluded: ['A', 'C', 'zoom_1'],
  },
];

function mismatch() {
  const message = 'Confirmed discussion repair does not match the source.';
  const code = 'meeting_discussion_repair_source_changed';
  throw new ServiceHttpError(message, { httpStatus: 409, code, body: { error: message, code } });
}

/** Pure transformation, exported for synthetic tests. Production plans are selected below only. */
export function applyDiscussionRepairPlan(content, plan) {
  const replacements = new Map();
  for (const edit of plan.turns) {
    const row = content.utterances[edit.index];
    if (!row || row.speaker !== edit.from || row.start <= plan.endMs
      || replacements.has(edit.index)) mismatch();
    if (edit.firstWords !== undefined) {
      const n = edit.firstWords;
      if (!Number.isInteger(n) || n < 1 || !row.words || n >= row.words.length) mismatch();
      const prefix = row.words.slice(0, n).map(word => word.text).join(' ');
      if (!row.text.startsWith(`${prefix} `) || row.words[n - 1].end > row.words[n].start) mismatch();
      replacements.set(edit.index, [
        { ...row, speaker: edit.to, text: prefix, end: row.words[n - 1].end, words: row.words.slice(0, n) },
        { ...row, text: row.text.slice(prefix.length + 1), start: row.words[n].start, words: row.words.slice(n) },
      ]);
    } else replacements.set(edit.index, [{ ...row, speaker: edit.to }]);
  }
  return { ...content, utterances: content.utterances.flatMap((row, index) =>
    (replacements.get(index) || [row]).map(turn => turn.end > plan.endMs && plan.excluded.includes(turn.speaker)
      ? { ...turn, speaker: `repair_unknown_${index}` } : turn)) };
}

export function applyConfirmedDiscussionRepair({ requestId, revisionId, sourceBytes, source }) {
  const plan = REPAIRS.find(row => row.requestId === requestId && row.revisionId === revisionId);
  if (!plan) return { content: source.content, repairId: null, unknownSpeakerNames: {}, confirmedSpeakerNames: {} };
  if (crypto.createHash('sha256').update(sourceBytes).digest('hex') !== plan.sha256
    || source.presentationEnd?.endMs !== plan.endMs) mismatch();
  const content = applyDiscussionRepairPlan(source.content, plan);
  const unknownSpeakerNames = Object.fromEntries(content.utterances
    .filter(row => row.speaker?.startsWith('repair_unknown_')).map(row => [row.speaker, 'Unidentified speaker']));
  const confirmedSpeakerNames = Object.fromEntries(plan.turns.map(edit => [edit.to, source.speakerNames[edit.to]]));
  return { content, unknownSpeakerNames, confirmedSpeakerNames, repairId: `confirmed-discussion-v1:${revisionId}` };
}
