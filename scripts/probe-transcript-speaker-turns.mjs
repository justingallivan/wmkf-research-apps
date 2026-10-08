#!/usr/bin/env node
/**
 * Offline regression probe. Usage: node scripts/probe-transcript-speaker-turns.mjs DRAFT.vtt ZOOM.vtt
 * Reads only the supplied local VTTs; no credentials, network, model calls or writes.
 * Reconstructs audio identities from draft display labels (cannot distinguish duplicate display
 * names or recover provider word timings). Prints changed labels/times, never transcript wording.
 * Synthetic unit/service tests cover the original provider-ID path independently.
 */
import { readFileSync } from 'node:fs';
import { parseZoomVtt, reconcileZoomSpeakerTurns } from '../lib/services/transcription-pilot/zoom-vtt.js';
import { applySpeakerReassignments } from '../lib/services/transcription-pilot/transcript-format.js';

const [draftPath, zoomPath] = process.argv.slice(2);
if (!draftPath || !zoomPath) throw new Error('Usage: probe-transcript-speaker-turns.mjs DRAFT.vtt ZOOM.vtt');
const draft = parseZoomVtt(readFileSync(draftPath, 'utf8'));
const zoom = parseZoomVtt(readFileSync(zoomPath, 'utf8'));
const ids = new Map(draft.names.map((name, index) => [name, `S${index}`]));
const content = { utterances: draft.cues.map(cue => ({ start: cue.start, end: cue.end, text: cue.text, speaker: ids.get(cue.name) })) };
const names = Object.fromEntries([...ids].filter(([name]) => !/^Speaker [A-Za-z0-9_-]+$/.test(name)).map(([name, id]) => [id, name]));
const verdict = { names, alignment: { status: 'partial', speakers: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { name }])), suggestions: {}, reasons: {}, reassigned: {} } };
const result = reconcileZoomSpeakerTurns(content, zoom.cues, verdict);
const changed = applySpeakerReassignments(content, result.alignment.reassigned, result.alignment.additionalSpeakerIds);
const changes = changed.utterances.flatMap((row, index) => {
  const before = names[content.utterances[index].speaker] ?? '(unnamed)';
  const after = result.names[row.speaker] ?? '(unnamed)';
  return before === after ? [] : [{ startMs: row.start, before, after }];
});
console.log(JSON.stringify({ inputTurns: content.utterances.length, status: result.alignment.status,
  addedIdentities: result.alignment.additionalSpeakerIds?.length ?? 0, changes }, null, 2));
